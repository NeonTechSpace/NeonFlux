import { v, type GenericId } from 'convex/values';

import { requireNeonFluxService } from '../auth.js';
import { readDataRetentionDays } from '../retention/retention_policy.js';
import { mutation, query, type MutationCtx, type QueryCtx } from '../_generated/server.js';
import {
    addMemberEventToGuildGrowthDailyAggregate,
    addMessagesToGuildGrowthDailyAggregate,
    createEmptyGuildGrowthDailyAggregate,
    firstOverviewActivityDate,
    maxGrowthOverviewAggregateRows,
    selectGrowthDailyAggregateShard,
    toGuildOverviewAggregateFromDaily,
    type GuildGrowthDailyAggregateDocument,
} from './growth_daily_aggregate_model.js';
import { recordMemberFlowEventOnce, recordMessageActivityOnce } from './growth_event_integrity.js';
import {
    buildGuildMemberFlowEventDocument,
    normalizeObservedAt,
    normalizeOverviewDays,
    normalizeRequiredGuildId,
    toGuildMemberFlowEventRecord,
} from './growth_overview_model.js';

type GrowthQueryCtx = QueryCtx;
type GrowthMutationCtx = MutationCtx;
type StoredGrowthDailyAggregateDocument = GuildGrowthDailyAggregateDocument & {
    _id: GenericId<'guildGrowthDailyAggregates'>;
};

const allowedGrowthBotServices = ['bot'] as const;
const allowedGrowthOverviewServices = ['web'] as const;
const nullableString = v.union(v.string(), v.null());
const memberFlowEventRecordValidator = v.object({
    eventType: v.union(v.literal('join'), v.literal('leave')),
    guildId: v.string(),
    id: v.string(),
    membershipStartedAt: nullableString,
    occurredAt: v.string(),
    userId: v.string(),
});
const messageActivityRecordValidator = v.object({
    activityDate: v.string(),
    guildId: v.string(),
    shard: v.number(),
    status: v.union(v.literal('duplicate'), v.literal('recorded')),
});
const overviewAggregateValidator = v.object({
    oldestRetainedActivityAt: v.optional(v.string()),
    windowDays: v.number(),
    activityPresence: v.object({
        hasMemberFlow: v.boolean(),
        hasMessageActivity: v.boolean(),
    }),
    memberFlow: v.object({
        graph: v.array(v.object({ date: v.string(), joins: v.number(), leaves: v.number(), netGrowth: v.number() })),
        netGrowth: v.number(),
        totalJoins: v.number(),
        totalLeaves: v.number(),
    }),
    messages: v.object({
        graph: v.array(v.object({ date: v.string(), messageCount: v.number() })),
        totalMessages: v.number(),
    }),
});

export const recordGuildMemberFlowEvent = mutation({
    args: {
        eventType: v.union(v.literal('join'), v.literal('leave')),
        guildId: v.string(),
        membershipStartedAt: v.optional(v.string()),
        occurredAt: v.optional(v.string()),
        userId: v.string(),
    },
    returns: memberFlowEventRecordValidator,
    handler: async (ctx: GrowthMutationCtx, args) => {
        await requireNeonFluxService(ctx, allowedGrowthBotServices);
        const guildId = unwrap(normalizeRequiredGuildId(args.guildId));
        await requireActiveBotInstallation(ctx, guildId);

        const document = unwrap(buildGuildMemberFlowEventDocument({ ...args, guildId }, new Date().toISOString()));
        return await recordMemberFlowEventOnce({
            event: document,
            findExistingJoin: async () => {
                const existing = await findExistingMemberJoin(ctx, document);
                return existing ? toGuildMemberFlowEventRecord(existing) : null;
            },
            insertEvent: () => insertGuildMemberFlowEvent(ctx, document),
        });
    },
});

export const recordGuildMessageActivity = mutation({
    args: {
        guildId: v.string(),
        messageId: v.string(),
        occurredAt: v.optional(v.string()),
    },
    returns: messageActivityRecordValidator,
    handler: async (ctx: GrowthMutationCtx, args) => {
        await requireNeonFluxService(ctx, allowedGrowthBotServices);
        const guildId = unwrap(normalizeRequiredGuildId(args.guildId));
        const messageId = normalizeRequiredText(args.messageId, 'messageId');
        const occurredAt = unwrap(normalizeObservedAt(args.occurredAt));
        await requireActiveBotInstallation(ctx, guildId);

        const activityDate = occurredAt.slice(0, 10);
        const shard = selectGrowthDailyAggregateShard(`${guildId}:${activityDate}:${messageId}`);
        const receipt = {
            activityDate,
            guildId,
            messageId,
            occurredAt,
            shard,
        };
        return await recordMessageActivityOnce({
            findReceipt: async () => {
                return await ctx.db
                    .query('guildMessageActivityReceipts')
                    .withIndex('by_guild_message', (index) => index.eq('guildId', guildId).eq('messageId', messageId))
                    .unique();
            },
            incrementAggregate: () => upsertMessageDailyAggregate(ctx, { activityDate, guildId, occurredAt, shard }),
            insertReceipt: async (document) => {
                await ctx.db.insert('guildMessageActivityReceipts', document);
            },
            receipt,
        });
    },
});

export const loadGuildOverviewAggregate = query({
    args: { days: v.optional(v.number()), guildId: v.string(), now: v.optional(v.string()) },
    returns: overviewAggregateValidator,
    handler: async (ctx: GrowthQueryCtx, args) => {
        await requireNeonFluxService(ctx, allowedGrowthOverviewServices);
        const guildId = unwrap(normalizeRequiredGuildId(args.guildId));
        const days = Math.min(unwrap(normalizeOverviewDays(args.days)), readDataRetentionDays());
        const now = unwrap(normalizeObservedAt(args.now));
        const firstActivityDate = firstOverviewActivityDate(days, now);
        const [dailyAggregates, firstDailyAggregate] = await Promise.all([
            ctx.db
                .query('guildGrowthDailyAggregates')
                .withIndex('by_guild_date', (index) =>
                    index
                        .eq('guildId', guildId)
                        .gte('activityDate', firstActivityDate)
                        .lte('activityDate', now.slice(0, 10))
                )
                .collect(),
            ctx.db
                .query('guildGrowthDailyAggregates')
                .withIndex('by_guild_first_event', (index) => index.eq('guildId', guildId).gte('firstEventAt', ''))
                .order('asc')
                .first(),
        ]);
        if (dailyAggregates.length > maxGrowthOverviewAggregateRows(days)) {
            throw new Error('growth-daily-aggregate-shard-invariant-violated');
        }

        return toGuildOverviewAggregateFromDaily({
            dailyAggregates,
            days,
            now,
            ...(firstDailyAggregate?.firstEventAt
                ? { oldestRetainedActivityAt: firstDailyAggregate.firstEventAt }
                : {}),
        });
    },
});

async function insertGuildMemberFlowEvent(
    ctx: GrowthMutationCtx,
    document: Parameters<typeof addMemberEventToGuildGrowthDailyAggregate>[1]
) {
    const id = await ctx.db.insert('guildMemberFlowEvents', document);
    await upsertMemberFlowDailyAggregate(ctx, document);

    return toGuildMemberFlowEventRecord({ ...document, _id: id });
}

async function findExistingMemberJoin(
    ctx: GrowthMutationCtx,
    document: Parameters<typeof addMemberEventToGuildGrowthDailyAggregate>[1]
) {
    if (document.eventType !== 'join' || !document.membershipStartedAt) return null;

    return await ctx.db
        .query('guildMemberFlowEvents')
        .withIndex('by_guild_user_membership', (index) =>
            index
                .eq('guildId', document.guildId)
                .eq('userId', document.userId)
                .eq('membershipStartedAt', document.membershipStartedAt)
        )
        .unique();
}

async function upsertMemberFlowDailyAggregate(
    ctx: GrowthMutationCtx,
    event: Parameters<typeof addMemberEventToGuildGrowthDailyAggregate>[1]
): Promise<void> {
    const activityDate = event.occurredAt.slice(0, 10);
    const shard = selectGrowthDailyAggregateShard(`${event.guildId}:${activityDate}:${event.userId}`);
    const existing = await findGrowthDailyAggregate(ctx, event.guildId, activityDate, shard);
    const aggregate = addMemberEventToGuildGrowthDailyAggregate(
        existing ?? createEmptyGuildGrowthDailyAggregate(event.guildId, activityDate, shard, event.occurredAt),
        event
    );

    if (existing) await ctx.db.patch('guildGrowthDailyAggregates', existing._id, aggregate);
    else await ctx.db.insert('guildGrowthDailyAggregates', aggregate);
}

async function upsertMessageDailyAggregate(
    ctx: GrowthMutationCtx,
    input: { activityDate: string; guildId: string; occurredAt: string; shard: number }
): Promise<void> {
    const existing = await findGrowthDailyAggregate(ctx, input.guildId, input.activityDate, input.shard);
    const aggregate = addMessagesToGuildGrowthDailyAggregate(
        existing ??
            createEmptyGuildGrowthDailyAggregate(input.guildId, input.activityDate, input.shard, input.occurredAt),
        { messageCount: 1, occurredAt: input.occurredAt }
    );

    if (existing) await ctx.db.patch('guildGrowthDailyAggregates', existing._id, aggregate);
    else await ctx.db.insert('guildGrowthDailyAggregates', aggregate);
}

async function findGrowthDailyAggregate(
    ctx: GrowthMutationCtx,
    guildId: string,
    activityDate: string,
    shard: number
): Promise<StoredGrowthDailyAggregateDocument | null> {
    return await ctx.db
        .query('guildGrowthDailyAggregates')
        .withIndex('by_guild_date_shard', (index) =>
            index.eq('guildId', guildId).eq('activityDate', activityDate).eq('shard', shard)
        )
        .unique();
}

async function requireActiveBotInstallation(ctx: GrowthMutationCtx, guildId: string): Promise<void> {
    const installation = await ctx.db
        .query('botInstallations')
        .withIndex('by_guild_id', (index) => index.eq('guildId', guildId))
        .unique();

    if (!installation) throw new Error('bot-installation-not-found');
}

function normalizeRequiredText(value: string, field: string): string {
    const normalized = value.trim();
    if (!normalized) throw new Error(`${field}-missing`);
    return normalized;
}

function unwrap<Value>(result: { ok: true; value: Value } | { error: unknown; ok: false }): Value {
    if (!result.ok) throw new Error('invalid-input');
    return result.value;
}

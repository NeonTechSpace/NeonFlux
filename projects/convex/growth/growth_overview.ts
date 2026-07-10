import { v, type GenericId } from 'convex/values';

import { requireNeonFluxService } from '../auth.js';
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
import {
    buildGuildInviteSnapshotDocument,
    buildGuildMemberFlowEventDocument,
    maxCurrentInviteSnapshots,
    normalizeObservedAt,
    normalizeOverviewDays,
    normalizeRequiredGuildId,
    toGuildInviteSnapshotRecord,
    toGuildMemberFlowEventRecord,
    type GuildInviteSnapshotInput,
    type GuildInviteSnapshotDocument,
} from './growth_overview_model.js';

export { maxCurrentInviteSnapshots } from './growth_overview_model.js';

type GrowthQueryCtx = QueryCtx;
type GrowthMutationCtx = MutationCtx;
type StoredInviteSnapshotDocument = GuildInviteSnapshotDocument & { _id: GenericId<'guildInviteSnapshots'> };
type StoredGrowthDailyAggregateDocument = GuildGrowthDailyAggregateDocument & {
    _id: GenericId<'guildGrowthDailyAggregates'>;
};
type StoredGrowthStateDocument = {
    _id: GenericId<'guildGrowthStates'>;
    createdAt: string;
    guildId: string;
    inviteBaselineObservedAt?: string;
    lastInviteSyncAt?: string;
    updatedAt: string;
};

const allowedGrowthBotServices = ['bot'] as const;
const allowedGrowthOverviewServices = ['web'] as const;
const nullableString = v.union(v.string(), v.null());
const attributionStatusValidator = v.union(
    v.literal('ambiguous'),
    v.literal('attributed'),
    v.literal('baseline-missing'),
    v.literal('not-applicable'),
    v.literal('unavailable')
);
const joinAttributionStatusValidator = v.union(
    v.literal('ambiguous'),
    v.literal('attributed'),
    v.literal('baseline-missing'),
    v.literal('unavailable')
);
const inviteSnapshotInputValidator = v.object({
    channelId: v.optional(v.union(v.string(), v.null())),
    code: v.string(),
    expiresAt: v.optional(v.union(v.string(), v.null())),
    maxUses: v.optional(v.union(v.number(), v.null())),
    temporary: v.optional(v.boolean()),
    uses: v.optional(v.number()),
    inviterUserId: v.optional(v.union(v.string(), v.null())),
});
const memberFlowEventRecordValidator = v.object({
    attributionStatus: attributionStatusValidator,
    eventType: v.union(v.literal('join'), v.literal('leave')),
    guildId: v.string(),
    id: v.string(),
    inviteCode: nullableString,
    inviterUserId: nullableString,
    occurredAt: v.string(),
    userId: v.string(),
});
const inviteSnapshotRecordValidator = v.object({
    active: v.boolean(),
    channelId: nullableString,
    code: v.string(),
    expiresAt: nullableString,
    firstSeenAt: v.string(),
    guildId: v.string(),
    id: v.string(),
    inviterUserId: nullableString,
    lastSeenAt: v.string(),
    maxUses: v.union(v.number(), v.null()),
    revokedAt: nullableString,
    temporary: v.boolean(),
    uses: v.number(),
});
const inviteSnapshotStateValidator = v.object({
    baselineObserved: v.boolean(),
    snapshots: v.array(inviteSnapshotRecordValidator),
});
const inviteSnapshotSyncValidator = v.object({
    baselineObserved: v.literal(true),
    snapshotCount: v.number(),
});
const messageActivityRecordValidator = v.object({
    activityDate: v.string(),
    guildId: v.string(),
    shard: v.number(),
});
const overviewAggregateValidator = v.object({
    dataHealth: v.object({
        hasInviteSnapshots: v.boolean(),
        hasMemberFlow: v.boolean(),
        hasMessageActivity: v.boolean(),
    }),
    invites: v.object({
        activeInviteCount: v.number(),
        attribution: v.record(v.string(), v.number()),
        totalInviteUses: v.number(),
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
    trackingStartedAt: v.optional(v.string()),
});

export const recordGuildMemberFlowEvent = mutation({
    args: {
        attributionStatus: v.optional(attributionStatusValidator),
        eventType: v.union(v.literal('join'), v.literal('leave')),
        guildId: v.string(),
        inviteCode: v.optional(v.string()),
        inviterUserId: v.optional(v.string()),
        occurredAt: v.optional(v.string()),
        userId: v.string(),
    },
    returns: memberFlowEventRecordValidator,
    handler: async (ctx: GrowthMutationCtx, args) => {
        await requireNeonFluxService(ctx, allowedGrowthBotServices);
        const guildId = unwrap(normalizeRequiredGuildId(args.guildId));
        await requireActiveBotInstallation(ctx, guildId);

        const document = unwrap(buildGuildMemberFlowEventDocument({ ...args, guildId }, new Date().toISOString()));
        return await insertGuildMemberFlowEvent(ctx, document);
    },
});

export const syncGuildInviteSnapshots = mutation({
    args: {
        guildId: v.string(),
        invites: v.array(inviteSnapshotInputValidator),
        observedAt: v.optional(v.string()),
    },
    returns: inviteSnapshotSyncValidator,
    handler: async (ctx: GrowthMutationCtx, args) => {
        await requireNeonFluxService(ctx, allowedGrowthBotServices);
        const guildId = unwrap(normalizeRequiredGuildId(args.guildId));
        const observedAt = unwrap(normalizeObservedAt(args.observedAt));
        const snapshotsByCode = indexCurrentInviteSnapshotsByCode(args.invites);
        await requireActiveBotInstallation(ctx, guildId);
        await replaceCurrentInviteSnapshots(ctx, guildId, snapshotsByCode, observedAt);
        return { baselineObserved: true as const, snapshotCount: snapshotsByCode.size };
    },
});

export const recordGuildMemberJoinWithInviteSnapshots = mutation({
    args: {
        attributionStatus: joinAttributionStatusValidator,
        guildId: v.string(),
        inviteCode: v.optional(v.string()),
        inviterUserId: v.optional(v.string()),
        invites: v.array(inviteSnapshotInputValidator),
        observedAt: v.optional(v.string()),
        userId: v.string(),
    },
    returns: memberFlowEventRecordValidator,
    handler: async (ctx: GrowthMutationCtx, args) => {
        await requireNeonFluxService(ctx, allowedGrowthBotServices);
        const guildId = unwrap(normalizeRequiredGuildId(args.guildId));
        const observedAt = unwrap(normalizeObservedAt(args.observedAt));
        const snapshotsByCode = indexCurrentInviteSnapshotsByCode(args.invites);
        const event = unwrap(
            buildGuildMemberFlowEventDocument(
                {
                    attributionStatus: args.attributionStatus,
                    eventType: 'join',
                    guildId,
                    ...(args.inviteCode === undefined ? {} : { inviteCode: args.inviteCode }),
                    ...(args.inviterUserId === undefined ? {} : { inviterUserId: args.inviterUserId }),
                    occurredAt: observedAt,
                    userId: args.userId,
                },
                observedAt
            )
        );
        await requireActiveBotInstallation(ctx, guildId);

        await replaceCurrentInviteSnapshots(ctx, guildId, snapshotsByCode, observedAt);
        return await insertGuildMemberFlowEvent(ctx, event);
    },
});

export const listGuildInviteSnapshots = query({
    args: { guildId: v.string() },
    returns: inviteSnapshotStateValidator,
    handler: async (ctx: GrowthQueryCtx, args) => {
        await requireNeonFluxService(ctx, allowedGrowthBotServices);
        const guildId = unwrap(normalizeRequiredGuildId(args.guildId));
        const [rows, state] = await Promise.all([
            ctx.db
                .query('guildInviteSnapshots')
                .withIndex('by_guild_code', (index) => index.eq('guildId', guildId))
                .take(maxCurrentInviteSnapshots + 1),
            findGrowthState(ctx, guildId),
        ]);
        if (rows.length > maxCurrentInviteSnapshots) throw new Error('invite-snapshot-limit-exceeded');

        return {
            baselineObserved: Boolean(state?.inviteBaselineObservedAt),
            snapshots: rows
                .filter((row) => row.active)
                .sort(compareInviteCodes)
                .map(toGuildInviteSnapshotRecord),
        };
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
        await upsertMessageDailyAggregate(ctx, { activityDate, guildId, occurredAt, shard });

        return { activityDate, guildId, shard };
    },
});

export const loadGuildOverviewAggregate = query({
    args: { days: v.optional(v.number()), guildId: v.string(), now: v.optional(v.string()) },
    returns: overviewAggregateValidator,
    handler: async (ctx: GrowthQueryCtx, args) => {
        await requireNeonFluxService(ctx, allowedGrowthOverviewServices);
        const guildId = unwrap(normalizeRequiredGuildId(args.guildId));
        const days = unwrap(normalizeOverviewDays(args.days));
        const now = unwrap(normalizeObservedAt(args.now));
        const firstActivityDate = firstOverviewActivityDate(days, now);
        const [dailyAggregates, firstDailyAggregate, inviteSnapshots, growthState] = await Promise.all([
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
            ctx.db
                .query('guildInviteSnapshots')
                .withIndex('by_guild_active', (index) => index.eq('guildId', guildId).eq('active', true))
                .take(maxCurrentInviteSnapshots + 1),
            findGrowthState(ctx, guildId),
        ]);
        if (dailyAggregates.length > maxGrowthOverviewAggregateRows(days)) {
            throw new Error('growth-daily-aggregate-shard-invariant-violated');
        }
        if (inviteSnapshots.length > maxCurrentInviteSnapshots) throw new Error('invite-snapshot-limit-exceeded');

        return toGuildOverviewAggregateFromDaily({
            dailyAggregates,
            days,
            inviteSnapshots,
            now,
            ...(firstDailyAggregate?.firstEventAt ? { trackingStartedAt: firstDailyAggregate.firstEventAt } : {}),
            ...(growthState?.inviteBaselineObservedAt
                ? { inviteBaselineObservedAt: growthState.inviteBaselineObservedAt }
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

async function replaceCurrentInviteSnapshots(
    ctx: GrowthMutationCtx,
    guildId: string,
    snapshotsByCode: ReadonlyMap<string, GuildInviteSnapshotInput>,
    observedAt: string
): Promise<void> {
    const existingRows = await ctx.db
        .query('guildInviteSnapshots')
        .withIndex('by_guild_code', (index) => index.eq('guildId', guildId))
        .take(maxCurrentInviteSnapshots + 1);
    if (existingRows.length > maxCurrentInviteSnapshots) throw new Error('invite-snapshot-limit-exceeded');

    const existingByCode = new Map(existingRows.map((row) => [row.code, row]));
    for (const [code, invite] of snapshotsByCode) {
        const existing = existingByCode.get(code);
        const document = unwrap(buildGuildInviteSnapshotDocument(guildId, { ...invite, code }, observedAt, existing));

        if (!existing) {
            await ctx.db.insert('guildInviteSnapshots', document);
        } else if (!sameCurrentInviteSnapshot(existing, document)) {
            await ctx.db.patch('guildInviteSnapshots', existing._id, toCurrentInviteSnapshotPatch(document));
        }
    }

    for (const existing of obsoleteCurrentInviteSnapshots(existingRows, snapshotsByCode)) {
        await ctx.db.delete('guildInviteSnapshots', existing._id);
    }

    await recordSuccessfulInviteSync(ctx, guildId, observedAt);
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

async function findGrowthState(
    ctx: GrowthQueryCtx | GrowthMutationCtx,
    guildId: string
): Promise<StoredGrowthStateDocument | null> {
    return await ctx.db
        .query('guildGrowthStates')
        .withIndex('by_guild', (index) => index.eq('guildId', guildId))
        .unique();
}

async function recordSuccessfulInviteSync(ctx: GrowthMutationCtx, guildId: string, observedAt: string): Promise<void> {
    const existing = await findGrowthState(ctx, guildId);
    if (existing) {
        await ctx.db.patch('guildGrowthStates', existing._id, {
            inviteBaselineObservedAt: existing.inviteBaselineObservedAt ?? observedAt,
            lastInviteSyncAt: observedAt,
            updatedAt: observedAt,
        });
        return;
    }

    await ctx.db.insert('guildGrowthStates', {
        createdAt: observedAt,
        guildId,
        inviteBaselineObservedAt: observedAt,
        lastInviteSyncAt: observedAt,
        updatedAt: observedAt,
    });
}

function sameCurrentInviteSnapshot(existing: StoredInviteSnapshotDocument, next: GuildInviteSnapshotDocument): boolean {
    return (
        existing.active &&
        existing.channelId === next.channelId &&
        existing.expiresAt === next.expiresAt &&
        existing.inviterUserId === next.inviterUserId &&
        existing.maxUses === next.maxUses &&
        existing.temporary === next.temporary &&
        existing.uses === next.uses &&
        existing.revokedAt === undefined
    );
}

function toCurrentInviteSnapshotPatch(document: GuildInviteSnapshotDocument) {
    return {
        active: true,
        channelId: document.channelId,
        expiresAt: document.expiresAt,
        firstSeenAt: document.firstSeenAt,
        inviterUserId: document.inviterUserId,
        lastSeenAt: document.lastSeenAt,
        maxUses: document.maxUses,
        revokedAt: undefined,
        temporary: document.temporary,
        uses: document.uses,
    };
}

function compareInviteCodes(left: StoredInviteSnapshotDocument, right: StoredInviteSnapshotDocument): number {
    return left.code.localeCompare(right.code);
}

export function indexCurrentInviteSnapshotsByCode<TSnapshot extends { code: string }>(
    snapshots: readonly TSnapshot[]
): Map<string, TSnapshot> {
    if (snapshots.length > maxCurrentInviteSnapshots) throw new Error('invite-snapshot-limit-exceeded');

    const snapshotsByCode = new Map<string, TSnapshot>();
    for (const snapshot of snapshots) {
        const code = snapshot.code.trim();
        if (!code || snapshotsByCode.has(code)) throw new Error('invite-snapshot-identity-invalid');
        snapshotsByCode.set(code, snapshot);
    }

    return snapshotsByCode;
}

export function obsoleteCurrentInviteSnapshots<TSnapshot extends { code: string }>(
    existingSnapshots: readonly TSnapshot[],
    currentSnapshotsByCode: ReadonlyMap<string, unknown>
): TSnapshot[] {
    return existingSnapshots.filter((snapshot) => !currentSnapshotsByCode.has(snapshot.code));
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

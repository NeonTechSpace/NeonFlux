import { v, type GenericId } from 'convex/values';

import { requireNeonFluxService } from '../auth.js';
import {
    buildGuildInviteSnapshotDocument,
    buildGuildMemberFlowEventDocument,
    buildGuildMessageActivityDayDocument,
    normalizeObservedAt,
    normalizeOverviewDays,
    normalizeRequiredGuildId,
    revokeGuildInviteSnapshotDocument,
    toGuildInviteSnapshotRecord,
    toGuildMemberFlowEventRecord,
    toGuildMessageActivityDayRecord,
    toGuildOverviewAggregate,
    type GuildInviteSnapshotDocument,
    type GuildMessageActivityDayDocument,
} from './growth_overview_model.js';
import { mutation, query, type MutationCtx, type QueryCtx } from '../_generated/server.js';
type GrowthQueryCtx = QueryCtx;
type GrowthMutationCtx = MutationCtx;

type StoredGuildDocument = { _id: GenericId<'guilds'>; guildId: string };
type StoredInviteSnapshotDocument = GuildInviteSnapshotDocument & { _id: GenericId<'guildInviteSnapshots'> };
type StoredMessageActivityDayDocument = GuildMessageActivityDayDocument & {
    _id: GenericId<'guildMessageActivityDays'>;
};

const allowedGrowthServices = ['bot', 'web'] as const;
const nullableString = v.union(v.string(), v.null());
const attributionStatusValidator = v.union(
    v.literal('ambiguous'),
    v.literal('attributed'),
    v.literal('baseline-missing'),
    v.literal('not-applicable'),
    v.literal('unavailable')
);
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
const messageActivityDayRecordValidator = v.object({
    activityDate: v.string(),
    channelId: v.string(),
    guildId: v.string(),
    id: v.string(),
    messageCount: v.number(),
    updatedAt: v.string(),
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
        topInviters: v.array(
            v.object({
                attributedJoins: v.number(),
                inviteCodes: v.array(v.object({ active: v.boolean(), code: v.string(), uses: v.number() })),
                inviterUserId: v.string(),
            })
        ),
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
        topChannels: v.array(v.object({ channelId: v.string(), messageCount: v.number() })),
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
        await requireNeonFluxService(ctx, allowedGrowthServices);
        const guildId = unwrap(normalizeRequiredGuildId(args.guildId));

        await requireGuildDocument(ctx, guildId);

        const document = unwrap(buildGuildMemberFlowEventDocument({ ...args, guildId }, new Date().toISOString()));

        const id = await ctx.db.insert('guildMemberFlowEvents', document);

        return toGuildMemberFlowEventRecord({ ...document, _id: id });
    },
});

export const syncGuildInviteSnapshots = mutation({
    args: {
        guildId: v.string(),
        invites: v.array(
            v.object({
                channelId: v.optional(v.union(v.string(), v.null())),
                code: v.string(),
                expiresAt: v.optional(v.union(v.string(), v.null())),
                maxUses: v.optional(v.union(v.number(), v.null())),
                temporary: v.optional(v.boolean()),
                uses: v.optional(v.number()),
                inviterUserId: v.optional(v.union(v.string(), v.null())),
            })
        ),
        observedAt: v.optional(v.string()),
    },
    returns: v.array(inviteSnapshotRecordValidator),
    handler: async (ctx: GrowthMutationCtx, args) => {
        await requireNeonFluxService(ctx, allowedGrowthServices);
        const guildId = unwrap(normalizeRequiredGuildId(args.guildId));
        const observedAt = unwrap(normalizeObservedAt(args.observedAt));

        await requireGuildDocument(ctx, guildId);

        const snapshotsByCode = new Map(args.invites.map((invite) => [invite.code.trim(), invite]));
        const currentCodes = new Set<string>();

        for (const [code, invite] of snapshotsByCode.entries()) {
            if (!code) throw new Error('invalid-input');
            currentCodes.add(code);

            const existing = await findInviteSnapshotByGuildCode(ctx, { code, guildId });
            const document = unwrap(
                buildGuildInviteSnapshotDocument(guildId, { ...invite, code }, observedAt, existing ?? undefined)
            );

            if (existing) {
                await ctx.db.patch('guildInviteSnapshots', existing._id, toInviteSnapshotPatch(document));
            } else {
                await ctx.db.insert('guildInviteSnapshots', document);
            }
        }

        const activeRows = await ctx.db
            .query('guildInviteSnapshots')
            .withIndex('by_guild_active', (query) => query.eq('guildId', guildId).eq('active', true))
            .take(5000);

        for (const activeRow of activeRows) {
            if (!currentCodes.has(activeRow.code)) {
                const revoked = revokeGuildInviteSnapshotDocument(activeRow, observedAt);

                await ctx.db.patch('guildInviteSnapshots', activeRow._id, {
                    active: false,
                    lastSeenAt: revoked.lastSeenAt,
                    revokedAt: revoked.revokedAt,
                });
            }
        }

        return await listInviteSnapshotRecordsByGuildId(ctx, guildId);
    },
});

export const listGuildInviteSnapshots = query({
    args: { guildId: v.string() },
    returns: v.array(inviteSnapshotRecordValidator),
    handler: async (ctx: GrowthQueryCtx, args) => {
        await requireNeonFluxService(ctx, allowedGrowthServices);
        const guildId = unwrap(normalizeRequiredGuildId(args.guildId));

        return await listInviteSnapshotRecordsByGuildId(ctx, guildId);
    },
});

export const incrementGuildMessageActivityDay = mutation({
    args: {
        channelId: v.string(),
        guildId: v.string(),
        occurredAt: v.optional(v.string()),
    },
    returns: messageActivityDayRecordValidator,
    handler: async (ctx: GrowthMutationCtx, args) => {
        await requireNeonFluxService(ctx, allowedGrowthServices);
        const guildId = unwrap(normalizeRequiredGuildId(args.guildId));

        await requireGuildDocument(ctx, guildId);

        const seedDocument = unwrap(
            buildGuildMessageActivityDayDocument({ ...args, guildId }, new Date().toISOString())
        );
        const existing = await findMessageActivityDay(ctx, {
            activityDate: seedDocument.activityDate,
            channelId: seedDocument.channelId,
            guildId,
        });
        const document = existing
            ? unwrap(buildGuildMessageActivityDayDocument({ ...args, guildId }, new Date().toISOString(), existing))
            : seedDocument;

        if (existing) {
            await ctx.db.patch('guildMessageActivityDays', existing._id, {
                messageCount: document.messageCount,
                updatedAt: document.updatedAt,
            });
            return toGuildMessageActivityDayRecord({ ...document, _id: existing._id });
        } else {
            const id = await ctx.db.insert('guildMessageActivityDays', document);
            return toGuildMessageActivityDayRecord({ ...document, _id: id });
        }
    },
});

export const loadGuildOverviewAggregate = query({
    args: { days: v.optional(v.number()), guildId: v.string(), now: v.optional(v.string()) },
    returns: overviewAggregateValidator,
    handler: async (ctx: GrowthQueryCtx, args) => {
        await requireNeonFluxService(ctx, allowedGrowthServices);
        const guildId = unwrap(normalizeRequiredGuildId(args.guildId));
        const days = unwrap(normalizeOverviewDays(args.days));
        const now = unwrap(normalizeObservedAt(args.now));
        const [memberEvents, inviteSnapshots, messageActivityDays] = await Promise.all([
            ctx.db
                .query('guildMemberFlowEvents')
                .withIndex('by_guild_occurred', (query) => query.eq('guildId', guildId))
                .take(5000),
            ctx.db
                .query('guildInviteSnapshots')
                .withIndex('by_guild_code', (query) => query.eq('guildId', guildId))
                .take(5000),
            ctx.db
                .query('guildMessageActivityDays')
                .withIndex('by_guild_date', (query) => query.eq('guildId', guildId))
                .take(5000),
        ]);

        return toGuildOverviewAggregate({ days, inviteSnapshots, memberEvents, messageActivityDays, now });
    },
});

async function listInviteSnapshotRecordsByGuildId(ctx: GrowthQueryCtx | GrowthMutationCtx, guildId: string) {
    const rows = await ctx.db
        .query('guildInviteSnapshots')
        .withIndex('by_guild_code', (query) => query.eq('guildId', guildId))
        .take(5000);

    return rows.sort((left, right) => left.code.localeCompare(right.code)).map(toGuildInviteSnapshotRecord);
}

async function findInviteSnapshotByGuildCode(
    ctx: GrowthMutationCtx,
    input: { code: string; guildId: string }
): Promise<StoredInviteSnapshotDocument | null> {
    return await ctx.db
        .query('guildInviteSnapshots')
        .withIndex('by_guild_code', (query) => query.eq('guildId', input.guildId).eq('code', input.code))
        .unique();
}

async function findMessageActivityDay(
    ctx: GrowthMutationCtx,
    input: { activityDate: string; channelId: string; guildId: string }
): Promise<StoredMessageActivityDayDocument | null> {
    return await ctx.db
        .query('guildMessageActivityDays')
        .withIndex('by_guild_channel_date', (query) =>
            query.eq('guildId', input.guildId).eq('channelId', input.channelId).eq('activityDate', input.activityDate)
        )
        .unique();
}

async function requireGuildDocument(ctx: GrowthMutationCtx, guildId: string): Promise<StoredGuildDocument> {
    const guild = await ctx.db
        .query('guilds')
        .withIndex('by_guild_id', (query) => query.eq('guildId', guildId))
        .unique();

    if (!guild) throw new Error('guild-not-found');

    return guild;
}

function toInviteSnapshotPatch(document: GuildInviteSnapshotDocument) {
    return {
        active: document.active,
        channelId: document.channelId,
        expiresAt: document.expiresAt,
        firstSeenAt: document.firstSeenAt,
        inviterUserId: document.inviterUserId,
        lastSeenAt: document.lastSeenAt,
        maxUses: document.maxUses,
        revokedAt: document.revokedAt,
        temporary: document.temporary,
        uses: document.uses,
    };
}

function unwrap<Value>(result: { ok: true; value: Value } | { error: unknown; ok: false }): Value {
    if (!result.ok) throw new Error('invalid-input');

    return result.value;
}

import {
    mutationGeneric,
    queryGeneric,
    type DataModelFromSchemaDefinition,
    type GenericMutationCtx,
    type GenericQueryCtx,
} from 'convex/server';
import { v, type GenericId } from 'convex/values';

import { requireNeonFluxService } from '../auth.js';
import {
    normalizeGiveawayLimit,
    normalizeRequiredGiveawayId,
    normalizeRequiredGuildId,
    toGiveawayRecord,
    type GiveawayDocument,
    type GiveawaySyncStatus,
} from './giveaways_model.js';
import type schema from '../schema.js';

type NeonFluxDataModel = DataModelFromSchemaDefinition<typeof schema>;
type GiveawayMaintenanceQueryCtx = GenericQueryCtx<NeonFluxDataModel>;
type GiveawayMaintenanceMutationCtx = GenericMutationCtx<NeonFluxDataModel>;
type StoredGiveawayDocument = GiveawayDocument & { _id: GenericId<'giveaways'> };

const allowedGiveawayMaintenanceServices = ['bot', 'web'] as const;
const nullableString = v.union(v.string(), v.null());
const giveawayRecordValidator = v.object({
    channelId: v.string(),
    closedAt: nullableString,
    closedByUserId: nullableString,
    config: v.any(),
    createdAt: v.string(),
    createdByUserId: nullableString,
    description: nullableString,
    endsAt: nullableString,
    entryEmoji: v.string(),
    guildId: v.string(),
    id: v.string(),
    messageId: nullableString,
    prize: v.string(),
    status: v.union(v.literal('active'), v.literal('cancelled'), v.literal('closed'), v.literal('draft')),
    title: v.string(),
    updatedAt: v.string(),
    winnerCount: v.number(),
});

export const listExpiredActiveGiveaways = queryGeneric({
    args: { limit: v.optional(v.number()), now: v.string() },
    returns: v.array(giveawayRecordValidator),
    handler: async (ctx: GiveawayMaintenanceQueryCtx, args) => {
        await requireNeonFluxService(ctx, allowedGiveawayMaintenanceServices);
        const now = normalizeTimestampArg(args.now, 'now');
        const giveaways = await ctx.db
            .query('giveaways')
            .withIndex('by_status_ends', (query) => query.eq('status', 'active').lte('endsAt', now))
            .order('asc')
            .take(normalizeGiveawayLimit(args.limit, 25));

        return giveaways.map(toGiveawayRecord);
    },
});

export const listStaleActiveGiveaways = queryGeneric({
    args: { limit: v.optional(v.number()) },
    returns: v.array(giveawayRecordValidator),
    handler: async (ctx: GiveawayMaintenanceQueryCtx, args) => {
        await requireNeonFluxService(ctx, allowedGiveawayMaintenanceServices);
        const giveaways = await ctx.db
            .query('giveaways')
            .withIndex('by_status_updated', (query) => query.eq('status', 'active'))
            .filter((query) =>
                query.and(
                    query.neq(query.field('messageId'), undefined),
                    query.eq(query.field('config.syncStatus'), 'stale')
                )
            )
            .order('asc')
            .take(normalizeGiveawayLimit(args.limit, 25));

        return giveaways.map(toGiveawayRecord);
    },
});

export const listReactionReconciliationGiveaways = queryGeneric({
    args: { limit: v.optional(v.number()) },
    returns: v.array(giveawayRecordValidator),
    handler: async (ctx: GiveawayMaintenanceQueryCtx, args) => {
        await requireNeonFluxService(ctx, allowedGiveawayMaintenanceServices);
        const giveaways = await ctx.db
            .query('giveaways')
            .withIndex('by_status_updated', (query) => query.eq('status', 'active'))
            .filter((query) => query.neq(query.field('messageId'), undefined))
            .order('asc')
            .take(normalizeGiveawayLimit(args.limit, 25));

        return giveaways.map(toGiveawayRecord);
    },
});

export const updateGiveawaySyncStatus = mutationGeneric({
    args: {
        giveawayId: v.string(),
        guildId: v.string(),
        syncStatus: v.union(v.literal('active'), v.literal('stale')),
    },
    returns: v.union(giveawayRecordValidator, v.null()),
    handler: async (ctx: GiveawayMaintenanceMutationCtx, args) => {
        await requireNeonFluxService(ctx, allowedGiveawayMaintenanceServices);
        const guildId = unwrap(normalizeRequiredGuildId(args.guildId));
        const giveawayId = unwrap(normalizeRequiredGiveawayId(args.giveawayId));
        const giveaway = await findGiveawayByLegacyId(ctx, giveawayId);

        if (!giveaway || giveaway.guildId !== guildId) return null;

        const patch = {
            config: { ...giveaway.config, syncStatus: args.syncStatus satisfies GiveawaySyncStatus },
            updatedAt: new Date().toISOString(),
        };

        await ctx.db.patch(giveaway._id, patch);

        return toGiveawayRecord({ ...giveaway, ...patch });
    },
});

async function findGiveawayByLegacyId(
    ctx: GiveawayMaintenanceQueryCtx | GiveawayMaintenanceMutationCtx,
    giveawayId: string
): Promise<StoredGiveawayDocument | null> {
    return await ctx.db
        .query('giveaways')
        .withIndex('by_legacy', (query) => query.eq('legacyId', giveawayId.trim()))
        .unique();
}

function normalizeTimestampArg(value: string, field: string): string {
    const parsed = Date.parse(value);

    if (!Number.isFinite(parsed)) throw new Error(`${field}-invalid`);

    return new Date(parsed).toISOString();
}

function unwrap<Value>(result: { ok: true; value: Value } | { error: unknown; ok: false }): Value {
    if (!result.ok) throw new Error('invalid-input');

    return result.value;
}

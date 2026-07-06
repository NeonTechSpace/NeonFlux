import { v, type GenericId } from 'convex/values';

import { requireNeonFluxService } from '../auth.js';
import {
    buildGiveawayEntryDocument,
    normalizeGiveawayLimit,
    normalizeRequiredGiveawayId,
    type GiveawayDocument,
    type GiveawayEntryDocument,
} from './giveaways_model.js';
import { mutation, type MutationCtx } from '../_generated/server.js';
type GiveawayReconciliationMutationCtx = MutationCtx;
type StoredGiveawayDocument = GiveawayDocument & { _id: GenericId<'giveaways'> };
type StoredGiveawayEntryDocument = GiveawayEntryDocument & { _id: GenericId<'giveawayEntries'> };

const allowedGiveawayReconciliationServices = ['bot'] as const;

export const reconcileGiveawayEntries = mutation({
    args: {
        giveawayId: v.string(),
        reconciledAt: v.optional(v.string()),
        userIds: v.array(v.string()),
    },
    returns: v.object({ added: v.number(), kept: v.number(), removed: v.number() }),
    handler: async (ctx: GiveawayReconciliationMutationCtx, args) => {
        await requireNeonFluxService(ctx, allowedGiveawayReconciliationServices);
        const giveawayId = parseGiveawayId(args.giveawayId);
        const giveaway = await findGiveawayByIdDocument(ctx, giveawayId);

        if (!giveaway) throw new Error('giveaway-not-found');

        const now = args.reconciledAt
            ? normalizeTimestampArg(args.reconciledAt, 'reconciledAt')
            : new Date().toISOString();
        const userIds = [...new Set(args.userIds.map((userId) => userId.trim()).filter(Boolean))];
        const activeEntries = await listActiveEntryDocuments(ctx, giveawayId);
        const activeUserIds = new Set(activeEntries.map((entry) => entry.userId));
        const targetUserIds = new Set(userIds);
        const userIdsToAdd = userIds.filter((userId) => !activeUserIds.has(userId));
        const userIdsToRemove = activeEntries
            .map((entry) => entry.userId)
            .filter((userId) => !targetUserIds.has(userId));

        for (const userId of userIdsToAdd) {
            const existingEntry = await findGiveawayEntryByUser(ctx, { giveawayId, userId });
            const document = unwrap(
                buildGiveawayEntryDocument({ enteredAt: now, giveawayId, userId }, now, existingEntry ?? undefined)
            );

            if (existingEntry) {
                await ctx.db.patch(existingEntry._id, { removedAt: undefined });
            } else {
                await ctx.db.insert('giveawayEntries', document);
            }
        }

        for (const userId of userIdsToRemove) {
            const entry = await findGiveawayEntryByUser(ctx, { giveawayId, userId });

            if (entry && !entry.removedAt) await ctx.db.patch(entry._id, { removedAt: now });
        }

        await ctx.db.patch(giveaway._id, {
            config: { ...giveaway.config, reactionReconciledAt: now },
            updatedAt: now,
        });

        return {
            added: userIdsToAdd.length,
            kept: userIds.length - userIdsToAdd.length,
            removed: userIdsToRemove.length,
        };
    },
});

async function findGiveawayByIdDocument(
    ctx: GiveawayReconciliationMutationCtx,
    giveawayId: GenericId<'giveaways'>
): Promise<StoredGiveawayDocument | null> {
    return await ctx.db.get(giveawayId);
}

async function findGiveawayEntryByUser(
    ctx: GiveawayReconciliationMutationCtx,
    input: { giveawayId: string; userId: string }
): Promise<StoredGiveawayEntryDocument | null> {
    return await ctx.db
        .query('giveawayEntries')
        .withIndex('by_giveaway_user', (query) =>
            query.eq('giveawayId', parseGiveawayId(input.giveawayId)).eq('userId', input.userId.trim())
        )
        .unique();
}

async function listActiveEntryDocuments(
    ctx: GiveawayReconciliationMutationCtx,
    giveawayId: string | GenericId<'giveaways'>
): Promise<StoredGiveawayEntryDocument[]> {
    return await ctx.db
        .query('giveawayEntries')
        .withIndex('by_giveaway_removed', (query) => query.eq('giveawayId', parseGiveawayId(giveawayId)))
        .filter((query) => query.eq(query.field('removedAt'), undefined))
        .take(normalizeGiveawayLimit(undefined, 1000, 1000));
}

function parseGiveawayId(giveawayId: string | GenericId<'giveaways'>): GenericId<'giveaways'> {
    return unwrap(normalizeRequiredGiveawayId(giveawayId)) as GenericId<'giveaways'>;
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

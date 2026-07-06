import { v, type GenericId } from 'convex/values';

import { requireNeonFluxService } from '../auth.js';
import {
    buildModerationTemporaryActionDocument,
    buildTemporaryActionStatusPatch,
    normalizeModerationListLimit,
    normalizeRequiredGuildId,
    normalizeRequiredTemporaryActionId,
    normalizeSinceTimestamp,
    toModerationTemporaryActionRecord,
    type ModerationTemporaryActionDocument,
} from './moderation_model.js';
import { mutation, query, type MutationCtx, type QueryCtx } from '../_generated/server.js';
type TemporaryActionQueryCtx = QueryCtx;
type TemporaryActionMutationCtx = MutationCtx;

type StoredGuildDocument = { _id: GenericId<'guilds'>; guildId: string };
type StoredModerationCaseDocument = { _id: GenericId<'moderationCases'> };
type StoredModerationTemporaryActionDocument = ModerationTemporaryActionDocument & {
    _id: GenericId<'moderationTemporaryActions'>;
};

const allowedModerationServices = ['bot', 'web'] as const;
const temporaryActionStatusValidator = v.union(
    v.literal('pending'),
    v.literal('completed'),
    v.literal('failed'),
    v.literal('cancelled')
);
const moderationTemporaryActionRecordValidator = v.object({
    action: v.string(),
    caseId: v.union(v.string(), v.null()),
    createdAt: v.string(),
    expiresAt: v.string(),
    guildId: v.string(),
    id: v.string(),
    status: temporaryActionStatusValidator,
    targetUserId: v.string(),
    updatedAt: v.string(),
});

export const createModerationTemporaryAction = mutation({
    args: {
        action: v.string(),
        caseId: v.optional(v.string()),
        createdAt: v.optional(v.string()),
        expiresAt: v.string(),
        guildId: v.string(),
        status: v.optional(v.string()),
        targetUserId: v.string(),
        updatedAt: v.optional(v.string()),
    },
    returns: moderationTemporaryActionRecordValidator,
    handler: async (ctx: TemporaryActionMutationCtx, args) => {
        await requireNeonFluxService(ctx, allowedModerationServices);
        const guildId = unwrap(normalizeRequiredGuildId(args.guildId));

        await requireGuildDocument(ctx, guildId);
        if (args.caseId) await requireModerationCase(ctx, parseModerationCaseId(args.caseId));

        const document = unwrap(buildModerationTemporaryActionDocument({ ...args, guildId }, new Date().toISOString()));

        const id = await ctx.db.insert('moderationTemporaryActions', document);

        return toModerationTemporaryActionRecord({ ...document, _id: id });
    },
});

export const findPendingModerationTemporaryActionByTarget = query({
    args: { action: v.string(), guildId: v.string(), now: v.string(), targetUserId: v.string() },
    returns: v.union(moderationTemporaryActionRecordValidator, v.null()),
    handler: async (ctx: TemporaryActionQueryCtx, args) => {
        await requireNeonFluxService(ctx, allowedModerationServices);
        const guildId = unwrap(normalizeRequiredGuildId(args.guildId));
        const now = unwrap(normalizeSinceTimestamp(args.now));
        const rows = await ctx.db
            .query('moderationTemporaryActions')
            .withIndex('by_guild_action_target_status_expires', (query) =>
                query
                    .eq('guildId', guildId)
                    .eq('action', args.action.trim())
                    .eq('targetUserId', args.targetUserId.trim())
                    .eq('status', 'pending')
                    .gt('expiresAt', now)
            )
            .order('asc')
            .take(1);

        return rows[0] ? toModerationTemporaryActionRecord(rows[0]) : null;
    },
});

export const listDueModerationTemporaryActions = query({
    args: { action: v.optional(v.string()), limit: v.optional(v.number()), now: v.string() },
    returns: v.array(moderationTemporaryActionRecordValidator),
    handler: async (ctx: TemporaryActionQueryCtx, args) => {
        await requireNeonFluxService(ctx, allowedModerationServices);
        const now = unwrap(normalizeSinceTimestamp(args.now));
        const limit = normalizeModerationListLimit(args.limit, 25, 100);
        const action = args.action;
        const rows = action
            ? await ctx.db
                  .query('moderationTemporaryActions')
                  .withIndex('by_status_action_expires', (query) =>
                      query.eq('status', 'pending').eq('action', action.trim()).lte('expiresAt', now)
                  )
                  .order('asc')
                  .take(limit)
            : await ctx.db
                  .query('moderationTemporaryActions')
                  .withIndex('by_status_expires', (query) => query.eq('status', 'pending').lte('expiresAt', now))
                  .order('asc')
                  .take(limit);

        return rows.map(toModerationTemporaryActionRecord);
    },
});

export const updateModerationTemporaryActionStatus = mutation({
    args: { id: v.string(), status: v.string() },
    returns: v.union(moderationTemporaryActionRecordValidator, v.null()),
    handler: async (ctx: TemporaryActionMutationCtx, args) => {
        await requireNeonFluxService(ctx, allowedModerationServices);
        const action = await findTemporaryActionById(ctx, parseTemporaryActionId(args.id));

        if (!action) return null;

        const patch = unwrap(buildTemporaryActionStatusPatch(action.status, args.status, new Date().toISOString()));

        await ctx.db.patch(action._id, patch);

        return toModerationTemporaryActionRecord({ ...action, ...patch });
    },
});

export const cancelPendingModerationTemporaryActionsByTarget = mutation({
    args: { action: v.string(), excludeId: v.optional(v.string()), guildId: v.string(), targetUserId: v.string() },
    returns: v.array(moderationTemporaryActionRecordValidator),
    handler: async (ctx: TemporaryActionMutationCtx, args) => {
        await requireNeonFluxService(ctx, allowedModerationServices);
        const guildId = unwrap(normalizeRequiredGuildId(args.guildId));
        const excludeId = args.excludeId?.trim();
        const rows = await ctx.db
            .query('moderationTemporaryActions')
            .withIndex('by_guild_action_target_status_expires', (query) =>
                query
                    .eq('guildId', guildId)
                    .eq('action', args.action.trim())
                    .eq('targetUserId', args.targetUserId.trim())
                    .eq('status', 'pending')
            )
            .collect();
        const now = new Date().toISOString();
        const cancelled: StoredModerationTemporaryActionDocument[] = [];

        for (const row of rows) {
            if (excludeId && row._id === excludeId) continue;

            const patch = unwrap(buildTemporaryActionStatusPatch(row.status, 'cancelled', now));

            await ctx.db.patch(row._id, patch);
            cancelled.push({ ...row, ...patch });
        }

        return cancelled.map(toModerationTemporaryActionRecord);
    },
});

async function findTemporaryActionById(
    ctx: TemporaryActionQueryCtx | TemporaryActionMutationCtx,
    id: GenericId<'moderationTemporaryActions'>
): Promise<StoredModerationTemporaryActionDocument | null> {
    return await ctx.db.get(id);
}

async function requireModerationCase(
    ctx: TemporaryActionQueryCtx | TemporaryActionMutationCtx,
    id: GenericId<'moderationCases'>
): Promise<StoredModerationCaseDocument> {
    const moderationCase = await ctx.db.get(id);

    if (!moderationCase) {
        throw new Error('moderation-case-not-found');
    }

    return moderationCase;
}

function parseModerationCaseId(caseId: string): GenericId<'moderationCases'> {
    return caseId.trim() as GenericId<'moderationCases'>;
}

function parseTemporaryActionId(id: string): GenericId<'moderationTemporaryActions'> {
    return unwrap(normalizeRequiredTemporaryActionId(id)) as GenericId<'moderationTemporaryActions'>;
}

async function requireGuildDocument(ctx: TemporaryActionMutationCtx, guildId: string): Promise<StoredGuildDocument> {
    const guild = await ctx.db
        .query('guilds')
        .withIndex('by_guild_id', (query) => query.eq('guildId', guildId))
        .unique();

    if (!guild) {
        throw new Error('guild-not-found');
    }

    return guild;
}

function unwrap<Value>(result: { ok: true; value: Value } | { error: unknown; ok: false }): Value {
    if (!result.ok) {
        const error = result.error;

        if (typeof error === 'object' && error !== null && 'type' in error) {
            throw new Error(String(error.type));
        }

        throw new Error(String(error));
    }

    return result.value;
}

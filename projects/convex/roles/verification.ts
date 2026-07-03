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
    buildVerificationFlowDocument,
    buildVerificationRecordDocument,
    buildVerificationRecordRevokePatch,
    normalizeRequiredGuildId,
    normalizeRequiredMessageId,
    normalizeRequiredUserId,
    toVerificationFlowRecord,
    toVerificationRecord,
    type VerificationFlowDocument,
    type VerificationRecordDocument,
} from './verification_model.js';
import type schema from '../schema.js';

type NeonFluxDataModel = DataModelFromSchemaDefinition<typeof schema>;
type VerificationQueryCtx = GenericQueryCtx<NeonFluxDataModel>;
type VerificationMutationCtx = GenericMutationCtx<NeonFluxDataModel>;

type StoredGuildDocument = { _id: GenericId<'guilds'>; guildId: string };
type StoredVerificationFlowDocument = VerificationFlowDocument & { _id: GenericId<'verificationFlows'> };
type StoredVerificationRecordDocument = VerificationRecordDocument & { _id: GenericId<'verificationRecords'> };

const allowedVerificationServices = ['bot', 'web', 'migration'] as const;
const verificationFlowRecordValidator = v.object({
    channelId: v.string(),
    createdAt: v.string(),
    emojiKey: v.string(),
    enabled: v.boolean(),
    guildId: v.string(),
    id: v.string(),
    messageId: v.string(),
    updatedAt: v.string(),
    verifiedRoleId: v.string(),
});
const verificationRecordValidator = v.object({
    guildId: v.string(),
    id: v.string(),
    method: v.string(),
    revokedAt: v.union(v.string(), v.null()),
    userId: v.string(),
    verifiedAt: v.string(),
});

export const upsertVerificationFlow = mutationGeneric({
    args: {
        channelId: v.string(),
        createdAt: v.optional(v.string()),
        emojiKey: v.string(),
        enabled: v.optional(v.boolean()),
        guildId: v.string(),
        legacyId: v.optional(v.string()),
        messageId: v.string(),
        updatedAt: v.optional(v.string()),
        verifiedRoleId: v.string(),
    },
    returns: verificationFlowRecordValidator,
    handler: async (ctx: VerificationMutationCtx, args) => {
        await requireNeonFluxService(ctx, allowedVerificationServices);
        const guildId = unwrap(normalizeRequiredGuildId(args.guildId));

        await requireGuildDocument(ctx, guildId);

        const existingFlow = await findVerificationFlowByGuildMessage(ctx, { guildId, messageId: args.messageId });
        const document = unwrap(
            buildVerificationFlowDocument(
                {
                    ...args,
                    guildId,
                },
                new Date().toISOString(),
                existingFlow ?? undefined,
                () => crypto.randomUUID()
            )
        );

        if (existingFlow) {
            await ctx.db.patch(existingFlow._id, {
                channelId: document.channelId,
                emojiKey: document.emojiKey,
                enabled: document.enabled,
                updatedAt: document.updatedAt,
                verifiedRoleId: document.verifiedRoleId,
            });
        } else {
            await ctx.db.insert('verificationFlows', document);
        }

        return toVerificationFlowRecord(document);
    },
});

export const listVerificationFlowsByGuildId = queryGeneric({
    args: { enabled: v.optional(v.boolean()), guildId: v.string() },
    returns: v.array(verificationFlowRecordValidator),
    handler: async (ctx: VerificationQueryCtx, args) => {
        await requireNeonFluxService(ctx, allowedVerificationServices);
        const guildId = unwrap(normalizeRequiredGuildId(args.guildId));
        const flows =
            args.enabled === undefined
                ? await ctx.db
                      .query('verificationFlows')
                      .withIndex('by_guild_channel_message', (query) => query.eq('guildId', guildId))
                      .collect()
                : await ctx.db
                      .query('verificationFlows')
                      .withIndex('by_guild_enabled', (query) =>
                          query.eq('guildId', guildId).eq('enabled', args.enabled!)
                      )
                      .collect();

        return flows
            .sort(
                (left, right) =>
                    left.channelId.localeCompare(right.channelId) || left.messageId.localeCompare(right.messageId)
            )
            .map(toVerificationFlowRecord);
    },
});

export const findEnabledVerificationFlowByReaction = queryGeneric({
    args: { emojiKey: v.string(), guildId: v.string(), messageId: v.string() },
    returns: v.union(verificationFlowRecordValidator, v.null()),
    handler: async (ctx: VerificationQueryCtx, args) => {
        await requireNeonFluxService(ctx, allowedVerificationServices);
        const guildId = unwrap(normalizeRequiredGuildId(args.guildId));
        const flow = await ctx.db
            .query('verificationFlows')
            .withIndex('by_guild_message_emoji_enabled', (query) =>
                query
                    .eq('guildId', guildId)
                    .eq('messageId', args.messageId.trim())
                    .eq('emojiKey', args.emojiKey.trim())
                    .eq('enabled', true)
            )
            .unique();

        return flow ? toVerificationFlowRecord(flow) : null;
    },
});

export const deleteVerificationFlow = mutationGeneric({
    args: { guildId: v.string(), messageId: v.string() },
    returns: v.union(verificationFlowRecordValidator, v.null()),
    handler: async (ctx: VerificationMutationCtx, args) => {
        await requireNeonFluxService(ctx, allowedVerificationServices);
        const guildId = unwrap(normalizeRequiredGuildId(args.guildId));
        const messageId = unwrap(normalizeRequiredMessageId(args.messageId));
        const flow = await findVerificationFlowByGuildMessage(ctx, { guildId, messageId });

        if (!flow) return null;

        await ctx.db.delete(flow._id);

        return toVerificationFlowRecord(flow);
    },
});

export const upsertVerificationRecord = mutationGeneric({
    args: {
        guildId: v.string(),
        legacyId: v.optional(v.string()),
        method: v.string(),
        revokedAt: v.optional(v.string()),
        userId: v.string(),
        verifiedAt: v.optional(v.string()),
    },
    returns: verificationRecordValidator,
    handler: async (ctx: VerificationMutationCtx, args) => {
        await requireNeonFluxService(ctx, allowedVerificationServices);
        const guildId = unwrap(normalizeRequiredGuildId(args.guildId));
        const userId = unwrap(normalizeRequiredUserId(args.userId));

        await requireGuildDocument(ctx, guildId);

        const existingRecord = await findVerificationRecordByGuildUser(ctx, { guildId, userId });
        const document = unwrap(
            buildVerificationRecordDocument(
                {
                    ...args,
                    guildId,
                    userId,
                },
                new Date().toISOString(),
                existingRecord ?? undefined,
                () => crypto.randomUUID()
            )
        );

        if (existingRecord) {
            await ctx.db.patch(existingRecord._id, {
                method: document.method,
                revokedAt: undefined,
                verifiedAt: document.verifiedAt,
            });
        } else {
            await ctx.db.insert('verificationRecords', document);
        }

        return toVerificationRecord(document);
    },
});

export const revokeVerificationRecord = mutationGeneric({
    args: { guildId: v.string(), revokedAt: v.optional(v.string()), userId: v.string() },
    returns: v.union(verificationRecordValidator, v.null()),
    handler: async (ctx: VerificationMutationCtx, args) => {
        await requireNeonFluxService(ctx, allowedVerificationServices);
        const guildId = unwrap(normalizeRequiredGuildId(args.guildId));
        const userId = unwrap(normalizeRequiredUserId(args.userId));
        const record = await findVerificationRecordByGuildUser(ctx, { guildId, userId });

        if (!record) return null;

        const patch = unwrap(buildVerificationRecordRevokePatch(args.revokedAt ?? new Date().toISOString()));

        await ctx.db.patch(record._id, patch);

        return toVerificationRecord({ ...record, ...patch });
    },
});

export const findActiveVerificationRecord = queryGeneric({
    args: { guildId: v.string(), userId: v.string() },
    returns: v.union(verificationRecordValidator, v.null()),
    handler: async (ctx: VerificationQueryCtx, args) => {
        await requireNeonFluxService(ctx, allowedVerificationServices);
        const guildId = unwrap(normalizeRequiredGuildId(args.guildId));
        const userId = unwrap(normalizeRequiredUserId(args.userId));
        const record = await findVerificationRecordByGuildUser(ctx, { guildId, userId });

        return record && !record.revokedAt ? toVerificationRecord(record) : null;
    },
});

async function findVerificationFlowByGuildMessage(
    ctx: VerificationQueryCtx | VerificationMutationCtx,
    input: { guildId: string; messageId: string }
): Promise<StoredVerificationFlowDocument | null> {
    return await ctx.db
        .query('verificationFlows')
        .withIndex('by_guild_message', (query) =>
            query.eq('guildId', input.guildId).eq('messageId', input.messageId.trim())
        )
        .unique();
}

async function findVerificationRecordByGuildUser(
    ctx: VerificationQueryCtx | VerificationMutationCtx,
    input: { guildId: string; userId: string }
): Promise<StoredVerificationRecordDocument | null> {
    return await ctx.db
        .query('verificationRecords')
        .withIndex('by_guild_user', (query) => query.eq('guildId', input.guildId).eq('userId', input.userId))
        .unique();
}

async function requireGuildDocument(ctx: VerificationMutationCtx, guildId: string): Promise<StoredGuildDocument> {
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

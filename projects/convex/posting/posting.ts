import { v, type GenericId } from 'convex/values';

import { requireNeonFluxService } from '../auth.js';
import { recordBotActionEventInMutation } from '../core/events.js';
import {
    buildMessageTemplateDocument,
    buildPostedMessageDocument,
    normalizeMessageTemplateLimit,
    normalizePostedMessageLookupInput,
    normalizeRequiredGuildId,
    normalizeRequiredTemplateId,
    toMessageTemplateRecord,
    toPostedMessageRecord,
    type MessageTemplateDocument,
    type PostedMessageDocument,
} from './posting_model.js';
import { internal } from '../_generated/api.js';
import { internalMutation, mutation, query, type MutationCtx, type QueryCtx } from '../_generated/server.js';
type PostingQueryCtx = QueryCtx;
type PostingMutationCtx = MutationCtx;

type StoredGuildDocument = {
    _id: GenericId<'guilds'>;
    guildId: string;
};

type StoredMessageTemplateDocument = MessageTemplateDocument & {
    _id: GenericId<'messageTemplates'>;
};

type StoredPostedMessageDocument = PostedMessageDocument & {
    _id: GenericId<'postedMessages'>;
};

const allowedPostingServices = ['bot', 'web'] as const;
const dashboardPostingOperationRetentionMs = 30 * 24 * 60 * 60 * 1000;
const dashboardPostingOperationPruneBatchSize = 100;
const auditInputValidator = v.object({
    action: v.string(),
    actorUserId: v.optional(v.string()),
    feature: v.string(),
    metadata: v.optional(v.any()),
});
const messageTemplateRecordValidator = v.object({
    content: v.union(v.string(), v.null()),
    createdAt: v.string(),
    createdByUserId: v.union(v.string(), v.null()),
    embeds: v.array(v.any()),
    guildId: v.string(),
    id: v.string(),
    name: v.string(),
    updatedAt: v.string(),
});
const postedMessageRecordValidator = v.object({
    channelId: v.string(),
    createdAt: v.string(),
    createdByUserId: v.union(v.string(), v.null()),
    guildId: v.string(),
    id: v.string(),
    messageId: v.string(),
    purpose: v.string(),
    templateId: v.union(v.string(), v.null()),
    updatedAt: v.string(),
});
const dashboardPostingOperationStatusValidator = v.union(v.literal('unknown'), v.literal('sent'));
const dashboardPostingOperationBeginValidator = v.object({
    messageId: v.optional(v.string()),
    sentChannelId: v.optional(v.string()),
    shouldSend: v.boolean(),
    status: dashboardPostingOperationStatusValidator,
});

export const beginDashboardPostingOperation = mutation({
    args: {
        actorUserId: v.string(),
        guildId: v.string(),
        payloadHash: v.string(),
        requestKey: v.string(),
        requestedChannelId: v.string(),
    },
    returns: dashboardPostingOperationBeginValidator,
    handler: async (ctx: PostingMutationCtx, args) => {
        await requireNeonFluxService(ctx, ['web'] as const);
        const guildId = unwrap(normalizeRequiredGuildId(args.guildId));
        await requireGuildDocument(ctx, guildId);
        const requestKey = normalizeBoundedIdentifier(args.requestKey, 'request-key', 128);
        const payloadHash = normalizeBoundedIdentifier(args.payloadHash, 'payload-hash', 128);
        const actorUserId = normalizeBoundedIdentifier(args.actorUserId, 'actor-user-id', 128);
        const requestedChannelId = normalizeBoundedIdentifier(args.requestedChannelId, 'channel-id', 128);
        const existing = await ctx.db
            .query('dashboardPostingOperations')
            .withIndex('by_guild_request', (query) => query.eq('guildId', guildId).eq('requestKey', requestKey))
            .unique();

        if (existing) {
            if (
                existing.actorUserId !== actorUserId ||
                existing.payloadHash !== payloadHash ||
                existing.requestedChannelId !== requestedChannelId
            ) {
                throw new Error('posting-request-key-conflict');
            }

            return {
                ...(existing.messageId ? { messageId: existing.messageId } : {}),
                ...(existing.sentChannelId ? { sentChannelId: existing.sentChannelId } : {}),
                shouldSend: false,
                status: existing.status,
            };
        }

        const now = new Date();
        const timestamp = now.toISOString();
        await ctx.db.insert('dashboardPostingOperations', {
            actorUserId,
            createdAt: timestamp,
            expiresAt: new Date(now.getTime() + dashboardPostingOperationRetentionMs).toISOString(),
            guildId,
            payloadHash,
            requestKey,
            requestedChannelId,
            status: 'unknown',
            updatedAt: timestamp,
        });

        return { shouldSend: true, status: 'unknown' as const };
    },
});

export const completeDashboardPostingOperation = mutation({
    args: {
        actorUserId: v.string(),
        auditMetadata: v.optional(v.any()),
        guildId: v.string(),
        messageId: v.string(),
        payloadHash: v.string(),
        requestKey: v.string(),
        sentChannelId: v.string(),
    },
    returns: postedMessageRecordValidator,
    handler: async (ctx: PostingMutationCtx, args) => {
        await requireNeonFluxService(ctx, ['web'] as const);
        const guildId = unwrap(normalizeRequiredGuildId(args.guildId));
        const requestKey = normalizeBoundedIdentifier(args.requestKey, 'request-key', 128);
        const operation = await ctx.db
            .query('dashboardPostingOperations')
            .withIndex('by_guild_request', (query) => query.eq('guildId', guildId).eq('requestKey', requestKey))
            .unique();

        if (
            operation?.actorUserId !== args.actorUserId ||
            operation.payloadHash !== args.payloadHash ||
            operation.requestedChannelId !== args.sentChannelId
        ) {
            throw new Error('posting-operation-mismatch');
        }

        if (
            operation.status === 'sent' &&
            (operation.messageId !== args.messageId || operation.sentChannelId !== args.sentChannelId)
        ) {
            throw new Error('posting-operation-already-completed');
        }

        const postedMessage = await recordPostedMessageInMutation(ctx, {
            channelId: args.sentChannelId,
            createdByUserId: args.actorUserId,
            guildId,
            messageId: args.messageId,
            purpose: 'dashboard',
        });
        const now = new Date().toISOString();
        await ctx.db.patch('dashboardPostingOperations', operation._id, {
            completedAt: operation.completedAt ?? now,
            messageId: args.messageId,
            sentChannelId: args.sentChannelId,
            status: 'sent',
            updatedAt: now,
        });

        if (operation.status !== 'sent') {
            await recordBotActionEventInMutation(ctx, {
                action: 'message.sent',
                actorUserId: args.actorUserId,
                feature: 'posting',
                guildId,
                metadata: {
                    ...(isPlainRecord(args.auditMetadata) ? args.auditMetadata : {}),
                    channelId: args.sentChannelId,
                    messageId: args.messageId,
                    source: 'dashboard',
                },
                targetId: args.messageId,
            });
        }

        return postedMessage;
    },
});

export const upsertMessageTemplate = mutation({
    args: {
        audit: v.optional(auditInputValidator),
        content: v.optional(v.string()),
        createdAt: v.optional(v.string()),
        createdByUserId: v.optional(v.string()),
        embeds: v.optional(v.array(v.any())),
        expectedUpdatedAt: v.optional(v.string()),
        guildId: v.string(),
        name: v.string(),
        templateId: v.optional(v.string()),
        updatedAt: v.optional(v.string()),
    },
    returns: messageTemplateRecordValidator,
    handler: async (ctx: PostingMutationCtx, args) => {
        await requireNeonFluxService(ctx, allowedPostingServices);
        const guildId = unwrap(normalizeRequiredGuildId(args.guildId));

        await requireGuildDocument(ctx, guildId);

        const existingTemplate = args.templateId
            ? await requireMessageTemplateDocument(ctx, args.templateId, guildId)
            : undefined;
        const templateWithName = await findMessageTemplateByNameDocument(ctx, {
            guildId,
            name: args.name,
        });

        if (!existingTemplate && templateWithName) {
            throw new Error('template-name-conflict');
        }

        if (existingTemplate && templateWithName && templateWithName._id !== existingTemplate._id) {
            throw new Error('template-name-conflict');
        }

        if (existingTemplate && args.expectedUpdatedAt !== existingTemplate.updatedAt) {
            throw new Error('template-version-conflict');
        }
        const document = unwrap(
            buildMessageTemplateDocument(
                {
                    ...args,
                    guildId,
                },
                new Date().toISOString(),
                existingTemplate ?? undefined
            )
        );

        let templateId;

        if (existingTemplate) {
            await ctx.db.patch('messageTemplates', existingTemplate._id, {
                content: document.content,
                embeds: document.embeds,
                name: document.name,
                updatedAt: document.updatedAt,
            });
            templateId = existingTemplate._id;
        } else {
            templateId = await ctx.db.insert('messageTemplates', document);
        }

        if (args.audit) {
            await recordBotActionEventInMutation(ctx, {
                ...args.audit,
                guildId,
                metadata: {
                    ...(isPlainRecord(args.audit.metadata) ? args.audit.metadata : {}),
                    contentLength: document.content?.length ?? 0,
                    embedCount: document.embeds.length,
                    templateId,
                    templateName: document.name,
                },
                targetId: templateId,
            });
        }

        return toMessageTemplateRecord({ ...document, _id: templateId });
    },
});

export const recordPostedMessage = mutation({
    args: {
        channelId: v.string(),
        createdAt: v.optional(v.string()),
        createdByUserId: v.optional(v.string()),
        guildId: v.string(),
        messageId: v.string(),
        purpose: v.optional(v.string()),
        templateId: v.optional(v.string()),
        updatedAt: v.optional(v.string()),
    },
    returns: postedMessageRecordValidator,
    handler: async (ctx: PostingMutationCtx, args) => {
        await requireNeonFluxService(ctx, allowedPostingServices);
        return recordPostedMessageInMutation(ctx, args);
    },
});

export const pruneDashboardPostingOperations = internalMutation({
    args: {},
    returns: v.object({ deletedCount: v.number(), hasMore: v.boolean() }),
    handler: async (ctx: PostingMutationCtx) => {
        const now = new Date().toISOString();
        const expired = await ctx.db
            .query('dashboardPostingOperations')
            .withIndex('by_expires', (query) => query.lte('expiresAt', now))
            .take(dashboardPostingOperationPruneBatchSize + 1);
        const batch = expired.slice(0, dashboardPostingOperationPruneBatchSize);

        for (const operation of batch) {
            await ctx.db.delete('dashboardPostingOperations', operation._id);
        }

        const hasMore = expired.length > batch.length;
        if (hasMore) {
            await ctx.scheduler.runAfter(0, internal.posting.posting.pruneDashboardPostingOperations, {});
        }

        return { deletedCount: batch.length, hasMore };
    },
});

export const listMessageTemplatesByGuildId = query({
    args: {
        guildId: v.string(),
        limit: v.optional(v.number()),
    },
    returns: v.array(messageTemplateRecordValidator),
    handler: async (ctx: PostingQueryCtx, args) => {
        await requireNeonFluxService(ctx, allowedPostingServices);
        const guildId = unwrap(normalizeRequiredGuildId(args.guildId));
        const templates = await ctx.db
            .query('messageTemplates')
            .withIndex('by_guild_updated', (query) => query.eq('guildId', guildId))
            .order('desc')
            .take(normalizeMessageTemplateLimit(args.limit));

        return templates.map(toMessageTemplateRecord);
    },
});

export const readMessageTemplateByName = query({
    args: {
        guildId: v.string(),
        name: v.string(),
    },
    returns: v.union(messageTemplateRecordValidator, v.null()),
    handler: async (ctx: PostingQueryCtx, args) => {
        await requireNeonFluxService(ctx, allowedPostingServices);
        const guildId = unwrap(normalizeRequiredGuildId(args.guildId));
        const template = await findMessageTemplateByNameDocument(ctx, {
            guildId,
            name: args.name,
        });

        return template ? toMessageTemplateRecord(template) : null;
    },
});

export const deleteMessageTemplate = mutation({
    args: {
        audit: v.optional(auditInputValidator),
        expectedUpdatedAt: v.optional(v.string()),
        guildId: v.string(),
        templateId: v.string(),
    },
    returns: v.union(messageTemplateRecordValidator, v.null()),
    handler: async (ctx: PostingMutationCtx, args) => {
        await requireNeonFluxService(ctx, allowedPostingServices);
        const guildId = unwrap(normalizeRequiredGuildId(args.guildId));
        const templateId = unwrap(normalizeRequiredTemplateId(args.templateId));
        const template = await findMessageTemplateByIdDocument(ctx, parseMessageTemplateId(templateId));

        if (template?.guildId !== guildId) {
            return null;
        }

        if (args.expectedUpdatedAt !== template.updatedAt) {
            throw new Error('template-version-conflict');
        }

        await ctx.db.delete('messageTemplates', template._id);

        if (args.audit) {
            await recordBotActionEventInMutation(ctx, {
                ...args.audit,
                guildId,
                metadata: {
                    ...(isPlainRecord(args.audit.metadata) ? args.audit.metadata : {}),
                    contentLength: template.content?.length ?? 0,
                    embedCount: template.embeds.length,
                    templateId: template._id,
                    templateName: template.name,
                },
                targetId: template._id,
            });
        }

        return toMessageTemplateRecord(template);
    },
});

async function findMessageTemplateByNameDocument(
    ctx: PostingQueryCtx | PostingMutationCtx,
    input: {
        guildId: string;
        name: string;
    }
): Promise<StoredMessageTemplateDocument | null> {
    return await ctx.db
        .query('messageTemplates')
        .withIndex('by_guild_name', (query) => query.eq('guildId', input.guildId).eq('name', input.name.trim()))
        .unique();
}

async function findMessageTemplateByIdDocument(
    ctx: PostingQueryCtx | PostingMutationCtx,
    templateId: GenericId<'messageTemplates'>
): Promise<StoredMessageTemplateDocument | null> {
    return await ctx.db.get('messageTemplates', templateId);
}

async function requireMessageTemplateDocument(
    ctx: PostingMutationCtx,
    templateId: string,
    guildId: string
): Promise<StoredMessageTemplateDocument> {
    const template = await findMessageTemplateByIdDocument(ctx, parseMessageTemplateId(templateId));

    if (template?.guildId !== guildId) {
        throw new Error('template-not-found');
    }

    return template;
}

async function findPostedMessageDocument(
    ctx: PostingQueryCtx | PostingMutationCtx,
    input: {
        channelId: string;
        guildId: string;
        messageId: string;
    }
): Promise<StoredPostedMessageDocument | null> {
    return await ctx.db
        .query('postedMessages')
        .withIndex('by_guild_channel_message', (query) =>
            query.eq('guildId', input.guildId).eq('channelId', input.channelId).eq('messageId', input.messageId)
        )
        .unique();
}

async function recordPostedMessageInMutation(
    ctx: PostingMutationCtx,
    args: {
        channelId: string;
        createdAt?: string;
        createdByUserId?: string;
        guildId: string;
        messageId: string;
        purpose?: string;
        templateId?: string;
        updatedAt?: string;
    }
) {
    const lookup = unwrap(normalizePostedMessageLookupInput(args));
    await requireGuildDocument(ctx, lookup.guildId);

    if (args.templateId) {
        await requireMessageTemplateDocument(ctx, args.templateId, lookup.guildId);
    }

    const existingMessage = await findPostedMessageDocument(ctx, lookup);
    const document = unwrap(
        buildPostedMessageDocument(
            {
                ...args,
                ...lookup,
            },
            new Date().toISOString(),
            existingMessage ?? undefined
        )
    );

    if (existingMessage) {
        await ctx.db.patch('postedMessages', existingMessage._id, {
            createdByUserId: document.createdByUserId,
            purpose: document.purpose,
            templateId: document.templateId,
            updatedAt: document.updatedAt,
        });
        return toPostedMessageRecord({ ...existingMessage, ...document });
    }

    const id = await ctx.db.insert('postedMessages', document);
    return toPostedMessageRecord({ ...document, _id: id });
}

async function requireGuildDocument(ctx: PostingMutationCtx, guildId: string): Promise<StoredGuildDocument> {
    const guild = await ctx.db
        .query('guilds')
        .withIndex('by_guild_id', (query) => query.eq('guildId', guildId))
        .unique();

    if (!guild) {
        throw new Error('guild-not-found');
    }

    return guild;
}

function parseMessageTemplateId(templateId: string | GenericId<'messageTemplates'>): GenericId<'messageTemplates'> {
    return unwrap(normalizeRequiredTemplateId(templateId)) as GenericId<'messageTemplates'>;
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

function isPlainRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeBoundedIdentifier(value: string, label: string, maxLength: number): string {
    const normalized = value.trim();

    if (!normalized || normalized.length > maxLength) {
        throw new Error(`invalid-${label}`);
    }

    return normalized;
}

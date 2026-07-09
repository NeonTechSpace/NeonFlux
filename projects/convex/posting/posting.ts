import { v, type GenericId } from 'convex/values';

import { requireNeonFluxService } from '../auth.js';
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
import { mutation, query, type MutationCtx, type QueryCtx } from '../_generated/server.js';
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

export const upsertMessageTemplate = mutation({
    args: {
        content: v.optional(v.string()),
        createdAt: v.optional(v.string()),
        createdByUserId: v.optional(v.string()),
        embeds: v.optional(v.array(v.any())),
        guildId: v.string(),
        name: v.string(),
        updatedAt: v.optional(v.string()),
    },
    returns: messageTemplateRecordValidator,
    handler: async (ctx: PostingMutationCtx, args) => {
        await requireNeonFluxService(ctx, allowedPostingServices);
        const guildId = unwrap(normalizeRequiredGuildId(args.guildId));

        await requireGuildDocument(ctx, guildId);

        const existingTemplate = await findMessageTemplateByNameDocument(ctx, {
            guildId,
            name: args.name,
        });
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

        if (existingTemplate) {
            await ctx.db.patch('messageTemplates', existingTemplate._id, {
                content: document.content,
                embeds: document.embeds,
                updatedAt: document.updatedAt,
            });
            return toMessageTemplateRecord({ ...existingTemplate, ...document });
        } else {
            const id = await ctx.db.insert('messageTemplates', document);
            return toMessageTemplateRecord({ ...document, _id: id });
        }
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
        } else {
            const id = await ctx.db.insert('postedMessages', document);
            return toPostedMessageRecord({ ...document, _id: id });
        }
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

        await ctx.db.delete('messageTemplates', template._id);

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

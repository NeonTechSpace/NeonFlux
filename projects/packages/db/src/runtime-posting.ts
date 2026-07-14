import { api } from '@neonflux/convex-api';
import { parseOutgoingMessage, type OutgoingEmbed } from '@neonflux/messaging';
import { err, ok, type Result } from 'neverthrow';

import type {
    GuildFeatureRepositoryError,
    MessageTemplateRecord,
    PostedMessageRecord,
    PostingRepositoryError,
} from './contracts.js';

import type { ConvexDatabase } from './convex.js';

type PostingDb = ConvexDatabase;

type ConvexMessageTemplateRecord = {
    content: string | null;
    createdAt: string;
    createdByUserId: string | null;
    embeds: OutgoingEmbed[];
    guildId: string;
    id: string;
    name: string;
    updatedAt: string;
};

type ConvexPostedMessageRecord = {
    channelId: string;
    createdAt: string;
    createdByUserId: string | null;
    guildId: string;
    id: string;
    messageId: string;
    purpose: string;
    templateId: string | null;
    updatedAt: string;
};

export async function upsertMessageTemplate(
    db: PostingDb,
    input: {
        audit?: {
            action: string;
            actorUserId?: string;
            feature: string;
            metadata?: Record<string, unknown>;
        };
        content?: string;
        createdByUserId?: string;
        embeds?: OutgoingEmbed[];
        expectedUpdatedAt?: string;
        guildId: string;
        name: string;
        templateId?: string;
    }
): Promise<Result<MessageTemplateRecord, PostingRepositoryError>> {
    const normalizedInput = normalizeMessageTemplateInput(input);

    if (normalizedInput.isErr()) {
        return err(normalizedInput.error);
    }

    try {
        const template = await db.client.mutation(api.posting.upsertMessageTemplate, normalizedInput.value);

        return ok(toMessageTemplateRecord(template));
    } catch (errorValue) {
        return err(mapPostingMutationError(errorValue));
    }
}

export async function recordPostedMessage(
    db: PostingDb,
    input: {
        channelId: string;
        createdByUserId?: string;
        guildId: string;
        messageId: string;
        purpose?: string;
        templateId?: string;
    }
): Promise<Result<PostedMessageRecord, PostingRepositoryError>> {
    const normalizedInput = normalizePostedMessageInput(input);

    if (normalizedInput.isErr()) {
        return err(normalizedInput.error);
    }

    try {
        const postedMessage = await db.client.mutation(api.posting.recordPostedMessage, normalizedInput.value);

        return ok(toPostedMessageRecord(postedMessage));
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function listMessageTemplatesByGuildId(
    db: PostingDb,
    input: { guildId: string; limit?: number }
): Promise<Result<MessageTemplateRecord[], PostingRepositoryError>> {
    const guildId = normalizeRequiredText(input.guildId, 'guildId');

    if (guildId.isErr()) {
        return err(guildId.error);
    }

    try {
        const templates = await db.client.query(api.posting.listMessageTemplatesByGuildId, {
            guildId: guildId.value,
            limit: normalizeTemplateLimit(input.limit),
        });

        return ok(templates.map(toMessageTemplateRecord));
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function findMessageTemplateByName(
    db: PostingDb,
    input: { guildId: string; name: string }
): Promise<Result<MessageTemplateRecord, PostingRepositoryError>> {
    const guildId = normalizeRequiredText(input.guildId, 'guildId');
    const name = normalizeRequiredText(input.name, 'name');

    if (guildId.isErr()) return err(guildId.error);
    if (name.isErr()) return err(name.error);

    try {
        const template = await db.client.query(api.posting.readMessageTemplateByName, {
            guildId: guildId.value,
            name: name.value,
        });

        return template ? ok(toMessageTemplateRecord(template)) : err({ type: 'not-found' });
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function deleteMessageTemplate(
    db: PostingDb,
    input: {
        audit?: {
            action: string;
            actorUserId?: string;
            feature: string;
            metadata?: Record<string, unknown>;
        };
        expectedUpdatedAt: string;
        guildId: string;
        templateId: string;
    }
): Promise<Result<MessageTemplateRecord, PostingRepositoryError>> {
    const guildId = normalizeRequiredText(input.guildId, 'guildId');
    const templateId = normalizeRequiredText(input.templateId, 'templateId');

    if (guildId.isErr()) return err(guildId.error);
    if (templateId.isErr()) return err(templateId.error);

    try {
        const template = await db.client.mutation(api.posting.deleteMessageTemplate, {
            ...(input.audit ? { audit: input.audit } : {}),
            expectedUpdatedAt: input.expectedUpdatedAt,
            guildId: guildId.value,
            templateId: templateId.value,
        });

        return template ? ok(toMessageTemplateRecord(template)) : err({ type: 'not-found' });
    } catch (errorValue) {
        return err(mapPostingMutationError(errorValue));
    }
}

function toMessageTemplateRecord(record: ConvexMessageTemplateRecord): MessageTemplateRecord {
    return {
        content: record.content,
        createdAt: new Date(record.createdAt),
        createdByUserId: record.createdByUserId,
        embeds: record.embeds,
        guildId: record.guildId,
        id: record.id,
        name: record.name,
        updatedAt: new Date(record.updatedAt),
    };
}

function toPostedMessageRecord(record: ConvexPostedMessageRecord): PostedMessageRecord {
    return {
        channelId: record.channelId,
        createdAt: new Date(record.createdAt),
        createdByUserId: record.createdByUserId,
        guildId: record.guildId,
        id: record.id,
        messageId: record.messageId,
        purpose: record.purpose,
        templateId: record.templateId,
        updatedAt: new Date(record.updatedAt),
    };
}

function normalizeMessageTemplateInput(input: {
    audit?: {
        action: string;
        actorUserId?: string;
        feature: string;
        metadata?: Record<string, unknown>;
    };
    content?: string;
    createdByUserId?: string;
    embeds?: OutgoingEmbed[];
    expectedUpdatedAt?: string;
    guildId: string;
    name: string;
    templateId?: string;
}): Result<
    {
        audit?: {
            action: string;
            actorUserId?: string;
            feature: string;
            metadata?: Record<string, unknown>;
        };
        content?: string;
        createdByUserId?: string;
        embeds: OutgoingEmbed[];
        expectedUpdatedAt?: string;
        guildId: string;
        name: string;
        templateId?: string;
    },
    PostingRepositoryError
> {
    const guildId = normalizeRequiredText(input.guildId, 'guildId');
    const name = normalizeRequiredText(input.name, 'name');
    const message = parseOutgoingMessage({
        ...(input.content === undefined ? {} : { content: input.content }),
        embeds: input.embeds ?? [],
    });
    const createdByUserId = normalizeOptionalText(input.createdByUserId);
    const expectedUpdatedAt = normalizeOptionalText(input.expectedUpdatedAt);
    const templateId = normalizeOptionalText(input.templateId);
    if (guildId.isErr()) return err(guildId.error);
    if (name.isErr()) return err(name.error);
    if (message.isErr() && message.error.code === 'empty-message') {
        return err({ field: 'message', type: 'missing-input' });
    }
    if (message.isErr()) return err({ field: 'embeds', type: 'invalid-value' });

    const normalizedInput = {
        embeds: message.value.embeds,
        guildId: guildId.value,
        name: name.value,
        ...(input.audit ? { audit: input.audit } : {}),
        ...(message.value.content ? { content: message.value.content } : {}),
        ...(createdByUserId ? { createdByUserId } : {}),
        ...(expectedUpdatedAt ? { expectedUpdatedAt } : {}),
        ...(templateId ? { templateId } : {}),
    };

    return ok(normalizedInput);
}

function normalizePostedMessageInput(input: {
    channelId: string;
    createdByUserId?: string;
    guildId: string;
    messageId: string;
    purpose?: string;
    templateId?: string;
}): Result<
    {
        channelId: string;
        createdByUserId?: string;
        guildId: string;
        messageId: string;
        purpose?: string;
        templateId?: string;
    },
    PostingRepositoryError
> {
    const guildId = normalizeRequiredText(input.guildId, 'guildId');
    const channelId = normalizeRequiredText(input.channelId, 'channelId');
    const messageId = normalizeRequiredText(input.messageId, 'messageId');
    const createdByUserId = normalizeOptionalText(input.createdByUserId);
    const purpose = normalizeOptionalText(input.purpose);
    const templateId = normalizeOptionalText(input.templateId);

    if (guildId.isErr()) return err(guildId.error);
    if (channelId.isErr()) return err(channelId.error);
    if (messageId.isErr()) return err(messageId.error);

    const normalizedInput = {
        channelId: channelId.value,
        guildId: guildId.value,
        messageId: messageId.value,
        ...(createdByUserId ? { createdByUserId } : {}),
        ...(purpose ? { purpose } : {}),
        ...(templateId ? { templateId } : {}),
    };

    return ok(normalizedInput);
}

function normalizeTemplateLimit(limit: number | undefined): number {
    if (!limit || !Number.isFinite(limit)) {
        return 50;
    }

    return Math.min(Math.max(Math.trunc(limit), 1), 100);
}

function normalizeRequiredText(
    value: string | null | undefined,
    field: string
): Result<string, GuildFeatureRepositoryError> {
    const normalizedValue = value?.trim();

    if (!normalizedValue) {
        return err({ field, type: 'missing-input' });
    }

    return ok(normalizedValue);
}

function normalizeOptionalText(value: string | null | undefined): string | undefined {
    const normalizedValue = value?.trim();

    return normalizedValue && normalizedValue.length > 0 ? normalizedValue : undefined;
}

function mapPostingMutationError(errorValue: unknown): PostingRepositoryError {
    const message = errorValue instanceof Error ? errorValue.message : String(errorValue);

    if (message.includes('template-name-conflict')) {
        return { field: 'name', type: 'conflict' };
    }

    if (message.includes('template-version-conflict')) {
        return { field: 'updatedAt', type: 'conflict' };
    }

    if (message.includes('template-not-found')) {
        return { type: 'not-found' };
    }

    return { type: 'database-error' };
}

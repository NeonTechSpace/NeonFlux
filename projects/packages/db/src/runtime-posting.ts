import { api } from '@neonflux/convex-api';
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
    embeds: unknown[];
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

export type DashboardPostingOperationBegin = {
    messageId?: string;
    sentChannelId?: string;
    shouldSend: boolean;
    status: 'unknown' | 'sent';
};

export async function beginDashboardPostingOperation(
    db: PostingDb,
    input: {
        actorUserId: string;
        guildId: string;
        payloadHash: string;
        requestKey: string;
        requestedChannelId: string;
    }
): Promise<Result<DashboardPostingOperationBegin, PostingRepositoryError>> {
    const normalized = normalizeDashboardPostingOperationInput(input);
    if (normalized.isErr()) return err(normalized.error);

    try {
        return ok(await db.client.mutation(api.posting.beginDashboardPostingOperation, normalized.value));
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function completeDashboardPostingOperation(
    db: PostingDb,
    input: {
        actorUserId: string;
        auditMetadata?: Record<string, unknown>;
        guildId: string;
        messageId: string;
        payloadHash: string;
        requestKey: string;
        sentChannelId: string;
    }
): Promise<Result<PostedMessageRecord, PostingRepositoryError>> {
    const normalized = normalizeDashboardPostingOperationInput({
        actorUserId: input.actorUserId,
        guildId: input.guildId,
        payloadHash: input.payloadHash,
        requestKey: input.requestKey,
        requestedChannelId: input.sentChannelId,
    });
    const messageId = normalizeRequiredText(input.messageId, 'messageId');
    if (normalized.isErr()) return err(normalized.error);
    if (messageId.isErr()) return err(messageId.error);

    try {
        const record = await db.client.mutation(api.posting.completeDashboardPostingOperation, {
            actorUserId: normalized.value.actorUserId,
            ...(input.auditMetadata ? { auditMetadata: input.auditMetadata } : {}),
            guildId: normalized.value.guildId,
            messageId: messageId.value,
            payloadHash: normalized.value.payloadHash,
            requestKey: normalized.value.requestKey,
            sentChannelId: normalized.value.requestedChannelId,
        });
        return ok(toPostedMessageRecord(record));
    } catch {
        return err({ type: 'database-error' });
    }
}

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
        embeds?: unknown[];
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
    embeds?: unknown[];
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
        embeds: unknown[];
        expectedUpdatedAt?: string;
        guildId: string;
        name: string;
        templateId?: string;
    },
    PostingRepositoryError
> {
    const guildId = normalizeRequiredText(input.guildId, 'guildId');
    const name = normalizeRequiredText(input.name, 'name');
    const content = normalizeOptionalText(input.content);
    const createdByUserId = normalizeOptionalText(input.createdByUserId);
    const expectedUpdatedAt = normalizeOptionalText(input.expectedUpdatedAt);
    const templateId = normalizeOptionalText(input.templateId);
    const embeds = input.embeds ?? [];

    if (guildId.isErr()) return err(guildId.error);
    if (name.isErr()) return err(name.error);

    if (!content && embeds.length === 0) {
        return err({ field: 'message', type: 'missing-input' });
    }

    const normalizedInput = {
        embeds: [...embeds],
        guildId: guildId.value,
        name: name.value,
        ...(input.audit ? { audit: input.audit } : {}),
        ...(content ? { content } : {}),
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

function normalizeDashboardPostingOperationInput(input: {
    actorUserId: string;
    guildId: string;
    payloadHash: string;
    requestKey: string;
    requestedChannelId: string;
}): Result<
    {
        actorUserId: string;
        guildId: string;
        payloadHash: string;
        requestKey: string;
        requestedChannelId: string;
    },
    PostingRepositoryError
> {
    const actorUserId = normalizeRequiredText(input.actorUserId, 'actorUserId');
    const guildId = normalizeRequiredText(input.guildId, 'guildId');
    const payloadHash = normalizeRequiredText(input.payloadHash, 'payloadHash');
    const requestKey = normalizeRequiredText(input.requestKey, 'requestKey');
    const requestedChannelId = normalizeRequiredText(input.requestedChannelId, 'channelId');

    if (actorUserId.isErr()) return err(actorUserId.error);
    if (guildId.isErr()) return err(guildId.error);
    if (payloadHash.isErr()) return err(payloadHash.error);
    if (requestKey.isErr()) return err(requestKey.error);
    if (requestedChannelId.isErr()) return err(requestedChannelId.error);

    return ok({
        actorUserId: actorUserId.value,
        guildId: guildId.value,
        payloadHash: payloadHash.value,
        requestKey: requestKey.value,
        requestedChannelId: requestedChannelId.value,
    });
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

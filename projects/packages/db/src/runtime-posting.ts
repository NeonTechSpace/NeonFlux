import { api } from '@neonflux/convex/api';
import { err, ok, type Result } from 'neverthrow';

import type {
    GuildFeatureRepositoryError,
    MessageTemplateRecord,
    PostedMessageRecord,
    PostingRepositoryError,
} from './contracts.js';

import type { ConvexDatabase } from './convex.js';

type ConvexQueryReference = Parameters<ConvexDatabase['client']['query']>[0];
type ConvexMutationReference = Parameters<ConvexDatabase['client']['mutation']>[0];

const convexApi = api as unknown as {
    posting: {
        deleteMessageTemplate: ConvexMutationReference;
        listMessageTemplatesByGuildId: ConvexQueryReference;
        readMessageTemplateByName: ConvexQueryReference;
        recordPostedMessage: ConvexMutationReference;
        upsertMessageTemplate: ConvexMutationReference;
    };
};

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

export async function upsertMessageTemplate(
    db: PostingDb,
    input: {
        content?: string;
        createdByUserId?: string;
        embeds?: unknown[];
        guildId: string;
        name: string;
    }
): Promise<Result<MessageTemplateRecord, PostingRepositoryError>> {
    const normalizedInput = normalizeMessageTemplateInput(input);

    if (normalizedInput.isErr()) {
        return err(normalizedInput.error);
    }

    try {
        const template = (await db.client.mutation(
            convexApi.posting.upsertMessageTemplate,
            normalizedInput.value
        )) as ConvexMessageTemplateRecord;

        return ok(toMessageTemplateRecord(template));
    } catch {
        return err({ type: 'database-error' });
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
        const postedMessage = (await db.client.mutation(
            convexApi.posting.recordPostedMessage,
            normalizedInput.value
        )) as ConvexPostedMessageRecord;

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
        const templates = (await db.client.query(convexApi.posting.listMessageTemplatesByGuildId, {
            guildId: guildId.value,
            limit: normalizeTemplateLimit(input.limit),
        })) as ConvexMessageTemplateRecord[];

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
        const template = (await db.client.query(convexApi.posting.readMessageTemplateByName, {
            guildId: guildId.value,
            name: name.value,
        })) as ConvexMessageTemplateRecord | null;

        return template ? ok(toMessageTemplateRecord(template)) : err({ type: 'not-found' });
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function deleteMessageTemplate(
    db: PostingDb,
    input: { guildId: string; templateId: string }
): Promise<Result<MessageTemplateRecord, PostingRepositoryError>> {
    const guildId = normalizeRequiredText(input.guildId, 'guildId');
    const templateId = normalizeRequiredText(input.templateId, 'templateId');

    if (guildId.isErr()) return err(guildId.error);
    if (templateId.isErr()) return err(templateId.error);

    try {
        const template = (await db.client.mutation(convexApi.posting.deleteMessageTemplate, {
            guildId: guildId.value,
            templateId: templateId.value,
        })) as ConvexMessageTemplateRecord | null;

        return template ? ok(toMessageTemplateRecord(template)) : err({ type: 'not-found' });
    } catch {
        return err({ type: 'database-error' });
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
    content?: string;
    createdByUserId?: string;
    embeds?: unknown[];
    guildId: string;
    name: string;
}): Result<
    {
        content?: string;
        createdByUserId?: string;
        embeds: unknown[];
        guildId: string;
        name: string;
    },
    PostingRepositoryError
> {
    const guildId = normalizeRequiredText(input.guildId, 'guildId');
    const name = normalizeRequiredText(input.name, 'name');
    const content = normalizeOptionalText(input.content);
    const createdByUserId = normalizeOptionalText(input.createdByUserId);
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
        ...(content ? { content } : {}),
        ...(createdByUserId ? { createdByUserId } : {}),
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

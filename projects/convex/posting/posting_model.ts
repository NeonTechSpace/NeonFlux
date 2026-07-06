import type { GenericId } from 'convex/values';

export type MessageTemplateInput = {
    content?: string | null;
    createdAt?: string | null;
    createdByUserId?: string | null;
    embeds?: readonly unknown[] | null;
    guildId?: string | null;
    name?: string | null;
    updatedAt?: string | null;
};

export type MessageTemplateDocument = {
    content?: string;
    createdAt: string;
    createdByUserId?: string;
    embeds: unknown[];
    guildId: string;
    name: string;
    updatedAt: string;
};

export type MessageTemplateRecord = {
    content: string | null;
    createdAt: string;
    createdByUserId: string | null;
    embeds: unknown[];
    guildId: string;
    id: string;
    name: string;
    updatedAt: string;
};

export type PostedMessageInput = {
    channelId?: string | null;
    createdAt?: string | null;
    createdByUserId?: string | null;
    guildId?: string | null;
    messageId?: string | null;
    purpose?: string | null;
    templateId?: string | null;
    updatedAt?: string | null;
};

export type PostedMessageDocument = {
    channelId: string;
    createdAt: string;
    createdByUserId?: string;
    guildId: string;
    messageId: string;
    purpose: string;
    templateId?: GenericId<'messageTemplates'>;
    updatedAt: string;
};

export type PostedMessageRecord = {
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

type MissingInputField = 'channelId' | 'guildId' | 'message' | 'messageId' | 'name' | 'templateId';
type InvalidValueField = 'createdAt' | 'embeds' | 'updatedAt';
type MissingInputError<Field extends MissingInputField = MissingInputField> = {
    field: Field;
    type: 'missing-input';
};
type InvalidValueError<Field extends InvalidValueField = InvalidValueField> = {
    field: Field;
    type: 'invalid-value';
};

export type PostingInputError = InvalidValueError | MissingInputError;

export type PostingInputResult<Value, ErrorValue> = { ok: true; value: Value } | { error: ErrorValue; ok: false };

export function buildMessageTemplateDocument(
    input: MessageTemplateInput,
    now: string,
    existing?: Pick<MessageTemplateDocument, 'createdAt' | 'createdByUserId'>
): PostingInputResult<MessageTemplateDocument, PostingInputError> {
    const guildId = normalizeRequiredString(input.guildId, 'guildId');
    const name = normalizeRequiredString(input.name, 'name');
    const content = normalizeOptionalString(input.content);
    const embeds = normalizeEmbeds(input.embeds);
    const createdAt =
        input.createdAt === undefined ? (existing?.createdAt ?? now) : normalizeTimestamp(input.createdAt);
    const updatedAt = input.updatedAt === undefined ? now : normalizeTimestamp(input.updatedAt);

    if (!guildId.ok) return guildId;
    if (!name.ok) return name;
    if (!embeds.ok) return embeds;

    if (!content && embeds.value.length === 0) {
        return { error: { field: 'message', type: 'missing-input' }, ok: false };
    }

    if (!createdAt) {
        return { error: { field: 'createdAt', type: 'invalid-value' }, ok: false };
    }

    if (!updatedAt) {
        return { error: { field: 'updatedAt', type: 'invalid-value' }, ok: false };
    }

    const createdByUserId = existing?.createdByUserId ?? normalizeOptionalString(input.createdByUserId);

    return {
        ok: true,
        value: {
            ...(content ? { content } : {}),
            ...(createdByUserId ? { createdByUserId } : {}),
            createdAt,
            embeds: embeds.value,
            guildId: guildId.value,
            name: name.value,
            updatedAt,
        },
    };
}

export function buildPostedMessageDocument(
    input: PostedMessageInput,
    now: string,
    existing?: Pick<PostedMessageDocument, 'createdAt'>
): PostingInputResult<PostedMessageDocument, PostingInputError> {
    const lookup = normalizePostedMessageLookupInput(input);
    const createdAt =
        input.createdAt === undefined ? (existing?.createdAt ?? now) : normalizeTimestamp(input.createdAt);
    const updatedAt = input.updatedAt === undefined ? now : normalizeTimestamp(input.updatedAt);

    if (!lookup.ok) return lookup;

    if (!createdAt) {
        return { error: { field: 'createdAt', type: 'invalid-value' }, ok: false };
    }

    if (!updatedAt) {
        return { error: { field: 'updatedAt', type: 'invalid-value' }, ok: false };
    }

    const createdByUserId = normalizeOptionalString(input.createdByUserId);
    const templateId = normalizeOptionalString(input.templateId);

    return {
        ok: true,
        value: {
            ...lookup.value,
            ...(createdByUserId ? { createdByUserId } : {}),
            ...(templateId ? { templateId: templateId as GenericId<'messageTemplates'> } : {}),
            createdAt,
            purpose: normalizeOptionalString(input.purpose) ?? 'manual',
            updatedAt,
        },
    };
}

export function normalizePostedMessageLookupInput(input: {
    channelId?: string | null;
    guildId?: string | null;
    messageId?: string | null;
}): PostingInputResult<
    { channelId: string; guildId: string; messageId: string },
    MissingInputError<'channelId' | 'guildId' | 'messageId'>
> {
    const guildId = normalizeRequiredString(input.guildId, 'guildId');
    const channelId = normalizeRequiredString(input.channelId, 'channelId');
    const messageId = normalizeRequiredString(input.messageId, 'messageId');

    if (!guildId.ok) return guildId;
    if (!channelId.ok) return channelId;
    if (!messageId.ok) return messageId;

    return {
        ok: true,
        value: {
            channelId: channelId.value,
            guildId: guildId.value,
            messageId: messageId.value,
        },
    };
}

export function normalizeRequiredGuildId(value: string): PostingInputResult<string, MissingInputError<'guildId'>> {
    return normalizeRequiredString(value, 'guildId');
}

export function normalizeRequiredTemplateId(
    value: string
): PostingInputResult<string, MissingInputError<'templateId'>> {
    return normalizeRequiredString(value, 'templateId');
}

export function normalizeMessageTemplateLimit(limit: number | undefined): number {
    if (limit === undefined || !Number.isFinite(limit)) {
        return 50;
    }

    return Math.min(Math.max(Math.trunc(limit), 1), 100);
}

export function toMessageTemplateRecord(document: MessageTemplateDocument & { _id: string }): MessageTemplateRecord {
    return {
        content: document.content ?? null,
        createdAt: document.createdAt,
        createdByUserId: document.createdByUserId ?? null,
        embeds: document.embeds,
        guildId: document.guildId,
        id: document._id,
        name: document.name,
        updatedAt: document.updatedAt,
    };
}

export function toPostedMessageRecord(document: PostedMessageDocument & { _id: string }): PostedMessageRecord {
    return {
        channelId: document.channelId,
        createdAt: document.createdAt,
        createdByUserId: document.createdByUserId ?? null,
        guildId: document.guildId,
        id: document._id,
        messageId: document.messageId,
        purpose: document.purpose,
        templateId: document.templateId ?? null,
        updatedAt: document.updatedAt,
    };
}

function normalizeRequiredString(
    value: string | null | undefined,
    field: 'channelId'
): PostingInputResult<string, MissingInputError<'channelId'>>;
function normalizeRequiredString(
    value: string | null | undefined,
    field: 'guildId'
): PostingInputResult<string, MissingInputError<'guildId'>>;
function normalizeRequiredString(
    value: string | null | undefined,
    field: 'messageId'
): PostingInputResult<string, MissingInputError<'messageId'>>;
function normalizeRequiredString(
    value: string | null | undefined,
    field: 'name'
): PostingInputResult<string, MissingInputError<'name'>>;
function normalizeRequiredString(
    value: string | null | undefined,
    field: 'templateId'
): PostingInputResult<string, MissingInputError<'templateId'>>;
function normalizeRequiredString(
    value: string | null | undefined,
    field: 'channelId' | 'guildId' | 'messageId' | 'name' | 'templateId'
): PostingInputResult<string, MissingInputError<'channelId' | 'guildId' | 'messageId' | 'name' | 'templateId'>> {
    const normalizedValue = normalizeOptionalString(value);

    return normalizedValue
        ? { ok: true, value: normalizedValue }
        : { error: { field, type: 'missing-input' }, ok: false };
}

function normalizeOptionalString(value: string | null | undefined): string | undefined {
    const normalizedValue = value?.trim();

    return normalizedValue && normalizedValue.length > 0 ? normalizedValue : undefined;
}

function normalizeTimestamp(value: string | null | undefined): string | undefined {
    const parsed = Date.parse(value ?? '');

    if (!Number.isFinite(parsed)) {
        return undefined;
    }

    return new Date(parsed).toISOString();
}

function normalizeEmbeds(
    value: readonly unknown[] | null | undefined
): PostingInputResult<unknown[], InvalidValueError<'embeds'>> {
    if (value === undefined || value === null) {
        return { ok: true, value: [] };
    }

    return isUnknownArray(value)
        ? { ok: true, value: [...value] }
        : { error: { field: 'embeds', type: 'invalid-value' }, ok: false };
}

function isUnknownArray(value: unknown): value is unknown[] {
    return Array.isArray(value);
}

export type VerificationFlowInput = {
    channelId?: string | null;
    createdAt?: string | null;
    emojiKey?: string | null;
    enabled?: boolean | null;
    guildId?: string | null;
    messageId?: string | null;
    updatedAt?: string | null;
    verifiedRoleId?: string | null;
};

export type VerificationFlowDocument = {
    channelId: string;
    createdAt: string;
    emojiKey: string;
    enabled: boolean;
    guildId: string;
    messageId: string;
    updatedAt: string;
    verifiedRoleId: string;
};

export type VerificationFlowRecord = {
    channelId: string;
    createdAt: string;
    emojiKey: string;
    enabled: boolean;
    guildId: string;
    id: string;
    messageId: string;
    updatedAt: string;
    verifiedRoleId: string;
};

export type VerificationRecordInput = {
    guildId?: string | null;
    method?: string | null;
    revokedAt?: string | null;
    userId?: string | null;
    verifiedAt?: string | null;
};

export type VerificationRecordDocument = {
    guildId: string;
    method: string;
    revokedAt?: string;
    userId: string;
    verifiedAt: string;
};

export type VerificationRecord = {
    guildId: string;
    id: string;
    method: string;
    revokedAt: string | null;
    userId: string;
    verifiedAt: string;
};

export type VerificationInputError = {
    field: string;
    type: 'invalid-value' | 'missing-input';
};

export type VerificationInputResult<Value> = { ok: true; value: Value } | { error: VerificationInputError; ok: false };

export function buildVerificationFlowDocument(
    input: VerificationFlowInput,
    now: string,
    existing?: Pick<VerificationFlowDocument, 'createdAt'>
): VerificationInputResult<VerificationFlowDocument> {
    const guildId = normalizeRequiredString(input.guildId, 'guildId');
    const channelId = normalizeRequiredString(input.channelId, 'channelId');
    const messageId = normalizeRequiredString(input.messageId, 'messageId');
    const emojiKey = normalizeRequiredString(input.emojiKey, 'emojiKey');
    const verifiedRoleId = normalizeRequiredString(input.verifiedRoleId, 'verifiedRoleId');
    const createdAt =
        input.createdAt === undefined ? (existing?.createdAt ?? now) : normalizeTimestamp(input.createdAt);
    const updatedAt = input.updatedAt === undefined ? now : normalizeTimestamp(input.updatedAt);

    if (!guildId.ok) return guildId;
    if (!channelId.ok) return channelId;
    if (!messageId.ok) return messageId;
    if (!emojiKey.ok) return emojiKey;
    if (!verifiedRoleId.ok) return verifiedRoleId;
    if (!createdAt) return { error: { field: 'createdAt', type: 'invalid-value' }, ok: false };
    if (!updatedAt) return { error: { field: 'updatedAt', type: 'invalid-value' }, ok: false };

    return {
        ok: true,
        value: {
            channelId: channelId.value,
            createdAt,
            emojiKey: emojiKey.value,
            enabled: input.enabled ?? true,
            guildId: guildId.value,
            messageId: messageId.value,
            updatedAt,
            verifiedRoleId: verifiedRoleId.value,
        },
    };
}

export function buildVerificationRecordDocument(
    input: VerificationRecordInput,
    now: string
): VerificationInputResult<VerificationRecordDocument> {
    const guildId = normalizeRequiredString(input.guildId, 'guildId');
    const userId = normalizeRequiredString(input.userId, 'userId');
    const method = normalizeRequiredString(input.method, 'method');
    const verifiedAt = input.verifiedAt === undefined ? now : normalizeTimestamp(input.verifiedAt);
    const revokedAt = input.revokedAt === undefined ? undefined : normalizeTimestamp(input.revokedAt);

    if (!guildId.ok) return guildId;
    if (!userId.ok) return userId;
    if (!method.ok) return method;
    if (!verifiedAt) return { error: { field: 'verifiedAt', type: 'invalid-value' }, ok: false };
    if (input.revokedAt !== undefined && !revokedAt) {
        return { error: { field: 'revokedAt', type: 'invalid-value' }, ok: false };
    }

    return {
        ok: true,
        value: {
            guildId: guildId.value,
            method: method.value,
            ...(revokedAt ? { revokedAt } : {}),
            userId: userId.value,
            verifiedAt,
        },
    };
}

export function buildVerificationRecordRevokePatch(revokedAt: string): VerificationInputResult<{ revokedAt: string }> {
    const timestamp = normalizeTimestamp(revokedAt);

    return timestamp
        ? { ok: true, value: { revokedAt: timestamp } }
        : { error: { field: 'revokedAt', type: 'invalid-value' }, ok: false };
}

export function normalizeRequiredGuildId(value: string): VerificationInputResult<string> {
    return normalizeRequiredString(value, 'guildId');
}

export function normalizeRequiredMessageId(value: string): VerificationInputResult<string> {
    return normalizeRequiredString(value, 'messageId');
}

export function normalizeRequiredUserId(value: string): VerificationInputResult<string> {
    return normalizeRequiredString(value, 'userId');
}

export function toVerificationFlowRecord(document: VerificationFlowDocument & { _id: string }): VerificationFlowRecord {
    return {
        channelId: document.channelId,
        createdAt: document.createdAt,
        emojiKey: document.emojiKey,
        enabled: document.enabled,
        guildId: document.guildId,
        id: document._id,
        messageId: document.messageId,
        updatedAt: document.updatedAt,
        verifiedRoleId: document.verifiedRoleId,
    };
}

export function toVerificationRecord(document: VerificationRecordDocument & { _id: string }): VerificationRecord {
    return {
        guildId: document.guildId,
        id: document._id,
        method: document.method,
        revokedAt: document.revokedAt ?? null,
        userId: document.userId,
        verifiedAt: document.verifiedAt,
    };
}

function normalizeRequiredString(value: string | null | undefined, field: string): VerificationInputResult<string> {
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

    return Number.isFinite(parsed) ? new Date(parsed).toISOString() : undefined;
}

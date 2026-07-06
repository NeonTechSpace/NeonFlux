import type { GenericId } from 'convex/values';

export const reactionRoleMessageModes = ['normal', 'exclusive'] as const;
export type ReactionRoleMessageMode = (typeof reactionRoleMessageModes)[number];

export const reactionRoleMessageSources = ['existing', 'dashboard'] as const;
export type ReactionRoleMessageSource = (typeof reactionRoleMessageSources)[number];

export type ReactionRoleMessageInput = {
    channelId?: string | null;
    createdAt?: string | null;
    enabled?: boolean | null;
    generateOverview?: boolean | null;
    guildId?: string | null;
    messageContent?: string | null;
    messageEmbeds?: unknown[] | null;
    messageId?: string | null;
    mode?: string | null;
    source?: string | null;
    staleAt?: string | null;
    updatedAt?: string | null;
};

export type ReactionRoleMessageDocument = {
    channelId: string;
    createdAt: string;
    enabled: boolean;
    generateOverview: boolean;
    guildId: string;
    kind: string;
    messageContent?: string;
    messageEmbeds: unknown[];
    messageId: string;
    mode: string;
    source: string;
    staleAt?: string;
    updatedAt: string;
};

export type ReactionRoleMessageRecord = {
    channelId: string;
    createdAt: string;
    enabled: boolean;
    generateOverview: boolean;
    guildId: string;
    id: string;
    kind: string;
    messageContent: string | null;
    messageEmbeds: unknown[];
    messageId: string;
    mode: ReactionRoleMessageMode;
    source: ReactionRoleMessageSource;
    staleAt: string | null;
    updatedAt: string;
};

export type ReactionRoleOptionInput = {
    createdAt?: string | null;
    emojiKey?: string | null;
    position?: number | null;
    reactionRoleMessageId?: string | null;
    roleId?: string | null;
    updatedAt?: string | null;
};

export type ReactionRoleOptionDocument = {
    createdAt: string;
    emojiKey: string;
    position: number;
    reactionRoleMessageId: GenericId<'reactionRoleMessages'>;
    roleId: string;
    updatedAt: string;
};

export type ReactionRoleOptionRecord = {
    createdAt: string;
    emojiKey: string;
    id: string;
    position: number;
    reactionRoleMessageId: string;
    roleId: string;
    updatedAt: string;
};

export type ReactionRoleAssignmentInput = {
    assignedAt?: string | null;
    emojiKey?: string | null;
    guildId?: string | null;
    messageId?: string | null;
    removedAt?: string | null;
    roleId?: string | null;
    userId?: string | null;
};

export type ReactionRoleAssignmentDocument = {
    assignedAt: string;
    emojiKey: string;
    guildId: string;
    messageId: string;
    removedAt?: string;
    roleId: string;
    userId: string;
};

export type ReactionRoleAssignmentRecord = {
    assignedAt: string;
    emojiKey: string;
    guildId: string;
    id: string;
    messageId: string;
    removedAt: string | null;
    roleId: string;
    userId: string;
};

export type ReactionRoleMessageWithOptions = ReactionRoleMessageRecord & {
    options: ReactionRoleOptionRecord[];
};

export type ReactionRoleOptionMatch = {
    message: ReactionRoleMessageRecord;
    option: ReactionRoleOptionRecord;
};

export type ReactionRoleInputError = {
    field: string;
    type: 'invalid-value' | 'missing-input';
};

export type ReactionRoleInputResult<Value> = { ok: true; value: Value } | { error: ReactionRoleInputError; ok: false };

export function buildReactionRoleMessageDocument(
    input: ReactionRoleMessageInput,
    now: string,
    existing?: Pick<ReactionRoleMessageDocument, 'createdAt'>
): ReactionRoleInputResult<ReactionRoleMessageDocument> {
    const guildId = normalizeRequiredString(input.guildId, 'guildId');
    const channelId = normalizeRequiredString(input.channelId, 'channelId');
    const messageId = normalizeRequiredString(input.messageId, 'messageId');
    const mode = normalizeReactionRoleMessageMode(input.mode ?? 'normal');
    const source = normalizeReactionRoleMessageSource(input.source ?? 'existing');
    const messageEmbeds = normalizeArray(input.messageEmbeds ?? []);
    const staleAt =
        input.staleAt === undefined || input.staleAt === null ? undefined : normalizeTimestamp(input.staleAt);
    const createdAt =
        input.createdAt === undefined ? (existing?.createdAt ?? now) : normalizeTimestamp(input.createdAt);
    const updatedAt = input.updatedAt === undefined ? now : normalizeTimestamp(input.updatedAt);

    if (!guildId.ok) return guildId;
    if (!channelId.ok) return channelId;
    if (!messageId.ok) return messageId;
    if (!mode) return { error: { field: 'mode', type: 'invalid-value' }, ok: false };
    if (!source) return { error: { field: 'source', type: 'invalid-value' }, ok: false };
    if (!messageEmbeds) return { error: { field: 'messageEmbeds', type: 'invalid-value' }, ok: false };
    if (input.staleAt !== undefined && input.staleAt !== null && !staleAt) {
        return { error: { field: 'staleAt', type: 'invalid-value' }, ok: false };
    }
    if (!createdAt) return { error: { field: 'createdAt', type: 'invalid-value' }, ok: false };
    if (!updatedAt) return { error: { field: 'updatedAt', type: 'invalid-value' }, ok: false };

    const messageContent = normalizeOptionalString(input.messageContent);

    return {
        ok: true,
        value: {
            channelId: channelId.value,
            createdAt,
            enabled: input.enabled ?? true,
            generateOverview: input.generateOverview ?? false,
            guildId: guildId.value,
            kind: 'reaction_role',
            ...(messageContent ? { messageContent } : {}),
            messageEmbeds,
            messageId: messageId.value,
            mode,
            source,
            ...(staleAt ? { staleAt } : {}),
            updatedAt,
        },
    };
}

export function buildReactionRoleOptionDocument(
    input: ReactionRoleOptionInput,
    now: string,
    existing?: Pick<ReactionRoleOptionDocument, 'createdAt'>
): ReactionRoleInputResult<ReactionRoleOptionDocument> {
    const reactionRoleMessageId = normalizeRequiredString(input.reactionRoleMessageId, 'reactionRoleMessageId');
    const emojiKey = normalizeRequiredString(input.emojiKey, 'emojiKey');
    const roleId = normalizeRequiredString(input.roleId, 'roleId');
    const position = normalizePosition(input.position ?? 0);
    const createdAt =
        input.createdAt === undefined ? (existing?.createdAt ?? now) : normalizeTimestamp(input.createdAt);
    const updatedAt = input.updatedAt === undefined ? now : normalizeTimestamp(input.updatedAt);

    if (!reactionRoleMessageId.ok) return reactionRoleMessageId;
    if (!emojiKey.ok) return emojiKey;
    if (!roleId.ok) return roleId;
    if (position === undefined) return { error: { field: 'position', type: 'invalid-value' }, ok: false };
    if (!createdAt) return { error: { field: 'createdAt', type: 'invalid-value' }, ok: false };
    if (!updatedAt) return { error: { field: 'updatedAt', type: 'invalid-value' }, ok: false };

    return {
        ok: true,
        value: {
            createdAt,
            emojiKey: emojiKey.value,
            position,
            reactionRoleMessageId: reactionRoleMessageId.value as GenericId<'reactionRoleMessages'>,
            roleId: roleId.value,
            updatedAt,
        },
    };
}

export function buildReactionRoleAssignmentDocument(
    input: ReactionRoleAssignmentInput,
    now: string
): ReactionRoleInputResult<ReactionRoleAssignmentDocument> {
    const guildId = normalizeRequiredString(input.guildId, 'guildId');
    const messageId = normalizeRequiredString(input.messageId, 'messageId');
    const userId = normalizeRequiredString(input.userId, 'userId');
    const roleId = normalizeRequiredString(input.roleId, 'roleId');
    const emojiKey = normalizeRequiredString(input.emojiKey, 'emojiKey');
    const assignedAt = input.assignedAt === undefined ? now : normalizeTimestamp(input.assignedAt);
    const removedAt =
        input.removedAt === undefined || input.removedAt === null ? undefined : normalizeTimestamp(input.removedAt);

    if (!guildId.ok) return guildId;
    if (!messageId.ok) return messageId;
    if (!userId.ok) return userId;
    if (!roleId.ok) return roleId;
    if (!emojiKey.ok) return emojiKey;
    if (!assignedAt) return { error: { field: 'assignedAt', type: 'invalid-value' }, ok: false };
    if (input.removedAt !== undefined && input.removedAt !== null && !removedAt) {
        return { error: { field: 'removedAt', type: 'invalid-value' }, ok: false };
    }

    return {
        ok: true,
        value: {
            assignedAt,
            emojiKey: emojiKey.value,
            guildId: guildId.value,
            messageId: messageId.value,
            ...(removedAt ? { removedAt } : {}),
            roleId: roleId.value,
            userId: userId.value,
        },
    };
}

export function normalizeRequiredGuildId(value: string): ReactionRoleInputResult<string> {
    return normalizeRequiredString(value, 'guildId');
}

export function normalizeRequiredMessageId(value: string): ReactionRoleInputResult<string> {
    return normalizeRequiredString(value, 'messageId');
}

export function normalizeRequiredReactionRoleMessageId(value: string): ReactionRoleInputResult<string> {
    return normalizeRequiredString(value, 'reactionRoleMessageId');
}

export function normalizeRequiredEmojiKey(value: string): ReactionRoleInputResult<string> {
    return normalizeRequiredString(value, 'emojiKey');
}

export function normalizeRequiredUserId(value: string): ReactionRoleInputResult<string> {
    return normalizeRequiredString(value, 'userId');
}

export function normalizeRequiredRoleId(value: string): ReactionRoleInputResult<string> {
    return normalizeRequiredString(value, 'roleId');
}

export function normalizeLimit(limit: number | undefined): number {
    if (limit === undefined || !Number.isFinite(limit)) return 100;

    return Math.min(Math.max(Math.trunc(limit), 1), 500);
}

export function toReactionRoleMessageRecord(
    document: ReactionRoleMessageDocument & { _id: string }
): ReactionRoleMessageRecord {
    return {
        channelId: document.channelId,
        createdAt: document.createdAt,
        enabled: document.enabled,
        generateOverview: document.generateOverview,
        guildId: document.guildId,
        id: document._id,
        kind: document.kind,
        messageContent: document.messageContent ?? null,
        messageEmbeds: document.messageEmbeds,
        messageId: document.messageId,
        mode: document.mode === 'exclusive' ? 'exclusive' : 'normal',
        source: document.source === 'dashboard' ? 'dashboard' : 'existing',
        staleAt: document.staleAt ?? null,
        updatedAt: document.updatedAt,
    };
}

export function toReactionRoleOptionRecord(
    document: ReactionRoleOptionDocument & { _id: string }
): ReactionRoleOptionRecord {
    return {
        createdAt: document.createdAt,
        emojiKey: document.emojiKey,
        id: document._id,
        position: document.position,
        reactionRoleMessageId: document.reactionRoleMessageId,
        roleId: document.roleId,
        updatedAt: document.updatedAt,
    };
}

export function toReactionRoleAssignmentRecord(
    document: ReactionRoleAssignmentDocument & { _id: string }
): ReactionRoleAssignmentRecord {
    return {
        assignedAt: document.assignedAt,
        emojiKey: document.emojiKey,
        guildId: document.guildId,
        id: document._id,
        messageId: document.messageId,
        removedAt: document.removedAt ?? null,
        roleId: document.roleId,
        userId: document.userId,
    };
}

function normalizeRequiredString(value: string | null | undefined, field: string): ReactionRoleInputResult<string> {
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

function normalizeArray(value: unknown): unknown[] | undefined {
    return Array.isArray(value) ? value : undefined;
}

function normalizePosition(value: number): number | undefined {
    return Number.isInteger(value) && value >= 0 ? value : undefined;
}

function normalizeReactionRoleMessageMode(value: string | null | undefined): ReactionRoleMessageMode | undefined {
    const normalizedValue = normalizeOptionalString(value);

    return reactionRoleMessageModes.includes(normalizedValue as ReactionRoleMessageMode)
        ? (normalizedValue as ReactionRoleMessageMode)
        : undefined;
}

function normalizeReactionRoleMessageSource(value: string | null | undefined): ReactionRoleMessageSource | undefined {
    const normalizedValue = normalizeOptionalString(value);

    return reactionRoleMessageSources.includes(normalizedValue as ReactionRoleMessageSource)
        ? (normalizedValue as ReactionRoleMessageSource)
        : undefined;
}

import { err, ok, type Result } from 'neverthrow';

import type { GuildFeatureRepositoryError } from './contracts.js';
import {
    reactionRoleMessageModes,
    reactionRoleMessageSources,
    type ReactionRoleAssignmentRecord,
    type ReactionRoleMessageMode,
    type ReactionRoleMessageRecord,
    type ReactionRoleMessageSource,
    type ReactionRoleMessageWithOptions,
    type ReactionRoleOptionRecord,
    type ReactionRolesRepositoryError,
} from './contracts-reaction-roles.js';

type ConvexMessage = Omit<
    ReactionRoleMessageRecord,
    'createdAt' | 'lifecycle' | 'messageContent' | 'pendingOperationId' | 'revision' | 'staleAt' | 'updatedAt'
> & {
    createdAt: string;
    lifecycle?: ReactionRoleMessageRecord['lifecycle'];
    messageContent: string | null;
    pendingOperationId?: string | null;
    revision?: number;
    staleAt: string | null;
    updatedAt: string;
};
type ConvexOption = Omit<ReactionRoleOptionRecord, 'createdAt' | 'updatedAt'> & {
    createdAt: string;
    updatedAt: string;
};
type ConvexAssignment = Omit<
    ReactionRoleAssignmentRecord,
    'assignedAt' | 'desiredState' | 'reactionRoleMessageId' | 'removedAt' | 'status' | 'updatedAt'
> & {
    assignedAt: string;
    desiredState?: ReactionRoleAssignmentRecord['desiredState'];
    reactionRoleMessageId?: string | null;
    removedAt: string | null;
    status?: ReactionRoleAssignmentRecord['status'];
    updatedAt?: string;
};

export function toMessageRecord(record: ConvexMessage): ReactionRoleMessageRecord {
    return {
        ...record,
        createdAt: new Date(record.createdAt),
        lifecycle: record.lifecycle ?? 'ready',
        pendingOperationId: record.pendingOperationId ?? null,
        revision: record.revision ?? 1,
        staleAt: record.staleAt ? new Date(record.staleAt) : null,
        updatedAt: new Date(record.updatedAt),
    };
}

export function toOptionRecord(record: ConvexOption): ReactionRoleOptionRecord {
    return { ...record, createdAt: new Date(record.createdAt), updatedAt: new Date(record.updatedAt) };
}

export function toAssignmentRecord(record: ConvexAssignment): ReactionRoleAssignmentRecord {
    return {
        ...record,
        assignedAt: new Date(record.assignedAt),
        desiredState: record.desiredState ?? (record.removedAt ? 'absent' : 'present'),
        reactionRoleMessageId: record.reactionRoleMessageId ?? null,
        removedAt: record.removedAt ? new Date(record.removedAt) : null,
        status: record.status ?? 'applied',
        updatedAt: new Date(record.updatedAt ?? record.assignedAt),
    };
}

export function toMessageWithOptionsRecord(record: ConvexMessage & { options: ConvexOption[] }) {
    return {
        ...toMessageRecord(record),
        options: record.options.map(toOptionRecord),
    } satisfies ReactionRoleMessageWithOptions;
}

export function normalizeMessageInput(input: {
    channelId: string;
    enabled?: boolean;
    generateOverview?: boolean;
    guildId: string;
    messageContent?: string | null;
    messageEmbeds?: unknown[];
    messageId: string;
    mode?: ReactionRoleMessageMode;
    source?: ReactionRoleMessageSource;
}) {
    const guildId = normalizeRequiredText(input.guildId, 'guildId');
    const channelId = normalizeRequiredText(input.channelId, 'channelId');
    const messageId = normalizeRequiredText(input.messageId, 'messageId');
    const mode = input.mode ?? 'normal';
    const source = input.source ?? 'existing';
    const messageEmbeds = input.messageEmbeds ?? [];
    if (guildId.isErr()) return err(guildId.error);
    if (channelId.isErr()) return err(channelId.error);
    if (messageId.isErr()) return err(messageId.error);
    if (!reactionRoleMessageModes.includes(mode)) return err({ field: 'mode', type: 'invalid-value' } as const);
    if (!reactionRoleMessageSources.includes(source)) return err({ field: 'source', type: 'invalid-value' } as const);
    if (!Array.isArray(messageEmbeds)) return err({ field: 'messageEmbeds', type: 'invalid-value' } as const);
    return ok({
        channelId: channelId.value,
        ...(input.enabled === undefined ? {} : { enabled: input.enabled }),
        ...(input.generateOverview === undefined ? {} : { generateOverview: input.generateOverview }),
        guildId: guildId.value,
        messageContent: input.messageContent?.trim() ?? null,
        messageEmbeds,
        messageId: messageId.value,
        mode,
        source,
    });
}

export function normalizeOptionInput(input: {
    emojiKey: string;
    position?: number;
    reactionRoleMessageId: string;
    roleId: string;
}): Result<
    { emojiKey: string; position?: number; reactionRoleMessageId: string; roleId: string },
    ReactionRolesRepositoryError
> {
    const base = normalizeOptionLookupInput(input);
    const roleId = normalizeRequiredText(input.roleId, 'roleId');
    if (base.isErr()) return err(base.error);
    if (roleId.isErr()) return err(roleId.error);
    if (input.position !== undefined && (!Number.isInteger(input.position) || input.position < 0)) {
        return err({ field: 'position', type: 'invalid-value' });
    }
    return ok({
        ...base.value,
        ...(input.position === undefined ? {} : { position: input.position }),
        roleId: roleId.value,
    });
}

export function normalizeReactionInput(input: { emojiKey?: string; guildId: string; messageId: string }) {
    const guildId = normalizeRequiredText(input.guildId, 'guildId');
    const messageId = normalizeRequiredText(input.messageId, 'messageId');
    if (guildId.isErr()) return err(guildId.error);
    if (messageId.isErr()) return err(messageId.error);
    if (input.emojiKey === undefined) return ok({ guildId: guildId.value, messageId: messageId.value });
    const emojiKey = normalizeRequiredText(input.emojiKey, 'emojiKey');
    if (emojiKey.isErr()) return err(emojiKey.error);
    return ok({ emojiKey: emojiKey.value, guildId: guildId.value, messageId: messageId.value });
}

export function normalizeAssignmentInput(input: {
    emojiKey: string;
    guildId: string;
    messageId: string;
    removedAt?: Date | null;
    roleId: string;
    userId: string;
}) {
    const identity = normalizeAssignmentLookupInput(input);
    const emojiKey = normalizeRequiredText(input.emojiKey, 'emojiKey');
    if (identity.isErr()) return err(identity.error);
    if (emojiKey.isErr()) return err(emojiKey.error);
    return ok({
        ...identity.value,
        emojiKey: emojiKey.value,
        ...(input.removedAt === undefined ? {} : { removedAt: input.removedAt?.toISOString() ?? null }),
    });
}

export function normalizeAssignmentLookupInput(input: {
    guildId: string;
    messageId: string;
    roleId: string;
    userId: string;
}) {
    const guildId = normalizeRequiredText(input.guildId, 'guildId');
    const messageId = normalizeRequiredText(input.messageId, 'messageId');
    const roleId = normalizeRequiredText(input.roleId, 'roleId');
    const userId = normalizeRequiredText(input.userId, 'userId');
    if (guildId.isErr()) return err(guildId.error);
    if (messageId.isErr()) return err(messageId.error);
    if (roleId.isErr()) return err(roleId.error);
    if (userId.isErr()) return err(userId.error);
    return ok({ guildId: guildId.value, messageId: messageId.value, roleId: roleId.value, userId: userId.value });
}

export function normalizeOptionLookupInput(input: { emojiKey: string; reactionRoleMessageId: string }) {
    const messageId = normalizeRequiredText(input.reactionRoleMessageId, 'reactionRoleMessageId');
    const emojiKey = normalizeRequiredText(input.emojiKey, 'emojiKey');
    if (messageId.isErr()) return err(messageId.error);
    if (emojiKey.isErr()) return err(emojiKey.error);
    return ok({ emojiKey: emojiKey.value, reactionRoleMessageId: messageId.value });
}

export function normalizeRequiredText(
    value: string | null | undefined,
    field: string
): Result<string, GuildFeatureRepositoryError> {
    const normalizedValue = value?.trim();
    return normalizedValue ? ok(normalizedValue) : err({ field, type: 'missing-input' });
}

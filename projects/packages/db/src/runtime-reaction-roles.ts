import { api } from '@neonflux/convex/api';
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
    type ReactionRoleOptionMatch,
    type ReactionRoleOptionRecord,
    type ReactionRolesRepositoryError,
} from './contracts-reaction-roles.js';

import type { ConvexDatabase } from './convex.js';

type ConvexQueryReference = Parameters<ConvexDatabase['client']['query']>[0];
type ConvexMutationReference = Parameters<ConvexDatabase['client']['mutation']>[0];

const convexApi = api as unknown as {
    reaction_roles: {
        deleteReactionRoleMessage: ConvexMutationReference;
        deleteReactionRoleOption: ConvexMutationReference;
        findEnabledReactionRoleOptionByReaction: ConvexQueryReference;
        findReactionRoleMessage: ConvexQueryReference;
        findReactionRoleOption: ConvexQueryReference;
        listActiveReactionRoleAssignmentsByGuildMessageUser: ConvexQueryReference;
        listActiveReactionRoleAssignmentsByGuildUser: ConvexQueryReference;
        listReactionRoleMessagesByGuildId: ConvexQueryReference;
        markReactionRoleAssignmentRemoved: ConvexMutationReference;
        markReactionRoleAssignmentsRemovedByMessageUser: ConvexMutationReference;
        upsertReactionRoleAssignment: ConvexMutationReference;
        upsertReactionRoleMessage: ConvexMutationReference;
        upsertReactionRoleOption: ConvexMutationReference;
    };
};

type ReactionRolesDb = ConvexDatabase;

type ConvexReactionRoleMessageRecord = Omit<
    ReactionRoleMessageRecord,
    'createdAt' | 'messageContent' | 'staleAt' | 'updatedAt'
> & {
    createdAt: string;
    messageContent: string | null;
    staleAt: string | null;
    updatedAt: string;
};
type ConvexReactionRoleOptionRecord = Omit<ReactionRoleOptionRecord, 'createdAt' | 'updatedAt'> & {
    createdAt: string;
    updatedAt: string;
};
type ConvexReactionRoleAssignmentRecord = Omit<ReactionRoleAssignmentRecord, 'assignedAt' | 'removedAt'> & {
    assignedAt: string;
    removedAt: string | null;
};
type ConvexReactionRoleMessageWithOptions = ConvexReactionRoleMessageRecord & {
    options: ConvexReactionRoleOptionRecord[];
};
type ConvexReactionRoleOptionMatch = {
    message: ConvexReactionRoleMessageRecord;
    option: ConvexReactionRoleOptionRecord;
};

export async function upsertReactionRoleMessage(
    db: ReactionRolesDb,
    input: {
        channelId: string;
        enabled?: boolean;
        generateOverview?: boolean;
        guildId: string;
        messageContent?: string | null;
        messageEmbeds?: unknown[];
        messageId: string;
        mode?: ReactionRoleMessageMode;
        source?: ReactionRoleMessageSource;
    }
): Promise<Result<ReactionRoleMessageRecord, ReactionRolesRepositoryError>> {
    const normalizedInput = normalizeMessageInput(input);

    if (normalizedInput.isErr()) return err(normalizedInput.error);

    try {
        const message = (await db.client.mutation(
            convexApi.reaction_roles.upsertReactionRoleMessage,
            normalizedInput.value
        )) as ConvexReactionRoleMessageRecord;

        return ok(toMessageRecord(message));
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function upsertReactionRoleOption(
    db: ReactionRolesDb,
    input: { emojiKey: string; position?: number; reactionRoleMessageId: string; roleId: string }
): Promise<Result<ReactionRoleOptionRecord, ReactionRolesRepositoryError>> {
    const normalizedInput = normalizeOptionInput(input);

    if (normalizedInput.isErr()) return err(normalizedInput.error);

    try {
        const option = (await db.client.mutation(
            convexApi.reaction_roles.upsertReactionRoleOption,
            normalizedInput.value
        )) as ConvexReactionRoleOptionRecord;

        return ok(toOptionRecord(option));
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function upsertReactionRoleOptionByMessage(
    db: ReactionRolesDb,
    input: { emojiKey: string; guildId: string; messageId: string; position?: number; roleId: string }
): Promise<Result<ReactionRoleOptionRecord, ReactionRolesRepositoryError>> {
    const messageResult = await findReactionRoleMessage(db, input);

    if (messageResult.isErr()) return err(messageResult.error);

    return upsertReactionRoleOption(db, {
        emojiKey: input.emojiKey,
        ...(input.position === undefined ? {} : { position: input.position }),
        reactionRoleMessageId: messageResult.value.id,
        roleId: input.roleId,
    });
}

export async function listReactionRoleMessagesByGuildId(
    db: ReactionRolesDb,
    input: { guildId: string }
): Promise<Result<ReactionRoleMessageWithOptions[], ReactionRolesRepositoryError>> {
    const guildId = normalizeRequiredText(input.guildId, 'guildId');

    if (guildId.isErr()) return err(guildId.error);

    try {
        const messages = (await db.client.query(convexApi.reaction_roles.listReactionRoleMessagesByGuildId, {
            guildId: guildId.value,
        })) as ConvexReactionRoleMessageWithOptions[];

        return ok(messages.map(toMessageWithOptionsRecord));
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function findReactionRoleMessage(
    db: ReactionRolesDb,
    input: { guildId: string; messageId: string }
): Promise<Result<ReactionRoleMessageRecord, ReactionRolesRepositoryError>> {
    const normalizedInput = normalizeReactionInput(input);

    if (normalizedInput.isErr()) return err(normalizedInput.error);

    try {
        const message = (await db.client.query(
            convexApi.reaction_roles.findReactionRoleMessage,
            normalizedInput.value
        )) as ConvexReactionRoleMessageRecord | null;

        return message ? ok(toMessageRecord(message)) : err({ type: 'not-found' });
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function findEnabledReactionRoleOptionByReaction(
    db: ReactionRolesDb,
    input: { emojiKey: string; guildId: string; messageId: string }
): Promise<Result<ReactionRoleOptionMatch, ReactionRolesRepositoryError>> {
    const normalizedInput = normalizeReactionInput(input);

    if (normalizedInput.isErr()) return err(normalizedInput.error);

    try {
        const match = (await db.client.query(
            convexApi.reaction_roles.findEnabledReactionRoleOptionByReaction,
            normalizedInput.value
        )) as ConvexReactionRoleOptionMatch | null;

        return match
            ? ok({ message: toMessageRecord(match.message), option: toOptionRecord(match.option) })
            : err({ type: 'not-found' });
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function deleteReactionRoleMessage(
    db: ReactionRolesDb,
    input: { guildId: string; messageId: string }
): Promise<Result<ReactionRoleMessageRecord, ReactionRolesRepositoryError>> {
    const normalizedInput = normalizeReactionInput(input);

    if (normalizedInput.isErr()) return err(normalizedInput.error);

    try {
        const message = (await db.client.mutation(
            convexApi.reaction_roles.deleteReactionRoleMessage,
            normalizedInput.value
        )) as ConvexReactionRoleMessageRecord | null;

        return message ? ok(toMessageRecord(message)) : err({ type: 'not-found' });
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function upsertReactionRoleAssignment(
    db: ReactionRolesDb,
    input: {
        emojiKey: string;
        guildId: string;
        messageId: string;
        removedAt?: Date | null;
        roleId: string;
        userId: string;
    }
): Promise<Result<ReactionRoleAssignmentRecord, ReactionRolesRepositoryError>> {
    const normalizedInput = normalizeAssignmentInput(input);

    if (normalizedInput.isErr()) return err(normalizedInput.error);

    try {
        const assignment = (await db.client.mutation(
            convexApi.reaction_roles.upsertReactionRoleAssignment,
            normalizedInput.value
        )) as ConvexReactionRoleAssignmentRecord;

        return ok(toAssignmentRecord(assignment));
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function markReactionRoleAssignmentRemoved(
    db: ReactionRolesDb,
    input: { guildId: string; messageId: string; roleId: string; userId: string }
): Promise<Result<ReactionRoleAssignmentRecord, ReactionRolesRepositoryError>> {
    const normalizedInput = normalizeAssignmentLookupInput(input);

    if (normalizedInput.isErr()) return err(normalizedInput.error);

    try {
        const assignment = (await db.client.mutation(
            convexApi.reaction_roles.markReactionRoleAssignmentRemoved,
            normalizedInput.value
        )) as ConvexReactionRoleAssignmentRecord | null;

        return assignment ? ok(toAssignmentRecord(assignment)) : err({ type: 'not-found' });
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function listActiveReactionRoleAssignmentsByGuildUser(
    db: ReactionRolesDb,
    input: { guildId: string; userId: string }
): Promise<Result<ReactionRoleAssignmentRecord[], ReactionRolesRepositoryError>> {
    const guildId = normalizeRequiredText(input.guildId, 'guildId');
    const userId = normalizeRequiredText(input.userId, 'userId');

    if (guildId.isErr()) return err(guildId.error);
    if (userId.isErr()) return err(userId.error);

    try {
        const assignments = (await db.client.query(
            convexApi.reaction_roles.listActiveReactionRoleAssignmentsByGuildUser,
            {
                guildId: guildId.value,
                userId: userId.value,
            }
        )) as ConvexReactionRoleAssignmentRecord[];

        return ok(assignments.map(toAssignmentRecord));
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function listActiveReactionRoleAssignmentsByGuildMessageUser(
    db: ReactionRolesDb,
    input: { guildId: string; messageId: string; userId: string }
): Promise<Result<ReactionRoleAssignmentRecord[], ReactionRolesRepositoryError>> {
    const guildId = normalizeRequiredText(input.guildId, 'guildId');
    const messageId = normalizeRequiredText(input.messageId, 'messageId');
    const userId = normalizeRequiredText(input.userId, 'userId');

    if (guildId.isErr()) return err(guildId.error);
    if (messageId.isErr()) return err(messageId.error);
    if (userId.isErr()) return err(userId.error);

    try {
        const assignments = (await db.client.query(
            convexApi.reaction_roles.listActiveReactionRoleAssignmentsByGuildMessageUser,
            {
                guildId: guildId.value,
                messageId: messageId.value,
                userId: userId.value,
            }
        )) as ConvexReactionRoleAssignmentRecord[];

        return ok(assignments.map(toAssignmentRecord));
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function markReactionRoleAssignmentsRemovedByMessageUser(
    db: ReactionRolesDb,
    input: { guildId: string; messageId: string; userId: string }
): Promise<Result<ReactionRoleAssignmentRecord[], ReactionRolesRepositoryError>> {
    const guildId = normalizeRequiredText(input.guildId, 'guildId');
    const messageId = normalizeRequiredText(input.messageId, 'messageId');
    const userId = normalizeRequiredText(input.userId, 'userId');

    if (guildId.isErr()) return err(guildId.error);
    if (messageId.isErr()) return err(messageId.error);
    if (userId.isErr()) return err(userId.error);

    try {
        const assignments = (await db.client.mutation(
            convexApi.reaction_roles.markReactionRoleAssignmentsRemovedByMessageUser,
            {
                guildId: guildId.value,
                messageId: messageId.value,
                userId: userId.value,
            }
        )) as ConvexReactionRoleAssignmentRecord[];

        return ok(assignments.map(toAssignmentRecord));
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function deleteReactionRoleOptionByMessage(
    db: ReactionRolesDb,
    input: { emojiKey: string; guildId: string; messageId: string }
): Promise<Result<ReactionRoleOptionRecord, ReactionRolesRepositoryError>> {
    const messageResult = await findReactionRoleMessage(db, input);

    if (messageResult.isErr()) return err(messageResult.error);

    return deleteReactionRoleOption(db, {
        emojiKey: input.emojiKey,
        reactionRoleMessageId: messageResult.value.id,
    });
}

export async function deleteReactionRoleOption(
    db: ReactionRolesDb,
    input: { emojiKey: string; reactionRoleMessageId: string }
): Promise<Result<ReactionRoleOptionRecord, ReactionRolesRepositoryError>> {
    const normalizedInput = normalizeOptionLookupInput(input);

    if (normalizedInput.isErr()) return err(normalizedInput.error);

    try {
        const option = (await db.client.mutation(
            convexApi.reaction_roles.deleteReactionRoleOption,
            normalizedInput.value
        )) as ConvexReactionRoleOptionRecord | null;

        return option ? ok(toOptionRecord(option)) : err({ type: 'not-found' });
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function findReactionRoleOption(
    db: ReactionRolesDb,
    input: { emojiKey: string; reactionRoleMessageId: string }
): Promise<Result<ReactionRoleOptionRecord, ReactionRolesRepositoryError>> {
    const normalizedInput = normalizeOptionLookupInput(input);

    if (normalizedInput.isErr()) return err(normalizedInput.error);

    try {
        const option = (await db.client.query(
            convexApi.reaction_roles.findReactionRoleOption,
            normalizedInput.value
        )) as ConvexReactionRoleOptionRecord | null;

        return option ? ok(toOptionRecord(option)) : err({ type: 'not-found' });
    } catch {
        return err({ type: 'database-error' });
    }
}

function toMessageRecord(record: ConvexReactionRoleMessageRecord): ReactionRoleMessageRecord {
    return {
        ...record,
        createdAt: new Date(record.createdAt),
        messageContent: record.messageContent,
        staleAt: record.staleAt ? new Date(record.staleAt) : null,
        updatedAt: new Date(record.updatedAt),
    };
}

function toOptionRecord(record: ConvexReactionRoleOptionRecord): ReactionRoleOptionRecord {
    return {
        ...record,
        createdAt: new Date(record.createdAt),
        updatedAt: new Date(record.updatedAt),
    };
}

function toAssignmentRecord(record: ConvexReactionRoleAssignmentRecord): ReactionRoleAssignmentRecord {
    return {
        ...record,
        assignedAt: new Date(record.assignedAt),
        removedAt: record.removedAt ? new Date(record.removedAt) : null,
    };
}

function toMessageWithOptionsRecord(record: ConvexReactionRoleMessageWithOptions): ReactionRoleMessageWithOptions {
    return {
        ...toMessageRecord(record),
        options: record.options.map(toOptionRecord),
    };
}

function normalizeMessageInput(input: {
    channelId: string;
    enabled?: boolean;
    generateOverview?: boolean;
    guildId: string;
    messageContent?: string | null;
    messageEmbeds?: unknown[];
    messageId: string;
    mode?: ReactionRoleMessageMode;
    source?: ReactionRoleMessageSource;
}): Result<Record<string, unknown>, ReactionRolesRepositoryError> {
    const guildId = normalizeRequiredText(input.guildId, 'guildId');
    const channelId = normalizeRequiredText(input.channelId, 'channelId');
    const messageId = normalizeRequiredText(input.messageId, 'messageId');
    const mode = input.mode ?? 'normal';
    const source = input.source ?? 'existing';
    const messageEmbeds = input.messageEmbeds ?? [];

    if (guildId.isErr()) return err(guildId.error);
    if (channelId.isErr()) return err(channelId.error);
    if (messageId.isErr()) return err(messageId.error);
    if (!reactionRoleMessageModes.includes(mode)) return err({ field: 'mode', type: 'invalid-value' });
    if (!reactionRoleMessageSources.includes(source)) return err({ field: 'source', type: 'invalid-value' });
    if (!Array.isArray(messageEmbeds)) return err({ field: 'messageEmbeds', type: 'invalid-value' });

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

function normalizeOptionInput(input: {
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

function normalizeReactionInput(input: {
    emojiKey?: string;
    guildId: string;
    messageId: string;
}): Result<{ emojiKey?: string; guildId: string; messageId: string }, ReactionRolesRepositoryError> {
    const guildId = normalizeRequiredText(input.guildId, 'guildId');
    const messageId = normalizeRequiredText(input.messageId, 'messageId');
    let emojiKey: string | undefined;

    if (guildId.isErr()) return err(guildId.error);
    if (messageId.isErr()) return err(messageId.error);

    if (input.emojiKey !== undefined) {
        const emojiKeyResult = normalizeRequiredText(input.emojiKey, 'emojiKey');

        if (emojiKeyResult.isErr()) return err(emojiKeyResult.error);

        emojiKey = emojiKeyResult.value;
    }

    return ok({
        ...(emojiKey ? { emojiKey } : {}),
        guildId: guildId.value,
        messageId: messageId.value,
    });
}

function normalizeAssignmentInput(input: {
    emojiKey: string;
    guildId: string;
    messageId: string;
    removedAt?: Date | null;
    roleId: string;
    userId: string;
}): Result<Record<string, unknown>, ReactionRolesRepositoryError> {
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

function normalizeAssignmentLookupInput(input: {
    guildId: string;
    messageId: string;
    roleId: string;
    userId: string;
}): Result<{ guildId: string; messageId: string; roleId: string; userId: string }, ReactionRolesRepositoryError> {
    const guildId = normalizeRequiredText(input.guildId, 'guildId');
    const messageId = normalizeRequiredText(input.messageId, 'messageId');
    const roleId = normalizeRequiredText(input.roleId, 'roleId');
    const userId = normalizeRequiredText(input.userId, 'userId');

    if (guildId.isErr()) return err(guildId.error);
    if (messageId.isErr()) return err(messageId.error);
    if (roleId.isErr()) return err(roleId.error);
    if (userId.isErr()) return err(userId.error);

    return ok({
        guildId: guildId.value,
        messageId: messageId.value,
        roleId: roleId.value,
        userId: userId.value,
    });
}

function normalizeOptionLookupInput(input: {
    emojiKey: string;
    reactionRoleMessageId: string;
}): Result<{ emojiKey: string; reactionRoleMessageId: string }, ReactionRolesRepositoryError> {
    const reactionRoleMessageId = normalizeRequiredText(input.reactionRoleMessageId, 'reactionRoleMessageId');
    const emojiKey = normalizeRequiredText(input.emojiKey, 'emojiKey');

    if (reactionRoleMessageId.isErr()) return err(reactionRoleMessageId.error);
    if (emojiKey.isErr()) return err(emojiKey.error);

    return ok({
        emojiKey: emojiKey.value,
        reactionRoleMessageId: reactionRoleMessageId.value,
    });
}

function normalizeRequiredText(
    value: string | null | undefined,
    field: string
): Result<string, GuildFeatureRepositoryError> {
    const normalizedValue = value?.trim();

    if (!normalizedValue) return err({ field, type: 'missing-input' });

    return ok(normalizedValue);
}

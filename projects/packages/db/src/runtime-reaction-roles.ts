import { api } from '@neonflux/convex-api';
import { err, ok, type Result } from 'neverthrow';

import type {
    ReactionRoleAssignmentRecord,
    ReactionRoleMessageMode,
    ReactionRoleMessageRecord,
    ReactionRoleMessageSource,
    ReactionRoleMessageWithOptions,
    ReactionRoleOptionMatch,
    ReactionRoleOptionRecord,
    ReactionRolesRepositoryError,
} from './contracts-reaction-roles.js';

import type { ConvexDatabase } from './convex.js';
import { compactConvexArgs } from './convex-args.js';
import {
    normalizeAssignmentInput,
    normalizeAssignmentLookupInput,
    normalizeMessageInput,
    normalizeOptionInput,
    normalizeOptionLookupInput,
    normalizeReactionInput,
    normalizeRequiredText,
    toAssignmentRecord,
    toMessageRecord,
    toMessageWithOptionsRecord,
    toOptionRecord,
} from './runtime-reaction-role-codecs.js';

type ReactionRolesDb = ConvexDatabase;

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
        const message = await db.client.mutation(
            api.reaction_roles.upsertReactionRoleMessage,
            compactConvexArgs(normalizedInput.value)
        );

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
        const option = await db.client.mutation(api.reaction_roles.upsertReactionRoleOption, normalizedInput.value);

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
        const messages = await db.client.query(api.reaction_roles.listReactionRoleMessagesByGuildId, {
            guildId: guildId.value,
        });

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
        const message = await db.client.query(api.reaction_roles.findReactionRoleMessage, normalizedInput.value);

        return message ? ok(toMessageRecord(message)) : err({ type: 'not-found' });
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function findReactionRoleMessageWithOptions(
    db: ReactionRolesDb,
    input: { guildId: string; messageId: string }
): Promise<Result<ReactionRoleMessageWithOptions, ReactionRolesRepositoryError>> {
    const normalizedInput = normalizeReactionInput(input);
    if (normalizedInput.isErr()) return err(normalizedInput.error);
    try {
        const message = await db.client.query(
            api.reaction_roles.findReactionRoleMessageWithOptions,
            normalizedInput.value
        );
        return message ? ok(toMessageWithOptionsRecord(message)) : err({ type: 'not-found' });
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function findEnabledReactionRoleOptionByReaction(
    db: ReactionRolesDb,
    input: { emojiKey: string; guildId: string; messageId: string }
): Promise<Result<ReactionRoleOptionMatch, ReactionRolesRepositoryError>> {
    const normalizedInput = normalizeReactionInput(input);
    const emojiKey = normalizeRequiredText(input.emojiKey, 'emojiKey');

    if (normalizedInput.isErr()) return err(normalizedInput.error);
    if (emojiKey.isErr()) return err(emojiKey.error);

    try {
        const match = await db.client.query(api.reaction_roles.findEnabledReactionRoleOptionByReaction, {
            guildId: normalizedInput.value.guildId,
            messageId: normalizedInput.value.messageId,
            emojiKey: emojiKey.value,
        });

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
        const message = await db.client.mutation(api.reaction_roles.deleteReactionRoleMessage, normalizedInput.value);

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
        const assignment = await db.client.mutation(
            api.reaction_roles.upsertReactionRoleAssignment,
            normalizedInput.value
        );

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
        const assignment = await db.client.mutation(
            api.reaction_roles.markReactionRoleAssignmentRemoved,
            normalizedInput.value
        );

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
        const assignments = await db.client.query(api.reaction_roles.listActiveReactionRoleAssignmentsByGuildUser, {
            guildId: guildId.value,
            userId: userId.value,
        });

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
        const assignments = await db.client.query(
            api.reaction_roles.listActiveReactionRoleAssignmentsByGuildMessageUser,
            {
                guildId: guildId.value,
                messageId: messageId.value,
                userId: userId.value,
            }
        );

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
        const assignments = await db.client.mutation(
            api.reaction_roles.markReactionRoleAssignmentsRemovedByMessageUser,
            {
                guildId: guildId.value,
                messageId: messageId.value,
                userId: userId.value,
            }
        );

        return ok(assignments.map(toAssignmentRecord));
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function deleteReactionRoleOption(
    db: ReactionRolesDb,
    input: { emojiKey: string; reactionRoleMessageId: string }
): Promise<Result<ReactionRoleOptionRecord, ReactionRolesRepositoryError>> {
    const normalizedInput = normalizeOptionLookupInput(input);

    if (normalizedInput.isErr()) return err(normalizedInput.error);

    try {
        const option = await db.client.mutation(api.reaction_roles.deleteReactionRoleOption, normalizedInput.value);

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
        const option = await db.client.query(api.reaction_roles.findReactionRoleOption, normalizedInput.value);

        return option ? ok(toOptionRecord(option)) : err({ type: 'not-found' });
    } catch {
        return err({ type: 'database-error' });
    }
}

import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import { err, ok, type Result } from 'neverthrow';

import {
    normalizeRequiredText,
    type GuildFeatureRepositoryDatabase,
    type GuildFeatureRepositoryError,
} from './feature-repository-types.js';
import { reactionRoleAssignments, reactionRoleMessages, reactionRoleOptions } from './schema.js';

export type ReactionRoleMessageRecord = typeof reactionRoleMessages.$inferSelect;
export type ReactionRoleOptionRecord = typeof reactionRoleOptions.$inferSelect;
export type ReactionRoleAssignmentRecord = typeof reactionRoleAssignments.$inferSelect;
export type ReactionRolesRepositoryError = GuildFeatureRepositoryError;
export type ReactionRoleMessageWithOptions = ReactionRoleMessageRecord & {
    options: ReactionRoleOptionRecord[];
};
export type ReactionRoleOptionMatch = {
    message: ReactionRoleMessageRecord;
    option: ReactionRoleOptionRecord;
};

export async function upsertReactionRoleMessage(
    db: GuildFeatureRepositoryDatabase,
    input: {
        guildId: string;
        channelId: string;
        messageId: string;
        removeOnUnreact?: boolean;
        enabled?: boolean;
    }
): Promise<Result<ReactionRoleMessageRecord, ReactionRolesRepositoryError>> {
    const guildId = normalizeRequiredText(input.guildId, 'guildId');
    const channelId = normalizeRequiredText(input.channelId, 'channelId');
    const messageId = normalizeRequiredText(input.messageId, 'messageId');
    const updatedAt = new Date();

    if (guildId.isErr()) return err(guildId.error);
    if (channelId.isErr()) return err(channelId.error);
    if (messageId.isErr()) return err(messageId.error);

    try {
        const rows = await db
            .insert(reactionRoleMessages)
            .values({
                guildId: guildId.value,
                channelId: channelId.value,
                messageId: messageId.value,
                removeOnUnreact: input.removeOnUnreact ?? true,
                enabled: input.enabled ?? true,
                updatedAt,
            })
            .onConflictDoUpdate({
                target: [reactionRoleMessages.guildId, reactionRoleMessages.messageId],
                set: {
                    channelId: channelId.value,
                    removeOnUnreact: input.removeOnUnreact ?? true,
                    enabled: input.enabled ?? true,
                    staleAt: null,
                    updatedAt,
                },
            })
            .returning();
        const row = rows[0];

        return row ? ok(row) : err({ type: 'database-error' });
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function upsertReactionRoleOption(
    db: GuildFeatureRepositoryDatabase,
    input: { reactionRoleMessageId: string; emojiKey: string; roleId: string }
): Promise<Result<ReactionRoleOptionRecord, ReactionRolesRepositoryError>> {
    const reactionRoleMessageId = normalizeRequiredText(input.reactionRoleMessageId, 'reactionRoleMessageId');
    const emojiKey = normalizeRequiredText(input.emojiKey, 'emojiKey');
    const roleId = normalizeRequiredText(input.roleId, 'roleId');
    const updatedAt = new Date();

    if (reactionRoleMessageId.isErr()) return err(reactionRoleMessageId.error);
    if (emojiKey.isErr()) return err(emojiKey.error);
    if (roleId.isErr()) return err(roleId.error);

    try {
        const rows = await db
            .insert(reactionRoleOptions)
            .values({
                reactionRoleMessageId: reactionRoleMessageId.value,
                emojiKey: emojiKey.value,
                roleId: roleId.value,
                updatedAt,
            })
            .onConflictDoUpdate({
                target: [reactionRoleOptions.reactionRoleMessageId, reactionRoleOptions.emojiKey],
                set: {
                    roleId: roleId.value,
                    updatedAt,
                },
            })
            .returning();
        const row = rows[0];

        return row ? ok(row) : err({ type: 'database-error' });
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function upsertReactionRoleOptionByMessage(
    db: GuildFeatureRepositoryDatabase,
    input: { guildId: string; messageId: string; emojiKey: string; roleId: string }
): Promise<Result<ReactionRoleOptionRecord, ReactionRolesRepositoryError>> {
    const messageResult = await findReactionRoleMessage(db, {
        guildId: input.guildId,
        messageId: input.messageId,
    });

    if (messageResult.isErr()) {
        return err(messageResult.error);
    }

    return upsertReactionRoleOption(db, {
        reactionRoleMessageId: messageResult.value.id,
        emojiKey: input.emojiKey,
        roleId: input.roleId,
    });
}

export async function listReactionRoleMessagesByGuildId(
    db: GuildFeatureRepositoryDatabase,
    input: { guildId: string }
): Promise<Result<ReactionRoleMessageWithOptions[], ReactionRolesRepositoryError>> {
    const guildId = normalizeRequiredText(input.guildId, 'guildId');

    if (guildId.isErr()) return err(guildId.error);

    try {
        const messages = await db
            .select()
            .from(reactionRoleMessages)
            .where(eq(reactionRoleMessages.guildId, guildId.value))
            .orderBy(asc(reactionRoleMessages.channelId), asc(reactionRoleMessages.messageId));
        const messageIds = messages.map((message) => message.id);
        const options =
            messageIds.length > 0
                ? await db
                      .select()
                      .from(reactionRoleOptions)
                      .where(inArray(reactionRoleOptions.reactionRoleMessageId, messageIds))
                      .orderBy(asc(reactionRoleOptions.emojiKey))
                : [];
        const optionsByMessageId = new Map<string, ReactionRoleOptionRecord[]>();

        for (const option of options) {
            const existingOptions = optionsByMessageId.get(option.reactionRoleMessageId) ?? [];
            existingOptions.push(option);
            optionsByMessageId.set(option.reactionRoleMessageId, existingOptions);
        }

        return ok(
            messages.map((message) => ({
                ...message,
                options: optionsByMessageId.get(message.id) ?? [],
            }))
        );
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function findReactionRoleMessage(
    db: GuildFeatureRepositoryDatabase,
    input: { guildId: string; messageId: string }
): Promise<Result<ReactionRoleMessageRecord, ReactionRolesRepositoryError>> {
    const guildId = normalizeRequiredText(input.guildId, 'guildId');
    const messageId = normalizeRequiredText(input.messageId, 'messageId');

    if (guildId.isErr()) return err(guildId.error);
    if (messageId.isErr()) return err(messageId.error);

    try {
        const rows = await db
            .select()
            .from(reactionRoleMessages)
            .where(
                and(
                    eq(reactionRoleMessages.guildId, guildId.value),
                    eq(reactionRoleMessages.messageId, messageId.value)
                )
            )
            .limit(1);
        const row = rows[0];

        return row ? ok(row) : err({ type: 'not-found' });
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function findEnabledReactionRoleOptionByReaction(
    db: GuildFeatureRepositoryDatabase,
    input: { guildId: string; messageId: string; emojiKey: string }
): Promise<Result<ReactionRoleOptionMatch, ReactionRolesRepositoryError>> {
    const guildId = normalizeRequiredText(input.guildId, 'guildId');
    const messageId = normalizeRequiredText(input.messageId, 'messageId');
    const emojiKey = normalizeRequiredText(input.emojiKey, 'emojiKey');

    if (guildId.isErr()) return err(guildId.error);
    if (messageId.isErr()) return err(messageId.error);
    if (emojiKey.isErr()) return err(emojiKey.error);

    try {
        const rows = await db
            .select({
                message: reactionRoleMessages,
                option: reactionRoleOptions,
            })
            .from(reactionRoleMessages)
            .innerJoin(reactionRoleOptions, eq(reactionRoleOptions.reactionRoleMessageId, reactionRoleMessages.id))
            .where(
                and(
                    eq(reactionRoleMessages.guildId, guildId.value),
                    eq(reactionRoleMessages.messageId, messageId.value),
                    eq(reactionRoleMessages.enabled, true),
                    isNull(reactionRoleMessages.staleAt),
                    eq(reactionRoleOptions.emojiKey, emojiKey.value)
                )
            )
            .limit(1);
        const row = rows[0];

        return row ? ok(row) : err({ type: 'not-found' });
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function upsertReactionRoleAssignment(
    db: GuildFeatureRepositoryDatabase,
    input: {
        guildId: string;
        messageId: string;
        userId: string;
        roleId: string;
        emojiKey: string;
        removedAt?: Date | null;
    }
): Promise<Result<ReactionRoleAssignmentRecord, ReactionRolesRepositoryError>> {
    const guildId = normalizeRequiredText(input.guildId, 'guildId');
    const messageId = normalizeRequiredText(input.messageId, 'messageId');
    const userId = normalizeRequiredText(input.userId, 'userId');
    const roleId = normalizeRequiredText(input.roleId, 'roleId');
    const emojiKey = normalizeRequiredText(input.emojiKey, 'emojiKey');

    if (guildId.isErr()) return err(guildId.error);
    if (messageId.isErr()) return err(messageId.error);
    if (userId.isErr()) return err(userId.error);
    if (roleId.isErr()) return err(roleId.error);
    if (emojiKey.isErr()) return err(emojiKey.error);

    try {
        const assignedAt = new Date();
        const rows = await db
            .insert(reactionRoleAssignments)
            .values({
                guildId: guildId.value,
                messageId: messageId.value,
                userId: userId.value,
                roleId: roleId.value,
                emojiKey: emojiKey.value,
                assignedAt,
                removedAt: input.removedAt ?? null,
            })
            .onConflictDoUpdate({
                target: [
                    reactionRoleAssignments.guildId,
                    reactionRoleAssignments.messageId,
                    reactionRoleAssignments.userId,
                    reactionRoleAssignments.roleId,
                ],
                set: {
                    emojiKey: emojiKey.value,
                    assignedAt,
                    removedAt: input.removedAt ?? null,
                },
            })
            .returning();
        const row = rows[0];

        return row ? ok(row) : err({ type: 'database-error' });
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function markReactionRoleAssignmentRemoved(
    db: GuildFeatureRepositoryDatabase,
    input: { guildId: string; messageId: string; userId: string; roleId: string }
): Promise<Result<ReactionRoleAssignmentRecord, ReactionRolesRepositoryError>> {
    const guildId = normalizeRequiredText(input.guildId, 'guildId');
    const messageId = normalizeRequiredText(input.messageId, 'messageId');
    const userId = normalizeRequiredText(input.userId, 'userId');
    const roleId = normalizeRequiredText(input.roleId, 'roleId');

    if (guildId.isErr()) return err(guildId.error);
    if (messageId.isErr()) return err(messageId.error);
    if (userId.isErr()) return err(userId.error);
    if (roleId.isErr()) return err(roleId.error);

    try {
        const rows = await db
            .update(reactionRoleAssignments)
            .set({ removedAt: new Date() })
            .where(
                and(
                    eq(reactionRoleAssignments.guildId, guildId.value),
                    eq(reactionRoleAssignments.messageId, messageId.value),
                    eq(reactionRoleAssignments.userId, userId.value),
                    eq(reactionRoleAssignments.roleId, roleId.value)
                )
            )
            .returning();
        const row = rows[0];

        return row ? ok(row) : err({ type: 'not-found' });
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function listActiveReactionRoleAssignmentsByGuildUser(
    db: GuildFeatureRepositoryDatabase,
    input: { guildId: string; userId: string }
): Promise<Result<ReactionRoleAssignmentRecord[], ReactionRolesRepositoryError>> {
    const guildId = normalizeRequiredText(input.guildId, 'guildId');
    const userId = normalizeRequiredText(input.userId, 'userId');

    if (guildId.isErr()) return err(guildId.error);
    if (userId.isErr()) return err(userId.error);

    try {
        const rows = await db
            .select()
            .from(reactionRoleAssignments)
            .where(
                and(
                    eq(reactionRoleAssignments.guildId, guildId.value),
                    eq(reactionRoleAssignments.userId, userId.value),
                    isNull(reactionRoleAssignments.removedAt)
                )
            )
            .orderBy(asc(reactionRoleAssignments.roleId));

        return ok(rows);
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function deleteReactionRoleMessage(
    db: GuildFeatureRepositoryDatabase,
    input: { guildId: string; messageId: string }
): Promise<Result<ReactionRoleMessageRecord, ReactionRolesRepositoryError>> {
    const guildId = normalizeRequiredText(input.guildId, 'guildId');
    const messageId = normalizeRequiredText(input.messageId, 'messageId');

    if (guildId.isErr()) return err(guildId.error);
    if (messageId.isErr()) return err(messageId.error);

    try {
        const rows = await db
            .delete(reactionRoleMessages)
            .where(
                and(
                    eq(reactionRoleMessages.guildId, guildId.value),
                    eq(reactionRoleMessages.messageId, messageId.value)
                )
            )
            .returning();
        const row = rows[0];

        return row ? ok(row) : err({ type: 'not-found' });
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function deleteReactionRoleOptionByMessage(
    db: GuildFeatureRepositoryDatabase,
    input: { guildId: string; messageId: string; emojiKey: string }
): Promise<Result<ReactionRoleOptionRecord, ReactionRolesRepositoryError>> {
    const messageResult = await findReactionRoleMessage(db, {
        guildId: input.guildId,
        messageId: input.messageId,
    });

    if (messageResult.isErr()) {
        return err(messageResult.error);
    }

    return deleteReactionRoleOption(db, {
        reactionRoleMessageId: messageResult.value.id,
        emojiKey: input.emojiKey,
    });
}

export async function deleteReactionRoleOption(
    db: GuildFeatureRepositoryDatabase,
    input: { reactionRoleMessageId: string; emojiKey: string }
): Promise<Result<ReactionRoleOptionRecord, ReactionRolesRepositoryError>> {
    const reactionRoleMessageId = normalizeRequiredText(input.reactionRoleMessageId, 'reactionRoleMessageId');
    const emojiKey = normalizeRequiredText(input.emojiKey, 'emojiKey');

    if (reactionRoleMessageId.isErr()) return err(reactionRoleMessageId.error);
    if (emojiKey.isErr()) return err(emojiKey.error);

    try {
        const rows = await db
            .delete(reactionRoleOptions)
            .where(
                and(
                    eq(reactionRoleOptions.reactionRoleMessageId, reactionRoleMessageId.value),
                    eq(reactionRoleOptions.emojiKey, emojiKey.value)
                )
            )
            .returning();
        const row = rows[0];

        return row ? ok(row) : err({ type: 'not-found' });
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function findReactionRoleOption(
    db: GuildFeatureRepositoryDatabase,
    input: { reactionRoleMessageId: string; emojiKey: string }
): Promise<Result<ReactionRoleOptionRecord, ReactionRolesRepositoryError>> {
    const reactionRoleMessageId = normalizeRequiredText(input.reactionRoleMessageId, 'reactionRoleMessageId');
    const emojiKey = normalizeRequiredText(input.emojiKey, 'emojiKey');

    if (reactionRoleMessageId.isErr()) return err(reactionRoleMessageId.error);
    if (emojiKey.isErr()) return err(emojiKey.error);

    try {
        const rows = await db
            .select()
            .from(reactionRoleOptions)
            .where(
                and(
                    eq(reactionRoleOptions.reactionRoleMessageId, reactionRoleMessageId.value),
                    eq(reactionRoleOptions.emojiKey, emojiKey.value)
                )
            )
            .limit(1);
        const row = rows[0];

        return row ? ok(row) : err({ type: 'not-found' });
    } catch {
        return err({ type: 'database-error' });
    }
}

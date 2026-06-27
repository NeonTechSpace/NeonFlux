import { and, asc, eq, isNull } from 'drizzle-orm';
import { err, ok, type Result } from 'neverthrow';

import {
    normalizeRequiredText,
    type GuildFeatureRepositoryDatabase,
    type GuildFeatureRepositoryError,
} from './feature-repository-types.js';
import { verificationFlows, verificationRecords } from './schema.js';

export type VerificationRecord = typeof verificationRecords.$inferSelect;
export type VerificationFlowRecord = typeof verificationFlows.$inferSelect;
export type VerificationRepositoryError = GuildFeatureRepositoryError;

export async function upsertVerificationFlow(
    db: GuildFeatureRepositoryDatabase,
    input: {
        guildId: string;
        channelId: string;
        messageId: string;
        emojiKey: string;
        verifiedRoleId: string;
        enabled?: boolean;
    }
): Promise<Result<VerificationFlowRecord, VerificationRepositoryError>> {
    const guildId = normalizeRequiredText(input.guildId, 'guildId');
    const channelId = normalizeRequiredText(input.channelId, 'channelId');
    const messageId = normalizeRequiredText(input.messageId, 'messageId');
    const emojiKey = normalizeRequiredText(input.emojiKey, 'emojiKey');
    const verifiedRoleId = normalizeRequiredText(input.verifiedRoleId, 'verifiedRoleId');
    const updatedAt = new Date();

    if (guildId.isErr()) return err(guildId.error);
    if (channelId.isErr()) return err(channelId.error);
    if (messageId.isErr()) return err(messageId.error);
    if (emojiKey.isErr()) return err(emojiKey.error);
    if (verifiedRoleId.isErr()) return err(verifiedRoleId.error);

    try {
        const rows = await db
            .insert(verificationFlows)
            .values({
                guildId: guildId.value,
                channelId: channelId.value,
                messageId: messageId.value,
                emojiKey: emojiKey.value,
                verifiedRoleId: verifiedRoleId.value,
                enabled: input.enabled ?? true,
                updatedAt,
            })
            .onConflictDoUpdate({
                target: [verificationFlows.guildId, verificationFlows.messageId],
                set: {
                    channelId: channelId.value,
                    emojiKey: emojiKey.value,
                    verifiedRoleId: verifiedRoleId.value,
                    enabled: input.enabled ?? true,
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

export async function listVerificationFlowsByGuildId(
    db: GuildFeatureRepositoryDatabase,
    input: { guildId: string; enabled?: boolean }
): Promise<Result<VerificationFlowRecord[], VerificationRepositoryError>> {
    const guildId = normalizeRequiredText(input.guildId, 'guildId');

    if (guildId.isErr()) return err(guildId.error);

    try {
        const rows = await db
            .select()
            .from(verificationFlows)
            .where(
                input.enabled === undefined
                    ? eq(verificationFlows.guildId, guildId.value)
                    : and(eq(verificationFlows.guildId, guildId.value), eq(verificationFlows.enabled, input.enabled))
            )
            .orderBy(asc(verificationFlows.channelId), asc(verificationFlows.messageId));

        return ok(rows);
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function findEnabledVerificationFlowByReaction(
    db: GuildFeatureRepositoryDatabase,
    input: { guildId: string; messageId: string; emojiKey: string }
): Promise<Result<VerificationFlowRecord, VerificationRepositoryError>> {
    const guildId = normalizeRequiredText(input.guildId, 'guildId');
    const messageId = normalizeRequiredText(input.messageId, 'messageId');
    const emojiKey = normalizeRequiredText(input.emojiKey, 'emojiKey');

    if (guildId.isErr()) return err(guildId.error);
    if (messageId.isErr()) return err(messageId.error);
    if (emojiKey.isErr()) return err(emojiKey.error);

    try {
        const rows = await db
            .select()
            .from(verificationFlows)
            .where(
                and(
                    eq(verificationFlows.guildId, guildId.value),
                    eq(verificationFlows.messageId, messageId.value),
                    eq(verificationFlows.emojiKey, emojiKey.value),
                    eq(verificationFlows.enabled, true)
                )
            )
            .limit(1);
        const row = rows[0];

        return row ? ok(row) : err({ type: 'not-found' });
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function deleteVerificationFlow(
    db: GuildFeatureRepositoryDatabase,
    input: { guildId: string; messageId: string }
): Promise<Result<VerificationFlowRecord, VerificationRepositoryError>> {
    const guildId = normalizeRequiredText(input.guildId, 'guildId');
    const messageId = normalizeRequiredText(input.messageId, 'messageId');

    if (guildId.isErr()) return err(guildId.error);
    if (messageId.isErr()) return err(messageId.error);

    try {
        const rows = await db
            .delete(verificationFlows)
            .where(and(eq(verificationFlows.guildId, guildId.value), eq(verificationFlows.messageId, messageId.value)))
            .returning();
        const row = rows[0];

        return row ? ok(row) : err({ type: 'not-found' });
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function upsertVerificationRecord(
    db: GuildFeatureRepositoryDatabase,
    input: { guildId: string; userId: string; method: string }
): Promise<Result<VerificationRecord, VerificationRepositoryError>> {
    const guildId = normalizeRequiredText(input.guildId, 'guildId');
    const userId = normalizeRequiredText(input.userId, 'userId');
    const method = normalizeRequiredText(input.method, 'method');

    if (guildId.isErr()) return err(guildId.error);
    if (userId.isErr()) return err(userId.error);
    if (method.isErr()) return err(method.error);

    try {
        const rows = await db
            .insert(verificationRecords)
            .values({
                guildId: guildId.value,
                userId: userId.value,
                method: method.value,
                revokedAt: null,
            })
            .onConflictDoUpdate({
                target: [verificationRecords.guildId, verificationRecords.userId],
                set: {
                    method: method.value,
                    verifiedAt: new Date(),
                    revokedAt: null,
                },
            })
            .returning();
        const row = rows[0];

        return row ? ok(row) : err({ type: 'database-error' });
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function revokeVerificationRecord(
    db: GuildFeatureRepositoryDatabase,
    input: { guildId: string; userId: string }
): Promise<Result<VerificationRecord, VerificationRepositoryError>> {
    const guildId = normalizeRequiredText(input.guildId, 'guildId');
    const userId = normalizeRequiredText(input.userId, 'userId');

    if (guildId.isErr()) return err(guildId.error);
    if (userId.isErr()) return err(userId.error);

    try {
        const rows = await db
            .update(verificationRecords)
            .set({ revokedAt: new Date() })
            .where(and(eq(verificationRecords.guildId, guildId.value), eq(verificationRecords.userId, userId.value)))
            .returning();
        const row = rows[0];

        return row ? ok(row) : err({ type: 'not-found' });
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function findActiveVerificationRecord(
    db: GuildFeatureRepositoryDatabase,
    input: { guildId: string; userId: string }
): Promise<Result<VerificationRecord, VerificationRepositoryError>> {
    const guildId = normalizeRequiredText(input.guildId, 'guildId');
    const userId = normalizeRequiredText(input.userId, 'userId');

    if (guildId.isErr()) return err(guildId.error);
    if (userId.isErr()) return err(userId.error);

    try {
        const rows = await db
            .select()
            .from(verificationRecords)
            .where(
                and(
                    eq(verificationRecords.guildId, guildId.value),
                    eq(verificationRecords.userId, userId.value),
                    isNull(verificationRecords.revokedAt)
                )
            )
            .limit(1);
        const row = rows[0];

        return row ? ok(row) : err({ type: 'not-found' });
    } catch {
        return err({ type: 'database-error' });
    }
}

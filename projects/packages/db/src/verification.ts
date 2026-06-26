import { and, eq } from 'drizzle-orm';
import { err, ok, type Result } from 'neverthrow';

import {
    normalizeRequiredText,
    type GuildFeatureRepositoryDatabase,
    type GuildFeatureRepositoryError,
} from './feature-repository-types.js';
import { verificationRecords } from './schema.js';

export type VerificationRecord = typeof verificationRecords.$inferSelect;
export type VerificationRepositoryError = GuildFeatureRepositoryError;

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

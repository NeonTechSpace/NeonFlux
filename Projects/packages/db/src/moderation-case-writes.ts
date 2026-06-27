import { sql } from 'drizzle-orm';

import type { GuildFeatureRepositoryDatabase } from './feature-repository-types.js';
import { moderationCaseCounters, moderationCases } from './schema.js';
import type { ModerationCaseRecord } from './moderation.js';

export type InsertModerationCaseInput = {
    guildId: string;
    caseNumber: number;
    action: string;
    targetType: 'user' | 'channel';
    targetUserId?: string;
    targetChannelId?: string;
    actorUserId?: string;
    reason?: string;
    status?: string;
};

export async function allocateModerationCaseNumber(
    db: GuildFeatureRepositoryDatabase,
    guildId: string
): Promise<number> {
    const rows = await db
        .insert(moderationCaseCounters)
        .values({
            guildId,
            nextCaseNumber: 2,
        })
        .onConflictDoUpdate({
            target: moderationCaseCounters.guildId,
            set: {
                nextCaseNumber: sql`${moderationCaseCounters.nextCaseNumber} + 1`,
                updatedAt: new Date(),
            },
        })
        .returning({
            nextCaseNumber: moderationCaseCounters.nextCaseNumber,
        });
    const row = rows[0];

    if (!row) {
        throw new Error('Could not allocate moderation case number.');
    }

    return row.nextCaseNumber - 1;
}

export async function advanceModerationCaseCounter(
    db: GuildFeatureRepositoryDatabase,
    guildId: string,
    nextCaseNumber: number
): Promise<void> {
    await db
        .insert(moderationCaseCounters)
        .values({
            guildId,
            nextCaseNumber,
        })
        .onConflictDoUpdate({
            target: moderationCaseCounters.guildId,
            set: {
                nextCaseNumber: sql`greatest(${moderationCaseCounters.nextCaseNumber}, ${nextCaseNumber})`,
                updatedAt: new Date(),
            },
        });
}

export async function insertModerationCase(
    db: GuildFeatureRepositoryDatabase,
    input: InsertModerationCaseInput
): Promise<ModerationCaseRecord[]> {
    return await db
        .insert(moderationCases)
        .values({
            guildId: input.guildId,
            caseNumber: input.caseNumber,
            action: input.action,
            targetType: input.targetType,
            targetUserId: input.targetUserId,
            targetChannelId: input.targetChannelId,
            actorUserId: input.actorUserId,
            reason: input.reason,
            status: input.status,
        })
        .returning();
}

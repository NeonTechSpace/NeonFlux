import { eq } from 'drizzle-orm';
import { err, ok, type Result } from 'neverthrow';

import {
    assertAllowedStatusTransition,
    normalizeOptionalText,
    normalizeRequiredPositiveInteger,
    normalizeRequiredText,
    type GuildFeatureRepositoryDatabase,
    type GuildFeatureRepositoryError,
} from './feature-repository-types.js';
import { moderationCaseEvents, moderationCases, moderationTemporaryActions } from './schema.js';

export type ModerationCaseRecord = typeof moderationCases.$inferSelect;
export type ModerationCaseEventRecord = typeof moderationCaseEvents.$inferSelect;
export type ModerationTemporaryActionRecord = typeof moderationTemporaryActions.$inferSelect;
export type ModerationRepositoryError = GuildFeatureRepositoryError;

const caseStatusTransitions = new Map<string, readonly string[]>([
    ['open', ['resolved', 'void']],
    ['resolved', []],
    ['void', []],
]);

export async function createModerationCase(
    db: GuildFeatureRepositoryDatabase,
    input: {
        guildId: string;
        caseNumber: number;
        action: string;
        targetUserId: string;
        actorUserId?: string;
        reason?: string;
    }
): Promise<Result<ModerationCaseRecord, ModerationRepositoryError>> {
    const guildId = normalizeRequiredText(input.guildId, 'guildId');
    const caseNumber = normalizeRequiredPositiveInteger(input.caseNumber, 'caseNumber');
    const action = normalizeRequiredText(input.action, 'action');
    const targetUserId = normalizeRequiredText(input.targetUserId, 'targetUserId');

    if (guildId.isErr()) return err(guildId.error);
    if (caseNumber.isErr()) return err(caseNumber.error);
    if (action.isErr()) return err(action.error);
    if (targetUserId.isErr()) return err(targetUserId.error);

    try {
        const rows = await db
            .insert(moderationCases)
            .values({
                guildId: guildId.value,
                caseNumber: caseNumber.value,
                action: action.value,
                targetUserId: targetUserId.value,
                actorUserId: normalizeOptionalText(input.actorUserId),
                reason: normalizeOptionalText(input.reason),
            })
            .returning();
        const row = rows[0];

        return row ? ok(row) : err({ type: 'database-error' });
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function recordModerationCaseEvent(
    db: GuildFeatureRepositoryDatabase,
    input: {
        caseId: string;
        eventType: string;
        actorUserId?: string;
        details?: Record<string, unknown>;
    }
): Promise<Result<ModerationCaseEventRecord, ModerationRepositoryError>> {
    const caseId = normalizeRequiredText(input.caseId, 'caseId');
    const eventType = normalizeRequiredText(input.eventType, 'eventType');

    if (caseId.isErr()) return err(caseId.error);
    if (eventType.isErr()) return err(eventType.error);

    try {
        const rows = await db
            .insert(moderationCaseEvents)
            .values({
                caseId: caseId.value,
                eventType: eventType.value,
                actorUserId: normalizeOptionalText(input.actorUserId),
                details: input.details ?? {},
            })
            .returning();
        const row = rows[0];

        return row ? ok(row) : err({ type: 'database-error' });
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function updateModerationCaseStatus(
    db: GuildFeatureRepositoryDatabase,
    input: { caseId: string; status: string }
): Promise<Result<ModerationCaseRecord, ModerationRepositoryError>> {
    const caseId = normalizeRequiredText(input.caseId, 'caseId');
    const status = normalizeRequiredText(input.status, 'status');

    if (caseId.isErr()) return err(caseId.error);
    if (status.isErr()) return err(status.error);

    try {
        const existingRows = await db
            .select()
            .from(moderationCases)
            .where(eq(moderationCases.id, caseId.value))
            .limit(1);
        const existing = existingRows[0];

        if (!existing) {
            return err({ type: 'not-found' });
        }

        const transition = assertAllowedStatusTransition(existing.status, status.value, caseStatusTransitions);

        if (transition.isErr()) {
            return err(transition.error);
        }

        const rows = await db
            .update(moderationCases)
            .set({
                status: status.value,
                updatedAt: new Date(),
            })
            .where(eq(moderationCases.id, caseId.value))
            .returning();
        const row = rows[0];

        return row ? ok(row) : err({ type: 'database-error' });
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function createModerationTemporaryAction(
    db: GuildFeatureRepositoryDatabase,
    input: {
        guildId: string;
        action: string;
        targetUserId: string;
        expiresAt: Date;
        caseId?: string;
    }
): Promise<Result<ModerationTemporaryActionRecord, ModerationRepositoryError>> {
    const guildId = normalizeRequiredText(input.guildId, 'guildId');
    const action = normalizeRequiredText(input.action, 'action');
    const targetUserId = normalizeRequiredText(input.targetUserId, 'targetUserId');

    if (guildId.isErr()) return err(guildId.error);
    if (action.isErr()) return err(action.error);
    if (targetUserId.isErr()) return err(targetUserId.error);

    try {
        const rows = await db
            .insert(moderationTemporaryActions)
            .values({
                guildId: guildId.value,
                action: action.value,
                targetUserId: targetUserId.value,
                expiresAt: input.expiresAt,
                caseId: normalizeOptionalText(input.caseId),
            })
            .returning();
        const row = rows[0];

        return row ? ok(row) : err({ type: 'database-error' });
    } catch {
        return err({ type: 'database-error' });
    }
}

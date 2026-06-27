import { and, asc, eq, gt, lte, ne } from 'drizzle-orm';
import { err, ok, type Result } from 'neverthrow';

import {
    assertAllowedStatusTransition,
    normalizeOptionalText,
    normalizeRequiredPositiveInteger,
    normalizeRequiredText,
    type GuildFeatureRepositoryDatabase,
    type GuildFeatureRepositoryError,
} from './feature-repository-types.js';
import { moderationTemporaryActions } from './schema.js';

export type ModerationTemporaryActionRecord = typeof moderationTemporaryActions.$inferSelect;
export type ModerationTemporaryActionStatus = 'pending' | 'completed' | 'failed' | 'cancelled';
export type ModerationTemporaryActionRepositoryError = GuildFeatureRepositoryError;

const temporaryActionStatusTransitions = new Map<string, readonly string[]>([
    ['pending', ['completed', 'failed', 'cancelled']],
    ['completed', []],
    ['failed', []],
    ['cancelled', []],
]);

export async function createModerationTemporaryAction(
    db: GuildFeatureRepositoryDatabase,
    input: {
        guildId: string;
        action: string;
        targetUserId: string;
        expiresAt: Date;
        caseId?: string;
    }
): Promise<Result<ModerationTemporaryActionRecord, ModerationTemporaryActionRepositoryError>> {
    const normalizedInput = normalizeTemporaryActionInput(input);

    if (normalizedInput.isErr()) {
        return err(normalizedInput.error);
    }

    try {
        const rows = await db
            .insert(moderationTemporaryActions)
            .values({
                guildId: normalizedInput.value.guildId,
                action: normalizedInput.value.action,
                targetUserId: normalizedInput.value.targetUserId,
                expiresAt: normalizedInput.value.expiresAt,
                caseId: normalizedInput.value.caseId,
            })
            .returning();
        const row = rows[0];

        return row ? ok(row) : err({ type: 'database-error' });
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function findPendingModerationTemporaryActionByTarget(
    db: GuildFeatureRepositoryDatabase,
    input: {
        guildId: string;
        action: string;
        targetUserId: string;
        now?: Date;
    }
): Promise<Result<ModerationTemporaryActionRecord, ModerationTemporaryActionRepositoryError>> {
    const normalizedInput = normalizeTemporaryActionTargetInput(input);

    if (normalizedInput.isErr()) {
        return err(normalizedInput.error);
    }

    const now = input.now ?? new Date();
    const nowResult = normalizeDate(now, 'now');

    if (nowResult.isErr()) {
        return err(nowResult.error);
    }

    try {
        const rows = await db
            .select()
            .from(moderationTemporaryActions)
            .where(
                and(
                    eq(moderationTemporaryActions.guildId, normalizedInput.value.guildId),
                    eq(moderationTemporaryActions.action, normalizedInput.value.action),
                    eq(moderationTemporaryActions.targetUserId, normalizedInput.value.targetUserId),
                    eq(moderationTemporaryActions.status, 'pending'),
                    gt(moderationTemporaryActions.expiresAt, nowResult.value)
                )
            )
            .orderBy(asc(moderationTemporaryActions.expiresAt))
            .limit(1);
        const row = rows[0];

        return row ? ok(row) : err({ type: 'not-found' });
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function listDueModerationTemporaryActions(
    db: GuildFeatureRepositoryDatabase,
    input: {
        now: Date;
        action?: string;
        limit?: number;
    }
): Promise<Result<ModerationTemporaryActionRecord[], ModerationTemporaryActionRepositoryError>> {
    const now = normalizeDate(input.now, 'now');
    const limit = normalizeRequiredPositiveInteger(input.limit ?? 25, 'limit');

    if (now.isErr()) return err(now.error);
    if (limit.isErr()) return err(limit.error);

    const action = normalizeOptionalText(input.action);

    try {
        const rows = await db
            .select()
            .from(moderationTemporaryActions)
            .where(
                and(
                    eq(moderationTemporaryActions.status, 'pending'),
                    lte(moderationTemporaryActions.expiresAt, now.value),
                    ...(action ? [eq(moderationTemporaryActions.action, action)] : [])
                )
            )
            .orderBy(asc(moderationTemporaryActions.expiresAt))
            .limit(Math.min(limit.value, 100));

        return ok(rows);
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function cancelPendingModerationTemporaryActionsByTarget(
    db: GuildFeatureRepositoryDatabase,
    input: {
        guildId: string;
        action: string;
        targetUserId: string;
        excludeId?: string;
    }
): Promise<Result<ModerationTemporaryActionRecord[], ModerationTemporaryActionRepositoryError>> {
    const normalizedInput = normalizeTemporaryActionTargetInput(input);

    if (normalizedInput.isErr()) {
        return err(normalizedInput.error);
    }

    const excludeId = normalizeOptionalText(input.excludeId);

    try {
        const rows = await db
            .update(moderationTemporaryActions)
            .set({
                status: 'cancelled',
                updatedAt: new Date(),
            })
            .where(
                and(
                    eq(moderationTemporaryActions.guildId, normalizedInput.value.guildId),
                    eq(moderationTemporaryActions.action, normalizedInput.value.action),
                    eq(moderationTemporaryActions.targetUserId, normalizedInput.value.targetUserId),
                    eq(moderationTemporaryActions.status, 'pending'),
                    ...(excludeId ? [ne(moderationTemporaryActions.id, excludeId)] : [])
                )
            )
            .returning();

        return ok(rows);
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function updateModerationTemporaryActionStatus(
    db: GuildFeatureRepositoryDatabase,
    input: {
        id: string;
        status: ModerationTemporaryActionStatus;
    }
): Promise<Result<ModerationTemporaryActionRecord, ModerationTemporaryActionRepositoryError>> {
    const id = normalizeRequiredText(input.id, 'id');
    const status = normalizeTemporaryActionStatus(input.status);

    if (id.isErr()) return err(id.error);
    if (status.isErr()) return err(status.error);

    try {
        const existingRows = await db
            .select()
            .from(moderationTemporaryActions)
            .where(eq(moderationTemporaryActions.id, id.value))
            .limit(1);
        const existing = existingRows[0];

        if (!existing) {
            return err({ type: 'not-found' });
        }

        const transition = assertAllowedStatusTransition(
            existing.status,
            status.value,
            temporaryActionStatusTransitions
        );

        if (transition.isErr()) {
            return err(transition.error);
        }

        const rows = await db
            .update(moderationTemporaryActions)
            .set({
                status: status.value,
                updatedAt: new Date(),
            })
            .where(eq(moderationTemporaryActions.id, id.value))
            .returning();
        const row = rows[0];

        return row ? ok(row) : err({ type: 'database-error' });
    } catch {
        return err({ type: 'database-error' });
    }
}

function normalizeTemporaryActionInput(input: {
    guildId: string;
    action: string;
    targetUserId: string;
    expiresAt: Date;
    caseId?: string;
}): Result<
    {
        guildId: string;
        action: string;
        targetUserId: string;
        expiresAt: Date;
        caseId?: string;
    },
    ModerationTemporaryActionRepositoryError
> {
    const targetInput = normalizeTemporaryActionTargetInput(input);
    const expiresAt = normalizeDate(input.expiresAt, 'expiresAt');

    if (targetInput.isErr()) return err(targetInput.error);
    if (expiresAt.isErr()) return err(expiresAt.error);

    const caseId = normalizeOptionalText(input.caseId);

    return ok({
        ...targetInput.value,
        expiresAt: expiresAt.value,
        ...(caseId ? { caseId } : {}),
    });
}

function normalizeTemporaryActionTargetInput(input: { guildId: string; action: string; targetUserId: string }): Result<
    {
        guildId: string;
        action: string;
        targetUserId: string;
    },
    ModerationTemporaryActionRepositoryError
> {
    const guildId = normalizeRequiredText(input.guildId, 'guildId');
    const action = normalizeRequiredText(input.action, 'action');
    const targetUserId = normalizeRequiredText(input.targetUserId, 'targetUserId');

    if (guildId.isErr()) return err(guildId.error);
    if (action.isErr()) return err(action.error);
    if (targetUserId.isErr()) return err(targetUserId.error);

    return ok({
        guildId: guildId.value,
        action: action.value,
        targetUserId: targetUserId.value,
    });
}

function normalizeTemporaryActionStatus(
    status: string
): Result<ModerationTemporaryActionStatus, ModerationTemporaryActionRepositoryError> {
    const normalizedStatus = normalizeRequiredText(status, 'status');

    if (normalizedStatus.isErr()) {
        return err(normalizedStatus.error);
    }

    if (!temporaryActionStatusTransitions.has(normalizedStatus.value)) {
        return err({ type: 'invalid-value', field: 'status' });
    }

    return ok(normalizedStatus.value as ModerationTemporaryActionStatus);
}

function normalizeDate(value: Date, field: string): Result<Date, ModerationTemporaryActionRepositoryError> {
    if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
        return err({ type: 'invalid-value', field });
    }

    return ok(value);
}

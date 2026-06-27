import { and, desc, eq, sql } from 'drizzle-orm';
import { err, ok, type Result } from 'neverthrow';

import {
    assertAllowedStatusTransition,
    normalizeOptionalText,
    normalizeRequiredPositiveInteger,
    normalizeRequiredText,
    type GuildFeatureRepositoryDatabase,
    type GuildFeatureRepositoryError,
} from './feature-repository-types.js';
import { moderationCaseCounters, moderationCaseEvents, moderationCases, moderationTemporaryActions } from './schema.js';

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
        caseNumber?: number;
        action: string;
        targetUserId: string;
        actorUserId?: string;
        reason?: string;
    }
): Promise<Result<ModerationCaseRecord, ModerationRepositoryError>> {
    const guildId = normalizeRequiredText(input.guildId, 'guildId');
    const action = normalizeRequiredText(input.action, 'action');
    const targetUserId = normalizeRequiredText(input.targetUserId, 'targetUserId');

    if (guildId.isErr()) return err(guildId.error);
    if (action.isErr()) return err(action.error);
    if (targetUserId.isErr()) return err(targetUserId.error);

    let caseNumber: number | undefined;

    if (input.caseNumber !== undefined) {
        const caseNumberResult = normalizeRequiredPositiveInteger(input.caseNumber, 'caseNumber');

        if (caseNumberResult.isErr()) {
            return err(caseNumberResult.error);
        }

        caseNumber = caseNumberResult.value;
    }

    const actorUserId = normalizeOptionalText(input.actorUserId);
    const reason = normalizeOptionalText(input.reason);

    try {
        const rows =
            caseNumber !== undefined
                ? await db.transaction(async (tx) => {
                      const insertedRows = await insertModerationCase(tx, {
                          guildId: guildId.value,
                          caseNumber,
                          action: action.value,
                          targetUserId: targetUserId.value,
                          ...(actorUserId ? { actorUserId } : {}),
                          ...(reason ? { reason } : {}),
                      });

                      await advanceModerationCaseCounter(tx, guildId.value, caseNumber + 1);

                      return insertedRows;
                  })
                : await db.transaction(async (tx) => {
                      const nextCaseNumber = await allocateModerationCaseNumber(tx, guildId.value);

                      return insertModerationCase(tx, {
                          guildId: guildId.value,
                          caseNumber: nextCaseNumber,
                          action: action.value,
                          targetUserId: targetUserId.value,
                          ...(actorUserId ? { actorUserId } : {}),
                          ...(reason ? { reason } : {}),
                      });
                  });
        const row = rows[0];

        return row ? ok(row) : err({ type: 'database-error' });
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function findModerationCaseByGuildCaseNumber(
    db: GuildFeatureRepositoryDatabase,
    input: { guildId: string; caseNumber: number }
): Promise<Result<ModerationCaseRecord, ModerationRepositoryError>> {
    const guildId = normalizeRequiredText(input.guildId, 'guildId');
    const caseNumber = normalizeRequiredPositiveInteger(input.caseNumber, 'caseNumber');

    if (guildId.isErr()) return err(guildId.error);
    if (caseNumber.isErr()) return err(caseNumber.error);

    try {
        const rows = await db
            .select()
            .from(moderationCases)
            .where(and(eq(moderationCases.guildId, guildId.value), eq(moderationCases.caseNumber, caseNumber.value)))
            .limit(1);
        const row = rows[0];

        return row ? ok(row) : err({ type: 'not-found' });
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function listModerationCasesByGuildId(
    db: GuildFeatureRepositoryDatabase,
    input: {
        guildId: string;
        targetUserId?: string;
        action?: string;
        status?: string;
        limit?: number;
    }
): Promise<Result<ModerationCaseRecord[], ModerationRepositoryError>> {
    const guildId = normalizeRequiredText(input.guildId, 'guildId');
    const limit = normalizeRequiredPositiveInteger(input.limit ?? 5, 'limit');

    if (guildId.isErr()) return err(guildId.error);
    if (limit.isErr()) return err(limit.error);

    const targetUserId = normalizeOptionalText(input.targetUserId);
    const action = normalizeOptionalText(input.action);
    const status = normalizeOptionalText(input.status);
    const conditions = [
        eq(moderationCases.guildId, guildId.value),
        ...(targetUserId ? [eq(moderationCases.targetUserId, targetUserId)] : []),
        ...(action ? [eq(moderationCases.action, action)] : []),
        ...(status ? [eq(moderationCases.status, status)] : []),
    ];

    try {
        const rows = await db
            .select()
            .from(moderationCases)
            .where(and(...conditions))
            .orderBy(desc(moderationCases.caseNumber))
            .limit(Math.min(limit.value, 100));

        return ok(rows);
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

export async function listModerationCaseEventsByCaseId(
    db: GuildFeatureRepositoryDatabase,
    input: { caseId: string; eventType?: string; limit?: number }
): Promise<Result<ModerationCaseEventRecord[], ModerationRepositoryError>> {
    const caseId = normalizeRequiredText(input.caseId, 'caseId');
    const limit = normalizeRequiredPositiveInteger(input.limit ?? 10, 'limit');

    if (caseId.isErr()) return err(caseId.error);
    if (limit.isErr()) return err(limit.error);

    const eventType = normalizeOptionalText(input.eventType);
    const conditions = [
        eq(moderationCaseEvents.caseId, caseId.value),
        ...(eventType ? [eq(moderationCaseEvents.eventType, eventType)] : []),
    ];

    try {
        const rows = await db
            .select()
            .from(moderationCaseEvents)
            .where(and(...conditions))
            .orderBy(desc(moderationCaseEvents.createdAt))
            .limit(Math.min(limit.value, 25));

        return ok(rows);
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

export async function updateModerationCaseReason(
    db: GuildFeatureRepositoryDatabase,
    input: { caseId: string; actorUserId?: string; reason: string }
): Promise<Result<ModerationCaseRecord, ModerationRepositoryError>> {
    const caseId = normalizeRequiredText(input.caseId, 'caseId');
    const reason = normalizeRequiredText(input.reason, 'reason');

    if (caseId.isErr()) return err(caseId.error);
    if (reason.isErr()) return err(reason.error);

    try {
        const rows = await db.transaction(async (tx) => {
            const updatedRows = await tx
                .update(moderationCases)
                .set({
                    reason: reason.value,
                    updatedAt: new Date(),
                })
                .where(eq(moderationCases.id, caseId.value))
                .returning();
            const updatedRow = updatedRows[0];

            if (!updatedRow) {
                return [];
            }

            await tx.insert(moderationCaseEvents).values({
                caseId: caseId.value,
                eventType: 'reason.updated',
                actorUserId: normalizeOptionalText(input.actorUserId),
                details: {
                    reason: reason.value,
                },
            });

            return updatedRows;
        });
        const row = rows[0];

        return row ? ok(row) : err({ type: 'not-found' });
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function voidModerationCase(
    db: GuildFeatureRepositoryDatabase,
    input: { caseId: string; actorUserId?: string; reason?: string }
): Promise<Result<ModerationCaseRecord, ModerationRepositoryError>> {
    const caseId = normalizeRequiredText(input.caseId, 'caseId');

    if (caseId.isErr()) return err(caseId.error);

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

        if (existing.status !== 'open') {
            return err({ type: 'invalid-status-transition', from: existing.status, to: 'void' });
        }

        const voidReason = normalizeOptionalText(input.reason);
        const rows = await db.transaction(async (tx) => {
            const updatedRows = await tx
                .update(moderationCases)
                .set({
                    status: 'void',
                    updatedAt: new Date(),
                })
                .where(eq(moderationCases.id, caseId.value))
                .returning();

            await tx.insert(moderationCaseEvents).values({
                caseId: caseId.value,
                eventType: 'case.voided',
                actorUserId: normalizeOptionalText(input.actorUserId),
                details: {
                    ...(voidReason ? { reason: voidReason } : {}),
                },
            });

            return updatedRows;
        });
        const row = rows[0];

        return row ? ok(row) : err({ type: 'database-error' });
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function addModerationCaseNote(
    db: GuildFeatureRepositoryDatabase,
    input: { caseId: string; actorUserId?: string; note: string }
): Promise<Result<ModerationCaseEventRecord, ModerationRepositoryError>> {
    const note = normalizeRequiredText(input.note, 'note');

    if (note.isErr()) return err(note.error);

    return recordModerationCaseEvent(db, {
        caseId: input.caseId,
        eventType: 'note.added',
        ...(input.actorUserId ? { actorUserId: input.actorUserId } : {}),
        details: {
            note: note.value,
        },
    });
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

async function allocateModerationCaseNumber(db: GuildFeatureRepositoryDatabase, guildId: string): Promise<number> {
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

async function advanceModerationCaseCounter(
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

async function insertModerationCase(
    db: GuildFeatureRepositoryDatabase,
    input: {
        guildId: string;
        caseNumber: number;
        action: string;
        targetUserId: string;
        actorUserId?: string;
        reason?: string;
    }
): Promise<ModerationCaseRecord[]> {
    return await db
        .insert(moderationCases)
        .values({
            guildId: input.guildId,
            caseNumber: input.caseNumber,
            action: input.action,
            targetUserId: input.targetUserId,
            actorUserId: input.actorUserId,
            reason: input.reason,
        })
        .returning();
}

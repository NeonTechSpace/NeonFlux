import { eq } from 'drizzle-orm';
import { err, ok, type Result } from 'neverthrow';

import {
    assertAllowedStatusTransition,
    normalizeOptionalText,
    normalizeRequiredText,
    type GuildFeatureRepositoryDatabase,
    type GuildFeatureRepositoryError,
} from './feature-repository-types.js';
import { structureExportSnapshots, structureImportActions, structureImportRuns } from './schema.js';

export type StructureExportSnapshotRecord = typeof structureExportSnapshots.$inferSelect;
export type StructureImportRunRecord = typeof structureImportRuns.$inferSelect;
export type StructureImportActionRecord = typeof structureImportActions.$inferSelect;
export type StructureImportExportRepositoryError = GuildFeatureRepositoryError;

const importRunStatusTransitions = new Map<string, readonly string[]>([
    ['draft', ['dry_run_complete', 'cancelled']],
    ['dry_run_complete', ['confirmed', 'cancelled']],
    ['confirmed', ['applying', 'cancelled']],
    ['applying', ['applied', 'failed']],
    ['applied', []],
    ['cancelled', []],
    ['failed', []],
]);

export async function createStructureExportSnapshot(
    db: GuildFeatureRepositoryDatabase,
    input: {
        guildId: string;
        snapshot: Record<string, unknown>;
        createdByUserId?: string;
        source?: string;
    }
): Promise<Result<StructureExportSnapshotRecord, StructureImportExportRepositoryError>> {
    const guildId = normalizeRequiredText(input.guildId, 'guildId');

    if (guildId.isErr()) return err(guildId.error);

    try {
        const rows = await db
            .insert(structureExportSnapshots)
            .values({
                guildId: guildId.value,
                snapshot: input.snapshot,
                createdByUserId: normalizeOptionalText(input.createdByUserId),
                source: normalizeOptionalText(input.source) ?? 'bot',
            })
            .returning();
        const row = rows[0];

        return row ? ok(row) : err({ type: 'database-error' });
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function createStructureImportRun(
    db: GuildFeatureRepositoryDatabase,
    input: {
        guildId: string;
        createdByUserId?: string;
        sourceSnapshotId?: string;
        plan?: Record<string, unknown>;
    }
): Promise<Result<StructureImportRunRecord, StructureImportExportRepositoryError>> {
    const guildId = normalizeRequiredText(input.guildId, 'guildId');

    if (guildId.isErr()) return err(guildId.error);

    try {
        const rows = await db
            .insert(structureImportRuns)
            .values({
                guildId: guildId.value,
                createdByUserId: normalizeOptionalText(input.createdByUserId),
                sourceSnapshotId: normalizeOptionalText(input.sourceSnapshotId),
                plan: input.plan ?? {},
            })
            .returning();
        const row = rows[0];

        return row ? ok(row) : err({ type: 'database-error' });
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function updateStructureImportRunStatus(
    db: GuildFeatureRepositoryDatabase,
    input: { runId: string; status: string; plan?: Record<string, unknown> }
): Promise<Result<StructureImportRunRecord, StructureImportExportRepositoryError>> {
    const runId = normalizeRequiredText(input.runId, 'runId');
    const status = normalizeRequiredText(input.status, 'status');

    if (runId.isErr()) return err(runId.error);
    if (status.isErr()) return err(status.error);

    try {
        const existingRows = await db
            .select()
            .from(structureImportRuns)
            .where(eq(structureImportRuns.id, runId.value))
            .limit(1);
        const existing = existingRows[0];

        if (!existing) {
            return err({ type: 'not-found' });
        }

        const transition = assertAllowedStatusTransition(existing.status, status.value, importRunStatusTransitions);

        if (transition.isErr()) {
            return err(transition.error);
        }

        const now = new Date();
        const rows = await db
            .update(structureImportRuns)
            .set({
                status: status.value,
                plan: input.plan ?? existing.plan,
                updatedAt: now,
                confirmedAt: status.value === 'confirmed' ? now : existing.confirmedAt,
                appliedAt: status.value === 'applied' ? now : existing.appliedAt,
            })
            .where(eq(structureImportRuns.id, runId.value))
            .returning();
        const row = rows[0];

        return row ? ok(row) : err({ type: 'database-error' });
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function recordStructureImportAction(
    db: GuildFeatureRepositoryDatabase,
    input: {
        runId: string;
        actionType: string;
        targetType: string;
        targetId?: string;
        status?: string;
        details?: Record<string, unknown>;
    }
): Promise<Result<StructureImportActionRecord, StructureImportExportRepositoryError>> {
    const runId = normalizeRequiredText(input.runId, 'runId');
    const actionType = normalizeRequiredText(input.actionType, 'actionType');
    const targetType = normalizeRequiredText(input.targetType, 'targetType');

    if (runId.isErr()) return err(runId.error);
    if (actionType.isErr()) return err(actionType.error);
    if (targetType.isErr()) return err(targetType.error);

    try {
        const rows = await db
            .insert(structureImportActions)
            .values({
                runId: runId.value,
                actionType: actionType.value,
                targetType: targetType.value,
                targetId: normalizeOptionalText(input.targetId),
                status: normalizeOptionalText(input.status) ?? 'pending',
                details: input.details ?? {},
            })
            .returning();
        const row = rows[0];

        return row ? ok(row) : err({ type: 'database-error' });
    } catch {
        return err({ type: 'database-error' });
    }
}

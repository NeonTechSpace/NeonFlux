import { eq } from 'drizzle-orm';
import { err, ok, type Result } from 'neverthrow';

import {
    assertAllowedStatusTransition,
    normalizeOptionalText,
    normalizeRequiredText,
    type GuildFeatureRepositoryDatabase,
    type GuildFeatureRepositoryError,
} from './feature-repository-types.js';
import { roleReconciliationActions, roleReconciliationRuns } from './schema.js';

export type RoleReconciliationRunRecord = typeof roleReconciliationRuns.$inferSelect;
export type RoleReconciliationActionRecord = typeof roleReconciliationActions.$inferSelect;
export type RoleReconciliationRepositoryError = GuildFeatureRepositoryError;

const runStatusTransitions = new Map<string, readonly string[]>([
    ['pending', ['dry_run_complete', 'applying', 'cancelled', 'failed']],
    ['dry_run_complete', ['applying', 'cancelled']],
    ['applying', ['applied', 'failed']],
    ['applied', []],
    ['cancelled', []],
    ['failed', []],
]);

export async function createRoleReconciliationRun(
    db: GuildFeatureRepositoryDatabase,
    input: { guildId: string; summary?: Record<string, unknown> }
): Promise<Result<RoleReconciliationRunRecord, RoleReconciliationRepositoryError>> {
    const guildId = normalizeRequiredText(input.guildId, 'guildId');

    if (guildId.isErr()) return err(guildId.error);

    try {
        const rows = await db
            .insert(roleReconciliationRuns)
            .values({
                guildId: guildId.value,
                summary: input.summary ?? {},
            })
            .returning();
        const row = rows[0];

        return row ? ok(row) : err({ type: 'database-error' });
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function updateRoleReconciliationRunStatus(
    db: GuildFeatureRepositoryDatabase,
    input: { runId: string; status: string; summary?: Record<string, unknown> }
): Promise<Result<RoleReconciliationRunRecord, RoleReconciliationRepositoryError>> {
    const runId = normalizeRequiredText(input.runId, 'runId');
    const status = normalizeRequiredText(input.status, 'status');

    if (runId.isErr()) return err(runId.error);
    if (status.isErr()) return err(status.error);

    try {
        const existingRows = await db
            .select()
            .from(roleReconciliationRuns)
            .where(eq(roleReconciliationRuns.id, runId.value))
            .limit(1);
        const existing = existingRows[0];

        if (!existing) {
            return err({ type: 'not-found' });
        }

        const transition = assertAllowedStatusTransition(existing.status, status.value, runStatusTransitions);

        if (transition.isErr()) {
            return err(transition.error);
        }

        const rows = await db
            .update(roleReconciliationRuns)
            .set({
                status: status.value,
                summary: input.summary ?? existing.summary,
                updatedAt: new Date(),
            })
            .where(eq(roleReconciliationRuns.id, runId.value))
            .returning();
        const row = rows[0];

        return row ? ok(row) : err({ type: 'database-error' });
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function recordRoleReconciliationAction(
    db: GuildFeatureRepositoryDatabase,
    input: { runId: string; actionType: string; roleId?: string; status?: string; details?: Record<string, unknown> }
): Promise<Result<RoleReconciliationActionRecord, RoleReconciliationRepositoryError>> {
    const runId = normalizeRequiredText(input.runId, 'runId');
    const actionType = normalizeRequiredText(input.actionType, 'actionType');

    if (runId.isErr()) return err(runId.error);
    if (actionType.isErr()) return err(actionType.error);

    try {
        const rows = await db
            .insert(roleReconciliationActions)
            .values({
                runId: runId.value,
                actionType: actionType.value,
                roleId: normalizeOptionalText(input.roleId),
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

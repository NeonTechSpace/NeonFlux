import { and, eq } from 'drizzle-orm';
import { err, ok, type Result } from 'neverthrow';

import {
    assertAllowedStatusTransition,
    normalizeOptionalText,
    normalizeRequiredText,
    type GuildFeatureRepositoryDatabase,
    type GuildFeatureRepositoryError,
} from './feature-repository-types.js';
import { guildFeatureSettings, roleReconciliationActions, roleReconciliationRuns } from './schema.js';

export type RoleReconciliationRunRecord = typeof roleReconciliationRuns.$inferSelect;
export type RoleReconciliationActionRecord = typeof roleReconciliationActions.$inferSelect;
export type RoleReconciliationRepositoryError = GuildFeatureRepositoryError;
export type RoleReconciliationSettingsRecord = {
    guildId: string;
    enabled: boolean;
    restoreAutoroleRoles: boolean;
    restoreVerificationRoles: boolean;
    restoreReactionRoles: boolean;
    cleanupDeletedRoleReferences: boolean;
    createdAt?: Date;
    updatedAt?: Date;
};

export type RoleReconciliationSettingsInput = {
    guildId: string;
    enabled?: boolean;
    restoreAutoroleRoles?: boolean;
    restoreVerificationRoles?: boolean;
    restoreReactionRoles?: boolean;
    cleanupDeletedRoleReferences?: boolean;
};

export const ROLE_RECONCILIATION_FEATURE = 'role_reconciliation';
export const DEFAULT_ROLE_RECONCILIATION_SETTINGS = {
    enabled: true,
    restoreAutoroleRoles: true,
    restoreVerificationRoles: true,
    restoreReactionRoles: true,
    cleanupDeletedRoleReferences: true,
} as const;

const runStatusTransitions = new Map<string, readonly string[]>([
    ['pending', ['dry_run_complete', 'applying', 'cancelled', 'failed']],
    ['dry_run_complete', ['applying', 'cancelled']],
    ['applying', ['applied', 'failed']],
    ['applied', []],
    ['cancelled', []],
    ['failed', []],
]);

export async function findRoleReconciliationSettingsByGuildId(
    db: GuildFeatureRepositoryDatabase,
    input: { guildId: string }
): Promise<Result<RoleReconciliationSettingsRecord, RoleReconciliationRepositoryError>> {
    const guildId = normalizeRequiredText(input.guildId, 'guildId');

    if (guildId.isErr()) return err(guildId.error);

    try {
        const rows = await db
            .select()
            .from(guildFeatureSettings)
            .where(
                and(
                    eq(guildFeatureSettings.guildId, guildId.value),
                    eq(guildFeatureSettings.feature, ROLE_RECONCILIATION_FEATURE)
                )
            )
            .limit(1);
        const row = rows[0];

        if (!row) {
            return ok({
                guildId: guildId.value,
                ...DEFAULT_ROLE_RECONCILIATION_SETTINGS,
            });
        }

        return ok(toRoleReconciliationSettingsRecord(row));
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function upsertRoleReconciliationSettings(
    db: GuildFeatureRepositoryDatabase,
    input: RoleReconciliationSettingsInput
): Promise<Result<RoleReconciliationSettingsRecord, RoleReconciliationRepositoryError>> {
    const guildId = normalizeRequiredText(input.guildId, 'guildId');

    if (guildId.isErr()) return err(guildId.error);

    const settings = {
        enabled: input.enabled ?? DEFAULT_ROLE_RECONCILIATION_SETTINGS.enabled,
        restoreAutoroleRoles: input.restoreAutoroleRoles ?? DEFAULT_ROLE_RECONCILIATION_SETTINGS.restoreAutoroleRoles,
        restoreVerificationRoles:
            input.restoreVerificationRoles ?? DEFAULT_ROLE_RECONCILIATION_SETTINGS.restoreVerificationRoles,
        restoreReactionRoles: input.restoreReactionRoles ?? DEFAULT_ROLE_RECONCILIATION_SETTINGS.restoreReactionRoles,
        cleanupDeletedRoleReferences:
            input.cleanupDeletedRoleReferences ?? DEFAULT_ROLE_RECONCILIATION_SETTINGS.cleanupDeletedRoleReferences,
    };
    const updatedAt = new Date();

    try {
        const rows = await db
            .insert(guildFeatureSettings)
            .values({
                guildId: guildId.value,
                feature: ROLE_RECONCILIATION_FEATURE,
                enabled: settings.enabled,
                config: {
                    restoreAutoroleRoles: settings.restoreAutoroleRoles,
                    restoreVerificationRoles: settings.restoreVerificationRoles,
                    restoreReactionRoles: settings.restoreReactionRoles,
                    cleanupDeletedRoleReferences: settings.cleanupDeletedRoleReferences,
                },
                updatedAt,
            })
            .onConflictDoUpdate({
                target: [guildFeatureSettings.guildId, guildFeatureSettings.feature],
                set: {
                    enabled: settings.enabled,
                    config: {
                        restoreAutoroleRoles: settings.restoreAutoroleRoles,
                        restoreVerificationRoles: settings.restoreVerificationRoles,
                        restoreReactionRoles: settings.restoreReactionRoles,
                        cleanupDeletedRoleReferences: settings.cleanupDeletedRoleReferences,
                    },
                    updatedAt,
                },
            })
            .returning();
        const row = rows[0];

        return row ? ok(toRoleReconciliationSettingsRecord(row)) : err({ type: 'database-error' });
    } catch {
        return err({ type: 'database-error' });
    }
}

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

function toRoleReconciliationSettingsRecord(
    row: typeof guildFeatureSettings.$inferSelect
): RoleReconciliationSettingsRecord {
    const config = isRecord(row.config) ? row.config : {};

    return {
        guildId: row.guildId,
        enabled: row.enabled,
        restoreAutoroleRoles: readBoolean(config.restoreAutoroleRoles, true),
        restoreVerificationRoles: readBoolean(config.restoreVerificationRoles, true),
        restoreReactionRoles: readBoolean(config.restoreReactionRoles, true),
        cleanupDeletedRoleReferences: readBoolean(config.cleanupDeletedRoleReferences, true),
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
    };
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function readBoolean(value: unknown, fallback: boolean): boolean {
    return typeof value === 'boolean' ? value : fallback;
}

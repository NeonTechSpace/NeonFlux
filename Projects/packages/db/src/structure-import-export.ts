import { and, desc, eq } from 'drizzle-orm';
import { err, ok, type Result } from 'neverthrow';

import {
    assertAllowedStatusTransition,
    normalizeOptionalText,
    normalizeRequiredPositiveInteger,
    normalizeRequiredText,
    type GuildFeatureRepositoryDatabase,
    type GuildFeatureRepositoryError,
} from './feature-repository-types.js';
import {
    guildFeatureSettings,
    structureExportSnapshots,
    structureImportActions,
    structureImportRuns,
} from './schema.js';

export type StructureExportSnapshotRecord = typeof structureExportSnapshots.$inferSelect;
export type StructureImportRunRecord = typeof structureImportRuns.$inferSelect;
export type StructureImportActionRecord = typeof structureImportActions.$inferSelect;
export type StructureImportExportRepositoryError = GuildFeatureRepositoryError;
export type StructureImportRunWithActionsRecord = StructureImportRunRecord & {
    actions: StructureImportActionRecord[];
};
export type StructureObservedEventStateRecord = {
    guildId: string;
    observedChangeCount: number;
    lastEventType?: string;
    lastTargetType?: string;
    lastTargetId?: string;
    lastObservedAt?: Date;
    createdAt?: Date;
    updatedAt?: Date;
};

export const STRUCTURE_IMPORT_EXPORT_FEATURE = 'import_export';

const importRunStatusTransitions = new Map<string, readonly string[]>([
    ['draft', ['dry_run_complete', 'cancelled']],
    ['dry_run_complete', ['confirmed', 'cancelled']],
    ['confirmed', ['applying', 'cancelled']],
    ['applying', ['applied', 'failed']],
    ['applied', []],
    ['cancelled', []],
    ['failed', []],
]);

export async function findStructureObservedEventStateByGuildId(
    db: GuildFeatureRepositoryDatabase,
    input: { guildId: string }
): Promise<Result<StructureObservedEventStateRecord, StructureImportExportRepositoryError>> {
    const guildId = normalizeRequiredText(input.guildId, 'guildId');

    if (guildId.isErr()) return err(guildId.error);

    try {
        const rows = await db
            .select()
            .from(guildFeatureSettings)
            .where(
                and(
                    eq(guildFeatureSettings.guildId, guildId.value),
                    eq(guildFeatureSettings.feature, STRUCTURE_IMPORT_EXPORT_FEATURE)
                )
            )
            .limit(1);
        const row = rows[0];

        if (!row) {
            return ok({
                guildId: guildId.value,
                observedChangeCount: 0,
            });
        }

        return ok(toStructureObservedEventStateRecord(row));
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function recordStructureObservedEvent(
    db: GuildFeatureRepositoryDatabase,
    input: {
        guildId: string;
        eventType: string;
        targetType: string;
        targetId?: string;
    }
): Promise<Result<StructureObservedEventStateRecord, StructureImportExportRepositoryError>> {
    const guildId = normalizeRequiredText(input.guildId, 'guildId');
    const eventType = normalizeRequiredText(input.eventType, 'eventType');
    const targetType = normalizeRequiredText(input.targetType, 'targetType');

    if (guildId.isErr()) return err(guildId.error);
    if (eventType.isErr()) return err(eventType.error);
    if (targetType.isErr()) return err(targetType.error);

    const existingState = await findStructureObservedEventStateByGuildId(db, { guildId: guildId.value });

    if (existingState.isErr()) return err(existingState.error);

    const observedAt = new Date();
    const targetId = normalizeOptionalText(input.targetId);
    const config = {
        observedChangeCount: existingState.value.observedChangeCount + 1,
        lastEventType: eventType.value,
        lastTargetType: targetType.value,
        ...(targetId ? { lastTargetId: targetId } : {}),
        lastObservedAt: observedAt.toISOString(),
    };

    try {
        const rows = await db
            .insert(guildFeatureSettings)
            .values({
                guildId: guildId.value,
                feature: STRUCTURE_IMPORT_EXPORT_FEATURE,
                enabled: true,
                config,
                updatedAt: observedAt,
            })
            .onConflictDoUpdate({
                target: [guildFeatureSettings.guildId, guildFeatureSettings.feature],
                set: {
                    enabled: true,
                    config,
                    updatedAt: observedAt,
                },
            })
            .returning();
        const row = rows[0];

        return row ? ok(toStructureObservedEventStateRecord(row)) : err({ type: 'database-error' });
    } catch {
        return err({ type: 'database-error' });
    }
}

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

export async function listStructureExportSnapshotsByGuildId(
    db: GuildFeatureRepositoryDatabase,
    input: { guildId: string; limit?: number }
): Promise<Result<StructureExportSnapshotRecord[], StructureImportExportRepositoryError>> {
    const guildId = normalizeRequiredText(input.guildId, 'guildId');
    const limit = normalizeLimit(input.limit ?? 20);

    if (guildId.isErr()) return err(guildId.error);
    if (limit.isErr()) return err(limit.error);

    try {
        return ok(
            await db
                .select()
                .from(structureExportSnapshots)
                .where(eq(structureExportSnapshots.guildId, guildId.value))
                .orderBy(desc(structureExportSnapshots.createdAt))
                .limit(limit.value)
        );
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function findStructureExportSnapshotByGuildId(
    db: GuildFeatureRepositoryDatabase,
    input: { guildId: string; snapshotId: string }
): Promise<Result<StructureExportSnapshotRecord, StructureImportExportRepositoryError>> {
    const guildId = normalizeRequiredText(input.guildId, 'guildId');
    const snapshotId = normalizeRequiredText(input.snapshotId, 'snapshotId');

    if (guildId.isErr()) return err(guildId.error);
    if (snapshotId.isErr()) return err(snapshotId.error);

    try {
        const rows = await db
            .select()
            .from(structureExportSnapshots)
            .where(
                and(
                    eq(structureExportSnapshots.guildId, guildId.value),
                    eq(structureExportSnapshots.id, snapshotId.value)
                )
            )
            .limit(1);
        const row = rows[0];

        return row ? ok(row) : err({ type: 'not-found' });
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

export async function listStructureImportRunsByGuildId(
    db: GuildFeatureRepositoryDatabase,
    input: { guildId: string; limit?: number }
): Promise<Result<StructureImportRunWithActionsRecord[], StructureImportExportRepositoryError>> {
    const guildId = normalizeRequiredText(input.guildId, 'guildId');
    const limit = normalizeLimit(input.limit ?? 20);

    if (guildId.isErr()) return err(guildId.error);
    if (limit.isErr()) return err(limit.error);

    try {
        const runs = await db
            .select()
            .from(structureImportRuns)
            .where(eq(structureImportRuns.guildId, guildId.value))
            .orderBy(desc(structureImportRuns.createdAt))
            .limit(limit.value);
        const runsWithActions = await Promise.all(
            runs.map(async (run) => {
                const actions = await db
                    .select()
                    .from(structureImportActions)
                    .where(eq(structureImportActions.runId, run.id))
                    .orderBy(structureImportActions.createdAt);

                return {
                    ...run,
                    actions,
                };
            })
        );

        return ok(runsWithActions);
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function findStructureImportRunByGuildId(
    db: GuildFeatureRepositoryDatabase,
    input: { guildId: string; runId: string }
): Promise<Result<StructureImportRunWithActionsRecord, StructureImportExportRepositoryError>> {
    const guildId = normalizeRequiredText(input.guildId, 'guildId');
    const runId = normalizeRequiredText(input.runId, 'runId');

    if (guildId.isErr()) return err(guildId.error);
    if (runId.isErr()) return err(runId.error);

    try {
        const runs = await db
            .select()
            .from(structureImportRuns)
            .where(and(eq(structureImportRuns.guildId, guildId.value), eq(structureImportRuns.id, runId.value)))
            .limit(1);
        const run = runs[0];

        if (!run) {
            return err({ type: 'not-found' });
        }

        const actions = await db
            .select()
            .from(structureImportActions)
            .where(eq(structureImportActions.runId, run.id))
            .orderBy(structureImportActions.createdAt);

        return ok({
            ...run,
            actions,
        });
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

export async function updateStructureImportActionStatus(
    db: GuildFeatureRepositoryDatabase,
    input: {
        actionId: string;
        status: string;
        details?: Record<string, unknown>;
    }
): Promise<Result<StructureImportActionRecord, StructureImportExportRepositoryError>> {
    const actionId = normalizeRequiredText(input.actionId, 'actionId');
    const status = normalizeRequiredText(input.status, 'status');

    if (actionId.isErr()) return err(actionId.error);
    if (status.isErr()) return err(status.error);

    try {
        const existingRows = await db
            .select()
            .from(structureImportActions)
            .where(eq(structureImportActions.id, actionId.value))
            .limit(1);
        const existing = existingRows[0];

        if (!existing) {
            return err({ type: 'not-found' });
        }

        const rows = await db
            .update(structureImportActions)
            .set({
                status: status.value,
                details: input.details ?? existing.details,
                updatedAt: new Date(),
            })
            .where(eq(structureImportActions.id, actionId.value))
            .returning();
        const row = rows[0];

        return row ? ok(row) : err({ type: 'database-error' });
    } catch {
        return err({ type: 'database-error' });
    }
}

function normalizeLimit(limit: number): Result<number, GuildFeatureRepositoryError> {
    const normalizedLimit = normalizeRequiredPositiveInteger(limit, 'limit');

    if (normalizedLimit.isErr()) return err(normalizedLimit.error);

    return ok(Math.min(normalizedLimit.value, 100));
}

function toStructureObservedEventStateRecord(
    row: typeof guildFeatureSettings.$inferSelect
): StructureObservedEventStateRecord {
    const config = isRecord(row.config) ? row.config : {};
    const lastEventType = readStringField(config, 'lastEventType');
    const lastTargetType = readStringField(config, 'lastTargetType');
    const lastTargetId = readStringField(config, 'lastTargetId');

    return {
        guildId: row.guildId,
        observedChangeCount: readNonNegativeInteger(config.observedChangeCount),
        ...(lastEventType ? { lastEventType } : {}),
        ...(lastTargetType ? { lastTargetType } : {}),
        ...(lastTargetId ? { lastTargetId } : {}),
        ...readDateField(config, 'lastObservedAt'),
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
    };
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function readNonNegativeInteger(value: unknown): number {
    return Number.isInteger(value) && typeof value === 'number' && value >= 0 ? value : 0;
}

function readStringField(config: Record<string, unknown>, field: string): string | undefined {
    const value = config[field];

    return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function readDateField(
    config: Record<string, unknown>,
    field: 'lastObservedAt'
): Pick<StructureObservedEventStateRecord, 'lastObservedAt'> | Record<string, never> {
    const value = config[field];

    if (typeof value !== 'string') return {};

    const date = new Date(value);

    return Number.isNaN(date.getTime()) ? {} : { lastObservedAt: date };
}

import { api } from '@neonflux/convex/api';
import {
    createStructureExportSnapshot as createStructureExportSnapshotPostgres,
    createStructureImportRun as createStructureImportRunPostgres,
    findStructureExportSnapshotByGuildId as findStructureExportSnapshotByGuildIdPostgres,
    findStructureImportRunByGuildId as findStructureImportRunByGuildIdPostgres,
    findStructureObservedEventStateByGuildId as findStructureObservedEventStateByGuildIdPostgres,
    listStructureExportSnapshotsByGuildId as listStructureExportSnapshotsByGuildIdPostgres,
    listStructureImportRunsByGuildId as listStructureImportRunsByGuildIdPostgres,
    recordStructureImportAction as recordStructureImportActionPostgres,
    recordStructureObservedEvent as recordStructureObservedEventPostgres,
    updateStructureImportActionStatus as updateStructureImportActionStatusPostgres,
    updateStructureImportRunStatus as updateStructureImportRunStatusPostgres,
    type StructureExportSnapshotRecord,
    type StructureImportActionRecord,
    type StructureImportExportRepositoryError,
    type StructureImportRunRecord,
    type StructureImportRunWithActionsRecord,
    type StructureObservedEventStateRecord,
} from '@neonflux/db';
import { err, ok, type Result } from 'neverthrow';

import { isConvexPersistenceDatabase, type ConvexPersistenceDatabase } from './convex.js';
import {
    normalizeLimit,
    normalizeOptionalText,
    normalizeRequiredText,
    toExportSnapshotRecord,
    toImportActionRecord,
    toImportRunRecord,
    toImportRunWithActionsRecord,
    toObservedEventStateRecord,
    type ConvexStructureExportSnapshotRecord,
    type ConvexStructureImportActionRecord,
    type ConvexStructureImportRunRecord,
    type ConvexStructureImportRunWithActionsRecord,
    type ConvexStructureObservedEventStateRecord,
} from './runtime-structure-records.js';

type ConvexQueryReference = Parameters<ConvexPersistenceDatabase['client']['query']>[0];
type ConvexMutationReference = Parameters<ConvexPersistenceDatabase['client']['mutation']>[0];

const convexApi = api as unknown as {
    structure: {
        createStructureExportSnapshot: ConvexMutationReference;
        createStructureImportRun: ConvexMutationReference;
        findStructureExportSnapshotByGuildId: ConvexQueryReference;
        findStructureImportRunByGuildId: ConvexQueryReference;
        findStructureObservedEventStateByGuildId: ConvexQueryReference;
        listStructureExportSnapshotsByGuildId: ConvexQueryReference;
        listStructureImportRunsByGuildId: ConvexQueryReference;
        recordStructureImportAction: ConvexMutationReference;
        recordStructureObservedEvent: ConvexMutationReference;
        updateStructureImportActionStatus: ConvexMutationReference;
        updateStructureImportRunStatus: ConvexMutationReference;
    };
};

type PostgresStructureDb = Parameters<typeof createStructureExportSnapshotPostgres>[0];
type StructureDb = ConvexPersistenceDatabase | PostgresStructureDb;

export async function findStructureObservedEventStateByGuildId(
    db: StructureDb,
    input: { guildId: string }
): Promise<Result<StructureObservedEventStateRecord, StructureImportExportRepositoryError>> {
    if (!isConvexPersistenceDatabase(db)) return findStructureObservedEventStateByGuildIdPostgres(db, input);

    const guildId = normalizeRequiredText(input.guildId, 'guildId');
    if (guildId.isErr()) return err(guildId.error);

    try {
        const state = (await db.client.query(convexApi.structure.findStructureObservedEventStateByGuildId, {
            guildId: guildId.value,
        })) as ConvexStructureObservedEventStateRecord;

        return ok(toObservedEventStateRecord(state));
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function recordStructureObservedEvent(
    db: StructureDb,
    input: { eventType: string; guildId: string; targetId?: string; targetType: string }
): Promise<Result<StructureObservedEventStateRecord, StructureImportExportRepositoryError>> {
    if (!isConvexPersistenceDatabase(db)) return recordStructureObservedEventPostgres(db, input);

    const normalizedInput = normalizeObservedEventInput(input);
    if (normalizedInput.isErr()) return err(normalizedInput.error);

    try {
        const state = (await db.client.mutation(
            convexApi.structure.recordStructureObservedEvent,
            normalizedInput.value
        )) as ConvexStructureObservedEventStateRecord;

        return ok(toObservedEventStateRecord(state));
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function createStructureExportSnapshot(
    db: StructureDb,
    input: { createdByUserId?: string; guildId: string; snapshot: Record<string, unknown>; source?: string }
): Promise<Result<StructureExportSnapshotRecord, StructureImportExportRepositoryError>> {
    if (!isConvexPersistenceDatabase(db)) return createStructureExportSnapshotPostgres(db, input);

    const guildId = normalizeRequiredText(input.guildId, 'guildId');
    if (guildId.isErr()) return err(guildId.error);

    try {
        const snapshot = (await db.client.mutation(convexApi.structure.createStructureExportSnapshot, {
            ...(normalizeOptionalText(input.createdByUserId)
                ? { createdByUserId: normalizeOptionalText(input.createdByUserId) }
                : {}),
            guildId: guildId.value,
            snapshot: input.snapshot,
            ...(normalizeOptionalText(input.source) ? { source: normalizeOptionalText(input.source) } : {}),
        })) as ConvexStructureExportSnapshotRecord;

        return ok(toExportSnapshotRecord(snapshot));
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function listStructureExportSnapshotsByGuildId(
    db: StructureDb,
    input: { guildId: string; limit?: number }
): Promise<Result<StructureExportSnapshotRecord[], StructureImportExportRepositoryError>> {
    if (!isConvexPersistenceDatabase(db)) return listStructureExportSnapshotsByGuildIdPostgres(db, input);

    const guildId = normalizeRequiredText(input.guildId, 'guildId');
    const limit = normalizeLimit(input.limit);

    if (guildId.isErr()) return err(guildId.error);
    if (limit.isErr()) return err(limit.error);

    try {
        const snapshots = (await db.client.query(convexApi.structure.listStructureExportSnapshotsByGuildId, {
            guildId: guildId.value,
            limit: limit.value,
        })) as ConvexStructureExportSnapshotRecord[];

        return ok(snapshots.map(toExportSnapshotRecord));
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function findStructureExportSnapshotByGuildId(
    db: StructureDb,
    input: { guildId: string; snapshotId: string }
): Promise<Result<StructureExportSnapshotRecord, StructureImportExportRepositoryError>> {
    if (!isConvexPersistenceDatabase(db)) return findStructureExportSnapshotByGuildIdPostgres(db, input);

    const guildId = normalizeRequiredText(input.guildId, 'guildId');
    const snapshotId = normalizeRequiredText(input.snapshotId, 'snapshotId');

    if (guildId.isErr()) return err(guildId.error);
    if (snapshotId.isErr()) return err(snapshotId.error);

    try {
        const snapshot = (await db.client.query(convexApi.structure.findStructureExportSnapshotByGuildId, {
            guildId: guildId.value,
            snapshotId: snapshotId.value,
        })) as ConvexStructureExportSnapshotRecord | null;

        return snapshot ? ok(toExportSnapshotRecord(snapshot)) : err({ type: 'not-found' });
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function createStructureImportRun(
    db: StructureDb,
    input: { createdByUserId?: string; guildId: string; plan?: Record<string, unknown>; sourceSnapshotId?: string }
): Promise<Result<StructureImportRunRecord, StructureImportExportRepositoryError>> {
    if (!isConvexPersistenceDatabase(db)) return createStructureImportRunPostgres(db, input);

    const guildId = normalizeRequiredText(input.guildId, 'guildId');
    if (guildId.isErr()) return err(guildId.error);

    try {
        const run = (await db.client.mutation(convexApi.structure.createStructureImportRun, {
            ...(normalizeOptionalText(input.createdByUserId)
                ? { createdByUserId: normalizeOptionalText(input.createdByUserId) }
                : {}),
            guildId: guildId.value,
            plan: input.plan ?? {},
            ...(normalizeOptionalText(input.sourceSnapshotId)
                ? { sourceSnapshotId: normalizeOptionalText(input.sourceSnapshotId) }
                : {}),
        })) as ConvexStructureImportRunRecord;

        return ok(toImportRunRecord(run));
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function listStructureImportRunsByGuildId(
    db: StructureDb,
    input: { guildId: string; limit?: number }
): Promise<Result<StructureImportRunWithActionsRecord[], StructureImportExportRepositoryError>> {
    if (!isConvexPersistenceDatabase(db)) return listStructureImportRunsByGuildIdPostgres(db, input);

    const guildId = normalizeRequiredText(input.guildId, 'guildId');
    const limit = normalizeLimit(input.limit);

    if (guildId.isErr()) return err(guildId.error);
    if (limit.isErr()) return err(limit.error);

    try {
        const runs = (await db.client.query(convexApi.structure.listStructureImportRunsByGuildId, {
            guildId: guildId.value,
            limit: limit.value,
        })) as ConvexStructureImportRunWithActionsRecord[];

        return ok(runs.map(toImportRunWithActionsRecord));
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function findStructureImportRunByGuildId(
    db: StructureDb,
    input: { guildId: string; runId: string }
): Promise<Result<StructureImportRunWithActionsRecord, StructureImportExportRepositoryError>> {
    if (!isConvexPersistenceDatabase(db)) return findStructureImportRunByGuildIdPostgres(db, input);

    const guildId = normalizeRequiredText(input.guildId, 'guildId');
    const runId = normalizeRequiredText(input.runId, 'runId');

    if (guildId.isErr()) return err(guildId.error);
    if (runId.isErr()) return err(runId.error);

    try {
        const run = (await db.client.query(convexApi.structure.findStructureImportRunByGuildId, {
            guildId: guildId.value,
            runId: runId.value,
        })) as ConvexStructureImportRunWithActionsRecord | null;

        return run ? ok(toImportRunWithActionsRecord(run)) : err({ type: 'not-found' });
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function updateStructureImportRunStatus(
    db: StructureDb,
    input: { plan?: Record<string, unknown>; runId: string; status: string }
): Promise<Result<StructureImportRunRecord, StructureImportExportRepositoryError>> {
    if (!isConvexPersistenceDatabase(db)) return updateStructureImportRunStatusPostgres(db, input);

    const runId = normalizeRequiredText(input.runId, 'runId');
    const status = normalizeRequiredText(input.status, 'status');

    if (runId.isErr()) return err(runId.error);
    if (status.isErr()) return err(status.error);

    try {
        const run = (await db.client.mutation(convexApi.structure.updateStructureImportRunStatus, {
            ...(input.plan ? { plan: input.plan } : {}),
            runId: runId.value,
            status: status.value,
        })) as ConvexStructureImportRunRecord | null;

        return run ? ok(toImportRunRecord(run)) : err({ type: 'not-found' });
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function recordStructureImportAction(
    db: StructureDb,
    input: {
        actionType: string;
        details?: Record<string, unknown>;
        runId: string;
        status?: string;
        targetId?: string;
        targetType: string;
    }
): Promise<Result<StructureImportActionRecord, StructureImportExportRepositoryError>> {
    if (!isConvexPersistenceDatabase(db)) return recordStructureImportActionPostgres(db, input);

    const normalizedInput = normalizeImportActionInput(input);
    if (normalizedInput.isErr()) return err(normalizedInput.error);

    try {
        const action = (await db.client.mutation(
            convexApi.structure.recordStructureImportAction,
            normalizedInput.value
        )) as ConvexStructureImportActionRecord;

        return ok(toImportActionRecord(action));
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function updateStructureImportActionStatus(
    db: StructureDb,
    input: { actionId: string; details?: Record<string, unknown>; status: string }
): Promise<Result<StructureImportActionRecord, StructureImportExportRepositoryError>> {
    if (!isConvexPersistenceDatabase(db)) return updateStructureImportActionStatusPostgres(db, input);

    const actionId = normalizeRequiredText(input.actionId, 'actionId');
    const status = normalizeRequiredText(input.status, 'status');

    if (actionId.isErr()) return err(actionId.error);
    if (status.isErr()) return err(status.error);

    try {
        const action = (await db.client.mutation(convexApi.structure.updateStructureImportActionStatus, {
            actionId: actionId.value,
            ...(input.details ? { details: input.details } : {}),
            status: status.value,
        })) as ConvexStructureImportActionRecord | null;

        return action ? ok(toImportActionRecord(action)) : err({ type: 'not-found' });
    } catch {
        return err({ type: 'database-error' });
    }
}

function normalizeObservedEventInput(input: {
    eventType: string;
    guildId: string;
    targetId?: string;
    targetType: string;
}): Result<Record<string, unknown>, StructureImportExportRepositoryError> {
    const guildId = normalizeRequiredText(input.guildId, 'guildId');
    const eventType = normalizeRequiredText(input.eventType, 'eventType');
    const targetType = normalizeRequiredText(input.targetType, 'targetType');
    const targetId = normalizeOptionalText(input.targetId);

    if (guildId.isErr()) return err(guildId.error);
    if (eventType.isErr()) return err(eventType.error);
    if (targetType.isErr()) return err(targetType.error);

    return ok({
        eventType: eventType.value,
        guildId: guildId.value,
        ...(targetId ? { targetId } : {}),
        targetType: targetType.value,
    });
}

function normalizeImportActionInput(input: {
    actionType: string;
    details?: Record<string, unknown>;
    runId: string;
    status?: string;
    targetId?: string;
    targetType: string;
}): Result<Record<string, unknown>, StructureImportExportRepositoryError> {
    const runId = normalizeRequiredText(input.runId, 'runId');
    const actionType = normalizeRequiredText(input.actionType, 'actionType');
    const targetType = normalizeRequiredText(input.targetType, 'targetType');
    const status = normalizeOptionalText(input.status);
    const targetId = normalizeOptionalText(input.targetId);

    if (runId.isErr()) return err(runId.error);
    if (actionType.isErr()) return err(actionType.error);
    if (targetType.isErr()) return err(targetType.error);

    return ok({
        actionType: actionType.value,
        details: input.details ?? {},
        runId: runId.value,
        ...(status ? { status } : {}),
        ...(targetId ? { targetId } : {}),
        targetType: targetType.value,
    });
}

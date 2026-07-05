import { api } from '@neonflux/convex/api';
import type {
    StructureExportSnapshotRecord,
    StructureImportActionRecord,
    StructureImportExportRepositoryError,
    StructureImportRunRecord,
    StructureImportRunWithActionsRecord,
    StructureObservedEventStateRecord,
} from './contracts-structure.js';
import { err, ok, type Result } from 'neverthrow';

import type { ConvexDatabase } from './convex.js';
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

type ConvexQueryReference = Parameters<ConvexDatabase['client']['query']>[0];
type ConvexMutationReference = Parameters<ConvexDatabase['client']['mutation']>[0];

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

type StructureDb = ConvexDatabase;

export async function findStructureObservedEventStateByGuildId(
    db: StructureDb,
    input: { guildId: string }
): Promise<Result<StructureObservedEventStateRecord, StructureImportExportRepositoryError>> {
    const guildId = normalizeRequiredText(input.guildId, 'guildId');
    if (guildId.isErr()) return err(guildId.error);

    try {
        const state = await db.client.query<ConvexStructureObservedEventStateRecord>(
            convexApi.structure.findStructureObservedEventStateByGuildId,
            {
                guildId: guildId.value,
            }
        );

        return ok(toObservedEventStateRecord(state));
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function recordStructureObservedEvent(
    db: StructureDb,
    input: { eventType: string; guildId: string; targetId?: string; targetType: string }
): Promise<Result<StructureObservedEventStateRecord, StructureImportExportRepositoryError>> {
    const normalizedInput = normalizeObservedEventInput(input);
    if (normalizedInput.isErr()) return err(normalizedInput.error);

    try {
        const state = await db.client.mutation<ConvexStructureObservedEventStateRecord>(
            convexApi.structure.recordStructureObservedEvent,
            normalizedInput.value
        );

        return ok(toObservedEventStateRecord(state));
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function createStructureExportSnapshot(
    db: StructureDb,
    input: { createdByUserId?: string; guildId: string; snapshot: Record<string, unknown>; source?: string }
): Promise<Result<StructureExportSnapshotRecord, StructureImportExportRepositoryError>> {
    const guildId = normalizeRequiredText(input.guildId, 'guildId');
    if (guildId.isErr()) return err(guildId.error);

    try {
        const snapshot = await db.client.mutation<ConvexStructureExportSnapshotRecord>(
            convexApi.structure.createStructureExportSnapshot,
            {
                ...(normalizeOptionalText(input.createdByUserId)
                    ? { createdByUserId: normalizeOptionalText(input.createdByUserId) }
                    : {}),
                guildId: guildId.value,
                snapshot: input.snapshot,
                ...(normalizeOptionalText(input.source) ? { source: normalizeOptionalText(input.source) } : {}),
            }
        );

        return ok(toExportSnapshotRecord(snapshot));
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function listStructureExportSnapshotsByGuildId(
    db: StructureDb,
    input: { guildId: string; limit?: number }
): Promise<Result<StructureExportSnapshotRecord[], StructureImportExportRepositoryError>> {
    const guildId = normalizeRequiredText(input.guildId, 'guildId');
    const limit = normalizeLimit(input.limit);

    if (guildId.isErr()) return err(guildId.error);
    if (limit.isErr()) return err(limit.error);

    try {
        const snapshots = await db.client.query<ConvexStructureExportSnapshotRecord[]>(
            convexApi.structure.listStructureExportSnapshotsByGuildId,
            {
                guildId: guildId.value,
                limit: limit.value,
            }
        );

        return ok(snapshots.map(toExportSnapshotRecord));
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function findStructureExportSnapshotByGuildId(
    db: StructureDb,
    input: { guildId: string; snapshotId: string }
): Promise<Result<StructureExportSnapshotRecord, StructureImportExportRepositoryError>> {
    const guildId = normalizeRequiredText(input.guildId, 'guildId');
    const snapshotId = normalizeRequiredText(input.snapshotId, 'snapshotId');

    if (guildId.isErr()) return err(guildId.error);
    if (snapshotId.isErr()) return err(snapshotId.error);

    try {
        const snapshot = await db.client.query<ConvexStructureExportSnapshotRecord | null>(
            convexApi.structure.findStructureExportSnapshotByGuildId,
            {
                guildId: guildId.value,
                snapshotId: snapshotId.value,
            }
        );

        return snapshot ? ok(toExportSnapshotRecord(snapshot)) : err({ type: 'not-found' });
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function createStructureImportRun(
    db: StructureDb,
    input: { createdByUserId?: string; guildId: string; plan?: Record<string, unknown>; sourceSnapshotId?: string }
): Promise<Result<StructureImportRunRecord, StructureImportExportRepositoryError>> {
    const guildId = normalizeRequiredText(input.guildId, 'guildId');
    if (guildId.isErr()) return err(guildId.error);

    try {
        const run = await db.client.mutation<ConvexStructureImportRunRecord>(
            convexApi.structure.createStructureImportRun,
            {
                ...(normalizeOptionalText(input.createdByUserId)
                    ? { createdByUserId: normalizeOptionalText(input.createdByUserId) }
                    : {}),
                guildId: guildId.value,
                plan: input.plan ?? {},
                ...(normalizeOptionalText(input.sourceSnapshotId)
                    ? { sourceSnapshotId: normalizeOptionalText(input.sourceSnapshotId) }
                    : {}),
            }
        );

        return ok(toImportRunRecord(run));
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function listStructureImportRunsByGuildId(
    db: StructureDb,
    input: { guildId: string; limit?: number }
): Promise<Result<StructureImportRunWithActionsRecord[], StructureImportExportRepositoryError>> {
    const guildId = normalizeRequiredText(input.guildId, 'guildId');
    const limit = normalizeLimit(input.limit);

    if (guildId.isErr()) return err(guildId.error);
    if (limit.isErr()) return err(limit.error);

    try {
        const runs = await db.client.query<ConvexStructureImportRunWithActionsRecord[]>(
            convexApi.structure.listStructureImportRunsByGuildId,
            {
                guildId: guildId.value,
                limit: limit.value,
            }
        );

        return ok(runs.map(toImportRunWithActionsRecord));
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function findStructureImportRunByGuildId(
    db: StructureDb,
    input: { guildId: string; runId: string }
): Promise<Result<StructureImportRunWithActionsRecord, StructureImportExportRepositoryError>> {
    const guildId = normalizeRequiredText(input.guildId, 'guildId');
    const runId = normalizeRequiredText(input.runId, 'runId');

    if (guildId.isErr()) return err(guildId.error);
    if (runId.isErr()) return err(runId.error);

    try {
        const run = await db.client.query<ConvexStructureImportRunWithActionsRecord | null>(
            convexApi.structure.findStructureImportRunByGuildId,
            {
                guildId: guildId.value,
                runId: runId.value,
            }
        );

        return run ? ok(toImportRunWithActionsRecord(run)) : err({ type: 'not-found' });
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function updateStructureImportRunStatus(
    db: StructureDb,
    input: { plan?: Record<string, unknown>; runId: string; status: string }
): Promise<Result<StructureImportRunRecord, StructureImportExportRepositoryError>> {
    const runId = normalizeRequiredText(input.runId, 'runId');
    const status = normalizeRequiredText(input.status, 'status');

    if (runId.isErr()) return err(runId.error);
    if (status.isErr()) return err(status.error);

    try {
        const run = await db.client.mutation<ConvexStructureImportRunRecord | null>(
            convexApi.structure.updateStructureImportRunStatus,
            {
                ...(input.plan ? { plan: input.plan } : {}),
                runId: runId.value,
                status: status.value,
            }
        );

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
    const normalizedInput = normalizeImportActionInput(input);
    if (normalizedInput.isErr()) return err(normalizedInput.error);

    try {
        const action = await db.client.mutation<ConvexStructureImportActionRecord>(
            convexApi.structure.recordStructureImportAction,
            normalizedInput.value
        );

        return ok(toImportActionRecord(action));
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function updateStructureImportActionStatus(
    db: StructureDb,
    input: { actionId: string; details?: Record<string, unknown>; status: string }
): Promise<Result<StructureImportActionRecord, StructureImportExportRepositoryError>> {
    const actionId = normalizeRequiredText(input.actionId, 'actionId');
    const status = normalizeRequiredText(input.status, 'status');

    if (actionId.isErr()) return err(actionId.error);
    if (status.isErr()) return err(status.error);

    try {
        const action = await db.client.mutation<ConvexStructureImportActionRecord | null>(
            convexApi.structure.updateStructureImportActionStatus,
            {
                actionId: actionId.value,
                ...(input.details ? { details: input.details } : {}),
                status: status.value,
            }
        );

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

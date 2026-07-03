import { describe, expect, it } from 'vitest';

import type { ConvexPersistenceDatabase } from './convex.js';
import {
    createStructureExportSnapshot,
    createStructureImportRun,
    findStructureExportSnapshotByGuildId,
    findStructureImportRunByGuildId,
    findStructureObservedEventStateByGuildId,
    listStructureExportSnapshotsByGuildId,
    listStructureImportRunsByGuildId,
    recordStructureImportAction,
    recordStructureObservedEvent,
    updateStructureImportActionStatus,
    updateStructureImportRunStatus,
} from './runtime-structure.js';

const observedState = {
    createdAt: '2026-07-03T08:00:00.000Z',
    guildId: 'guild-1',
    lastEventType: 'channel.created',
    lastObservedAt: '2026-07-03T09:00:00.000Z',
    lastTargetId: 'channel-1',
    lastTargetType: 'channel',
    observedChangeCount: 3,
    updatedAt: '2026-07-03T09:00:00.000Z',
};
const snapshot = {
    createdAt: '2026-07-03T08:05:00.000Z',
    createdByUserId: 'user-1',
    guildId: 'guild-1',
    id: 'snapshot-1',
    snapshot: { channels: [] },
    source: 'dashboard',
};
const action = {
    actionType: 'create',
    createdAt: '2026-07-03T08:15:00.000Z',
    details: { name: 'general' },
    id: 'action-1',
    runId: 'run-1',
    status: 'pending',
    targetId: 'channel-1',
    targetType: 'channel',
    updatedAt: '2026-07-03T08:15:00.000Z',
};
const importRun = {
    actions: [action],
    appliedAt: null,
    confirmedAt: null,
    createdAt: '2026-07-03T08:10:00.000Z',
    createdByUserId: 'user-1',
    guildId: 'guild-1',
    id: 'run-1',
    plan: { changes: 1 },
    sourceSnapshotId: 'snapshot-1',
    status: 'draft',
    updatedAt: '2026-07-03T08:10:00.000Z',
};
type TestStructureRunRecord = Omit<ReturnType<typeof withoutActions>, 'appliedAt' | 'confirmedAt'> & {
    appliedAt: string | null;
    confirmedAt: string | null;
};

describe('Convex structure persistence wrappers', () => {
    it('routes observed structure state through Convex with Date conversion', async () => {
        const db = createConvexDb({
            mutationResults: [observedState],
            queryResults: [observedState],
        });

        const found = await findStructureObservedEventStateByGuildId(db, { guildId: ' guild-1 ' });
        const recorded = await recordStructureObservedEvent(db, {
            eventType: ' channel.created ',
            guildId: ' guild-1 ',
            targetId: ' channel-1 ',
            targetType: ' channel ',
        });

        expect(found._unsafeUnwrap()).toStrictEqual(toObservedStateRecord(observedState));
        expect(recorded._unsafeUnwrap()).toStrictEqual(toObservedStateRecord(observedState));
        expect(db.client.mutationCalls[0]?.args).toStrictEqual({
            eventType: 'channel.created',
            guildId: 'guild-1',
            targetId: 'channel-1',
            targetType: 'channel',
        });
    });

    it('routes export snapshots and import runs through Convex', async () => {
        const confirmedRun = {
            ...importRun,
            confirmedAt: '2026-07-03T08:30:00.000Z',
            status: 'confirmed',
            updatedAt: '2026-07-03T08:30:00.000Z',
        };
        const completedAction = {
            ...action,
            status: 'completed',
            updatedAt: '2026-07-03T08:35:00.000Z',
        };
        const db = createConvexDb({
            mutationResults: [snapshot, withoutActions(importRun), confirmedRun, action, completedAction],
            queryResults: [[snapshot], snapshot, [importRun], importRun],
        });

        const createdSnapshot = await createStructureExportSnapshot(db, {
            createdByUserId: ' user-1 ',
            guildId: ' guild-1 ',
            snapshot: snapshot.snapshot,
            source: ' dashboard ',
        });
        const snapshots = await listStructureExportSnapshotsByGuildId(db, { guildId: ' guild-1 ', limit: 5 });
        const foundSnapshot = await findStructureExportSnapshotByGuildId(db, {
            guildId: ' guild-1 ',
            snapshotId: ' snapshot-1 ',
        });
        const createdRun = await createStructureImportRun(db, {
            createdByUserId: ' user-1 ',
            guildId: ' guild-1 ',
            plan: importRun.plan,
            sourceSnapshotId: ' snapshot-1 ',
        });
        const runs = await listStructureImportRunsByGuildId(db, { guildId: ' guild-1 ', limit: 5 });
        const foundRun = await findStructureImportRunByGuildId(db, { guildId: ' guild-1 ', runId: ' run-1 ' });
        const updatedRun = await updateStructureImportRunStatus(db, {
            plan: { changes: 2 },
            runId: ' run-1 ',
            status: ' confirmed ',
        });
        const recordedAction = await recordStructureImportAction(db, {
            actionType: ' create ',
            details: action.details,
            runId: ' run-1 ',
            status: ' pending ',
            targetId: ' channel-1 ',
            targetType: ' channel ',
        });
        const updatedAction = await updateStructureImportActionStatus(db, {
            actionId: ' action-1 ',
            details: { ok: true },
            status: ' completed ',
        });

        expect(createdSnapshot._unsafeUnwrap()).toStrictEqual(toSnapshotRecord(snapshot));
        expect(snapshots._unsafeUnwrap()).toStrictEqual([toSnapshotRecord(snapshot)]);
        expect(foundSnapshot._unsafeUnwrap()).toStrictEqual(toSnapshotRecord(snapshot));
        expect(createdRun._unsafeUnwrap()).toStrictEqual(toRunRecord(withoutActions(importRun)));
        expect(runs._unsafeUnwrap()).toStrictEqual([toRunWithActionsRecord(importRun)]);
        expect(foundRun._unsafeUnwrap()).toStrictEqual(toRunWithActionsRecord(importRun));
        expect(updatedRun._unsafeUnwrap()).toStrictEqual(toRunRecord(confirmedRun));
        expect(recordedAction._unsafeUnwrap()).toStrictEqual(toActionRecord(action));
        expect(updatedAction._unsafeUnwrap()).toStrictEqual(toActionRecord(completedAction));
        expect(db.client.mutationCalls[0]?.args).toStrictEqual({
            createdByUserId: 'user-1',
            guildId: 'guild-1',
            snapshot: snapshot.snapshot,
            source: 'dashboard',
        });
    });

    it('maps validation failures and missing Convex records to existing repository errors', async () => {
        const db = createConvexDb({
            mutationResults: [null],
            queryResults: [null],
        });

        const missingGuild = await createStructureExportSnapshot(db, {
            guildId: ' ',
            snapshot: {},
        });
        const missingEventType = await recordStructureObservedEvent(db, {
            eventType: ' ',
            guildId: 'guild-1',
            targetType: 'channel',
        });
        const invalidLimit = await listStructureImportRunsByGuildId(db, {
            guildId: 'guild-1',
            limit: 0,
        });
        const missingSnapshot = await findStructureExportSnapshotByGuildId(db, {
            guildId: 'guild-1',
            snapshotId: 'snapshot-1',
        });
        const missingRunUpdate = await updateStructureImportRunStatus(db, {
            runId: 'run-1',
            status: 'confirmed',
        });

        expect(missingGuild._unsafeUnwrapErr()).toStrictEqual({ field: 'guildId', type: 'missing-input' });
        expect(missingEventType._unsafeUnwrapErr()).toStrictEqual({ field: 'eventType', type: 'missing-input' });
        expect(invalidLimit._unsafeUnwrapErr()).toStrictEqual({ field: 'limit', type: 'invalid-value' });
        expect(missingSnapshot._unsafeUnwrapErr()).toStrictEqual({ type: 'not-found' });
        expect(missingRunUpdate._unsafeUnwrapErr()).toStrictEqual({ type: 'not-found' });
    });
});

function withoutActions(record: typeof importRun) {
    const { actions: _actions, ...run } = record;
    return run;
}

function toObservedStateRecord(record: typeof observedState) {
    return {
        ...record,
        createdAt: new Date(record.createdAt),
        lastObservedAt: new Date(record.lastObservedAt),
        updatedAt: new Date(record.updatedAt),
    };
}

function toSnapshotRecord(record: typeof snapshot) {
    return { ...record, createdAt: new Date(record.createdAt) };
}

function toRunRecord(record: TestStructureRunRecord) {
    return {
        ...record,
        appliedAt: record.appliedAt ? new Date(record.appliedAt) : null,
        confirmedAt: record.confirmedAt ? new Date(record.confirmedAt) : null,
        createdAt: new Date(record.createdAt),
        updatedAt: new Date(record.updatedAt),
    };
}

function toRunWithActionsRecord(record: typeof importRun) {
    return {
        ...toRunRecord(record),
        actions: record.actions.map(toActionRecord),
    };
}

function toActionRecord(record: typeof action) {
    return {
        ...record,
        createdAt: new Date(record.createdAt),
        updatedAt: new Date(record.updatedAt),
    };
}

function createConvexDb(input: {
    mutationErrors?: Error[];
    mutationResults?: unknown[];
    queryErrors?: Error[];
    queryResults?: unknown[];
}): ConvexPersistenceDatabase & {
    client: {
        mutationCalls: Array<{ args: unknown; reference: unknown }>;
        queryCalls: Array<{ args: unknown; reference: unknown }>;
    };
} {
    const mutationErrors = [...(input.mutationErrors ?? [])];
    const mutationResults = [...(input.mutationResults ?? [])];
    const queryErrors = [...(input.queryErrors ?? [])];
    const queryResults = [...(input.queryResults ?? [])];
    const client = {
        mutationCalls: [] as Array<{ args: unknown; reference: unknown }>,
        queryCalls: [] as Array<{ args: unknown; reference: unknown }>,
        async mutation(reference: unknown, args: unknown): Promise<unknown> {
            this.mutationCalls.push({ args, reference });
            const error = mutationErrors.shift();

            if (error) throw error;

            return mutationResults.shift();
        },
        async query(reference: unknown, args: unknown): Promise<unknown> {
            this.queryCalls.push({ args, reference });
            const error = queryErrors.shift();

            if (error) throw error;

            return queryResults.shift();
        },
    };

    return {
        client: client as unknown as ConvexPersistenceDatabase['client'] & typeof client,
        kind: 'convex',
        serviceName: 'web',
    };
}

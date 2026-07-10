import { describe, expect, it } from 'vitest';

import type {
    StructureBackupSettingsRecord,
    StructureScheduledDriftFieldSummaryRecord,
    StructureScheduledDriftLiveCountsRecord,
    StructureScheduledDriftSummaryRecord,
} from './contracts-structure.js';
import type { ConvexDatabase } from './convex.js';
import {
    claimDueStructureBackupSetting,
    claimDueStructureDriftSetting,
    clearStructureBackupSettingLease,
    clearStructureDriftSettingLease,
    createStructureBackup,
    createStructureImportRun,
    findLatestStructureDriftBaselineBackupByGuildId,
    findStructureBackupByGuildId,
    findStructureImportRunByGuildId,
    findStructureObservedEventStateByGuildId,
    listStructureBackupSummariesByGuildId,
    listStructureBackupsByGuildId,
    listStructureImportRunsByGuildId,
    pruneExpiredStructureBackupsForGuild,
    listDueStructureDriftSettings,
    recordStructureImportAction,
    recordStructureImportActionsBatch,
    recordStructureObservedEvent,
    recordStructureScheduledDriftResult,
} from './runtime-structure.js';

const observedState = {
    createdAt: '2026-07-03T08:00:00.000Z',
    guildId: 'guild-1',
    lastEventType: 'channel.created',
    lastObservedAt: '2026-07-03T09:00:00.000Z',
    lastTargetId: 'channel-1',
    lastTargetType: 'channel',
    observedChangeCount: 3,
    targetChangeCounts: { channel: 3 },
    updatedAt: '2026-07-03T09:00:00.000Z',
};
const backup = {
    categoryCount: 0,
    channelCount: 0,
    completedAt: '2026-07-03T08:05:00.000Z',
    createdAt: '2026-07-03T08:05:00.000Z',
    createdByUserId: 'user-1',
    errorMessage: null,
    guildId: 'guild-1',
    id: 'backup-1',
    roleCount: 0,
    source: 'manual',
    status: 'succeeded',
    structure: { channels: [] },
};
const action = {
    actionType: 'create',
    createdAt: '2026-07-03T08:15:00.000Z',
    details: { name: 'general' },
    id: 'action-1',
    runId: 'run-1',
    sequence: 0,
    targetId: 'channel-1',
    targetType: 'channel',
};
const importRun = {
    actions: [action],
    deleteActionCount: 1,
    deleteSetDigest: 'delete-digest',
    createdAt: '2026-07-03T08:10:00.000Z',
    createdByUserId: 'user-1',
    guildId: 'guild-1',
    id: 'run-1',
    plan: { changes: 1 },
    requestedSnapshotDigest: 'snapshot-digest',
    sourceBackupId: 'backup-1',
    status: 'building',
    updatedAt: '2026-07-03T08:10:00.000Z',
};
type TestStructureRunRecord = ReturnType<typeof withoutActions>;
type TestSettingsRecord = Omit<
    StructureBackupSettingsRecord,
    | 'createdAt'
    | 'lastAttemptAt'
    | 'lastDriftCheckedAt'
    | 'lastDriftFieldSummary'
    | 'lastDriftLiveCounts'
    | 'lastDriftSummary'
    | 'lastSuccessAt'
    | 'nextBackupAt'
    | 'nextDriftCheckAt'
    | 'nextRetentionPruneAt'
    | 'updatedAt'
> & {
    createdAt: string;
    lastAttemptAt: string | null;
    lastDriftCheckedAt: string | null;
    lastDriftFieldSummary: Partial<StructureScheduledDriftFieldSummaryRecord> | null;
    lastDriftLiveCounts: Partial<StructureScheduledDriftLiveCountsRecord> | null;
    lastDriftSummary: Partial<StructureScheduledDriftSummaryRecord> | null;
    lastSuccessAt: string | null;
    nextBackupAt: string | null;
    nextDriftCheckAt: string | null;
    nextRetentionPruneAt: string | null;
    updatedAt: string;
};

describe('Convex structure database functions', () => {
    it('routes observed server layout state through Convex with Date conversion', async () => {
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

    it('routes backups and import runs through Convex', async () => {
        const restorePointBackup = { ...backup, source: 'restore_point' };
        const db = createConvexDb({
            mutationResults: [restorePointBackup, withoutActions(importRun), action],
            queryResults: [[backup], [backup], backup, [withoutActions(importRun)], withoutActions(importRun)],
        });

        const createdBackup = await createStructureBackup(db, {
            createdByUserId: ' user-1 ',
            guildId: ' guild-1 ',
            structure: backup.structure,
            source: ' restore_point ',
        });
        const backups = await listStructureBackupsByGuildId(db, { guildId: ' guild-1 ', limit: 5 });
        const backupSummaries = await listStructureBackupSummariesByGuildId(db, { guildId: ' guild-1 ', limit: 5 });
        const foundBackup = await findStructureBackupByGuildId(db, {
            guildId: ' guild-1 ',
            backupId: ' backup-1 ',
        });
        const createdRun = await createStructureImportRun(db, {
            createdByUserId: ' user-1 ',
            deleteActionCount: 1,
            deleteSetDigest: ' delete-digest ',
            guildId: ' guild-1 ',
            plan: importRun.plan,
            planDigest: ' plan-digest ',
            planVersion: 2,
            policy: 'synchronize',
            requestedSnapshotDigest: ' snapshot-digest ',
            sourceBackupId: ' backup-1 ',
        });
        const runs = await listStructureImportRunsByGuildId(db, { guildId: ' guild-1 ', limit: 5 });
        const foundRun = await findStructureImportRunByGuildId(db, { guildId: ' guild-1 ', runId: ' run-1 ' });
        const recordedAction = await recordStructureImportAction(db, {
            actionType: ' create ',
            details: action.details,
            runId: ' run-1 ',
            sequence: 0,
            targetId: ' channel-1 ',
            targetType: ' channel ',
        });

        expect(createdBackup._unsafeUnwrap()).toStrictEqual(toBackupRecord(restorePointBackup));
        expect(db.client.mutationCalls[0]?.args).toMatchObject({
            guildId: 'guild-1',
            source: 'restore_point',
        });
        expect(backups._unsafeUnwrap()).toStrictEqual([toBackupRecord(backup)]);
        expect(backupSummaries._unsafeUnwrap()).toStrictEqual([toBackupSummaryRecord(backup)]);
        expect(foundBackup._unsafeUnwrap()).toStrictEqual(toBackupRecord(backup));
        expect(createdRun._unsafeUnwrap()).toStrictEqual(toRunRecord(withoutActions(importRun)));
        expect(runs._unsafeUnwrap()).toStrictEqual([toRunRecord(withoutActions(importRun))]);
        expect(foundRun._unsafeUnwrap()).toStrictEqual(toRunRecord(withoutActions(importRun)));
        expect(recordedAction._unsafeUnwrap()).toStrictEqual(toActionRecord(action));
        expect(db.client.mutationCalls[0]?.args).toStrictEqual({
            createdByUserId: 'user-1',
            guildId: 'guild-1',
            source: 'restore_point',
            structure: backup.structure,
        });
    });

    it('routes latest drift baseline lookup through Convex', async () => {
        const db = createConvexDb({
            queryResults: [backup, null],
        });

        const found = await findLatestStructureDriftBaselineBackupByGuildId(db, { guildId: ' guild-1 ' });
        const missing = await findLatestStructureDriftBaselineBackupByGuildId(db, { guildId: ' guild-1 ' });

        expect(found._unsafeUnwrap()).toStrictEqual(toBackupRecord(backup));
        expect(missing._unsafeUnwrapErr()).toStrictEqual({ type: 'not-found' });
        expect(db.client.queryCalls).toHaveLength(2);
        expect(db.client.queryCalls[0]?.args).toStrictEqual({ guildId: 'guild-1' });
    });

    it('routes scheduled backup lease claims and clears through Convex', async () => {
        const settings = createSettingsRecord();
        const db = createConvexDb({
            mutationResults: [settings, true],
        });

        const claimed = await claimDueStructureBackupSetting(db, {
            guildId: ' guild-1 ',
            leaseExpiresAt: new Date('2026-07-03T08:30:00.000Z'),
            leaseId: ' lease-1 ',
            leaseOwner: ' bot-1 ',
            now: new Date('2026-07-03T08:00:00.000Z'),
        });
        const cleared = await clearStructureBackupSettingLease(db, {
            guildId: ' guild-1 ',
            leaseId: ' lease-1 ',
            now: new Date('2026-07-03T08:10:00.000Z'),
        });

        expect(claimed._unsafeUnwrap()).toStrictEqual({
            cadenceWeeks: 1,
            createdAt: new Date('2026-07-03T08:00:00.000Z'),
            enabled: true,
            guildId: 'guild-1',
            lastAttemptAt: null,
            lastErrorMessage: null,
            lastSuccessAt: null,
            nextBackupAt: new Date('2026-07-10T08:00:00.000Z'),
            nextDriftCheckAt: new Date('2026-07-03T08:00:00.000Z'),
            nextRetentionPruneAt: null,
            lastDriftCheckedAt: null,
            lastDriftStatus: null,
            lastDriftErrorMessage: null,
            lastDriftChangeCount: null,
            lastDriftBaselineBackupId: null,
            lastDriftBaselineName: null,
            lastDriftSummary: null,
            lastDriftFieldSummary: null,
            lastDriftLiveCounts: null,
            lastDriftHasMorePreview: false,
            retentionDays: 180,
            updatedAt: new Date('2026-07-03T08:00:00.000Z'),
        });
        expect(cleared._unsafeUnwrap()).toBe(true);
        expect(db.client.mutationCalls[0]?.args).toStrictEqual({
            guildId: 'guild-1',
            leaseExpiresAt: '2026-07-03T08:30:00.000Z',
            leaseId: 'lease-1',
            leaseOwner: 'bot-1',
            now: '2026-07-03T08:00:00.000Z',
        });
        expect(db.client.mutationCalls[1]?.args).toStrictEqual({
            guildId: 'guild-1',
            leaseId: 'lease-1',
            now: '2026-07-03T08:10:00.000Z',
        });
    });

    it('routes scheduled drift lookup, lease, and result records through Convex', async () => {
        const settings = createSettingsRecord({
            lastDriftBaselineBackupId: 'backup-1',
            lastDriftBaselineName: 'Baseline',
            lastDriftChangeCount: 2,
            lastDriftCheckedAt: '2026-07-03T08:05:00.000Z',
            lastDriftFieldSummary: { names: 1 },
            lastDriftHasMorePreview: true,
            lastDriftLiveCounts: { roles: 1, categories: 0, channels: 1 },
            lastDriftStatus: 'changed',
            lastDriftSummary: { creates: 1, updates: 1, deletes: 0, roles: 1, categories: 0, channels: 1 },
            nextDriftCheckAt: '2026-07-04T08:05:00.000Z',
        });
        const db = createConvexDb({
            mutationResults: [settings, true, settings],
            queryResults: [[settings]],
        });

        const due = await listDueStructureDriftSettings(db, {
            limit: 5,
            now: new Date('2026-07-03T08:00:00.000Z'),
        });
        const claimed = await claimDueStructureDriftSetting(db, {
            guildId: ' guild-1 ',
            leaseExpiresAt: new Date('2026-07-03T08:30:00.000Z'),
            leaseId: ' lease-1 ',
            leaseOwner: ' bot-1 ',
            now: new Date('2026-07-03T08:00:00.000Z'),
        });
        const cleared = await clearStructureDriftSettingLease(db, {
            guildId: ' guild-1 ',
            leaseId: ' lease-1 ',
            now: new Date('2026-07-03T08:10:00.000Z'),
        });
        const recorded = await recordStructureScheduledDriftResult(db, {
            audit: {
                action: ' structure.scheduled_drift_detected ',
                metadata: { source: 'scheduled_drift' },
                targetId: ' guild-1 ',
            },
            baselineBackupId: ' backup-1 ',
            baselineName: ' Baseline ',
            changeCount: 2,
            fieldSummary: { names: 1 },
            guildId: ' guild-1 ',
            hasMorePreview: true,
            liveCounts: { roles: 1, categories: 0, channels: 1 },
            now: new Date('2026-07-03T08:05:00.000Z'),
            status: ' changed ',
            summary: { creates: 1, updates: 1, deletes: 0, roles: 1, categories: 0, channels: 1 },
        });

        expect(due._unsafeUnwrap()).toStrictEqual([toSettingsRecord(settings)]);
        expect(claimed._unsafeUnwrap()).toStrictEqual(toSettingsRecord(settings));
        expect(cleared._unsafeUnwrap()).toBe(true);
        expect(recorded._unsafeUnwrap()).toStrictEqual(toSettingsRecord(settings));
        expect(db.client.queryCalls[0]?.args).toStrictEqual({
            limit: 5,
            now: '2026-07-03T08:00:00.000Z',
        });
        expect(db.client.mutationCalls[0]?.args).toStrictEqual({
            guildId: 'guild-1',
            leaseExpiresAt: '2026-07-03T08:30:00.000Z',
            leaseId: 'lease-1',
            leaseOwner: 'bot-1',
            now: '2026-07-03T08:00:00.000Z',
        });
        expect(db.client.mutationCalls[2]?.args).toStrictEqual({
            audit: {
                action: 'structure.scheduled_drift_detected',
                metadata: { source: 'scheduled_drift' },
                targetId: 'guild-1',
            },
            baselineBackupId: 'backup-1',
            baselineName: 'Baseline',
            changeCount: 2,
            fieldSummary: { names: 1 },
            guildId: 'guild-1',
            hasMorePreview: true,
            liveCounts: { roles: 1, categories: 0, channels: 1 },
            now: '2026-07-03T08:05:00.000Z',
            status: 'changed',
            summary: { creates: 1, updates: 1, deletes: 0, roles: 1, categories: 0, channels: 1 },
        });
    });

    it('routes retention pruning through Convex with audit metadata', async () => {
        const db = createConvexDb({
            mutationResults: [
                {
                    deletedCount: 2,
                    hasMore: true,
                    nextRetentionPruneAt: '2026-07-03T08:00:00.000Z',
                },
            ],
        });

        const pruned = await pruneExpiredStructureBackupsForGuild(db, {
            audit: {
                action: ' structure.backup_retention_pruned ',
                actorUserId: ' ',
                metadata: { source: 'scheduled_retention' },
                targetId: ' guild-1 ',
            },
            guildId: ' guild-1 ',
            limit: 5,
            now: new Date('2026-07-03T08:00:00.000Z'),
        });
        const missingGuild = await pruneExpiredStructureBackupsForGuild(db, {
            guildId: ' ',
            now: new Date('2026-07-03T08:00:00.000Z'),
        });

        expect(pruned._unsafeUnwrap()).toStrictEqual({
            deletedCount: 2,
            hasMore: true,
            nextRetentionPruneAt: new Date('2026-07-03T08:00:00.000Z'),
        });
        expect(missingGuild._unsafeUnwrapErr()).toStrictEqual({ field: 'guildId', type: 'missing-input' });
        expect(db.client.mutationCalls[0]?.args).toStrictEqual({
            audit: {
                action: 'structure.backup_retention_pruned',
                metadata: { source: 'scheduled_retention' },
                targetId: 'guild-1',
            },
            guildId: 'guild-1',
            limit: 5,
            now: '2026-07-03T08:00:00.000Z',
        });
    });

    it('rejects duplicate import action sequences before batch writes', async () => {
        const db = createConvexDb({});

        const result = await recordStructureImportActionsBatch(db, {
            runId: 'run-1',
            actions: [
                {
                    actionType: 'create',
                    details: action.details,
                    sequence: 0,
                    targetType: 'channel',
                },
                {
                    actionType: 'update',
                    details: action.details,
                    sequence: 0,
                    targetType: 'channel',
                },
            ],
        });

        expect(result._unsafeUnwrapErr()).toStrictEqual({ field: 'sequence', type: 'invalid-value' });
        expect(db.client.mutationCalls).toStrictEqual([]);
    });

    it('maps validation failures and missing Convex records to existing repository errors', async () => {
        const db = createConvexDb({
            mutationResults: [null],
            queryResults: [null],
        });

        const missingGuild = await createStructureBackup(db, {
            guildId: ' ',
            structure: {},
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
        const missingSnapshot = await findStructureBackupByGuildId(db, {
            guildId: 'guild-1',
            backupId: 'backup-1',
        });
        const missingActionSequence = await recordStructureImportAction(db, {
            actionType: 'create',
            details: {},
            runId: 'run-1',
            targetType: 'channel',
        } as Parameters<typeof recordStructureImportAction>[1]);

        expect(missingGuild._unsafeUnwrapErr()).toStrictEqual({ field: 'guildId', type: 'missing-input' });
        expect(missingEventType._unsafeUnwrapErr()).toStrictEqual({ field: 'eventType', type: 'missing-input' });
        expect(invalidLimit._unsafeUnwrapErr()).toStrictEqual({ field: 'limit', type: 'invalid-value' });
        expect(missingSnapshot._unsafeUnwrapErr()).toStrictEqual({ type: 'not-found' });
        expect(missingActionSequence._unsafeUnwrapErr()).toStrictEqual({ field: 'sequence', type: 'invalid-value' });
    });
});

function withoutActions(record: typeof importRun) {
    const { actions, ...run } = record;
    void actions;
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

function toBackupRecord(record: typeof backup) {
    return { ...record, completedAt: new Date(record.completedAt), createdAt: new Date(record.createdAt) };
}

function toBackupSummaryRecord(record: typeof backup) {
    const { structure, ...summary } = toBackupRecord(record);
    void structure;
    return summary;
}

function toRunRecord(record: TestStructureRunRecord) {
    return {
        ...record,
        createdAt: new Date(record.createdAt),
        updatedAt: new Date(record.updatedAt),
    };
}

function toActionRecord(record: typeof action) {
    return {
        ...record,
        createdAt: new Date(record.createdAt),
    };
}

function createSettingsRecord(overrides: Partial<TestSettingsRecord> = {}): TestSettingsRecord {
    return {
        cadenceWeeks: 1,
        createdAt: '2026-07-03T08:00:00.000Z',
        enabled: true,
        guildId: 'guild-1',
        lastAttemptAt: null,
        lastDriftBaselineBackupId: null,
        lastDriftBaselineName: null,
        lastDriftChangeCount: null,
        lastDriftCheckedAt: null,
        lastDriftErrorMessage: null,
        lastDriftFieldSummary: null,
        lastDriftHasMorePreview: false,
        lastDriftLiveCounts: null,
        lastDriftStatus: null,
        lastDriftSummary: null,
        lastErrorMessage: null,
        lastSuccessAt: null,
        nextBackupAt: '2026-07-10T08:00:00.000Z',
        nextDriftCheckAt: '2026-07-03T08:00:00.000Z',
        nextRetentionPruneAt: null,
        retentionDays: 180,
        updatedAt: '2026-07-03T08:00:00.000Z',
        ...overrides,
    };
}

function toSettingsRecord(record: TestSettingsRecord): StructureBackupSettingsRecord {
    return {
        ...record,
        createdAt: new Date(record.createdAt),
        lastAttemptAt: record.lastAttemptAt ? new Date(record.lastAttemptAt) : null,
        lastDriftCheckedAt: record.lastDriftCheckedAt ? new Date(record.lastDriftCheckedAt) : null,
        lastDriftFieldSummary: record.lastDriftFieldSummary
            ? {
                  names: readNumber(record.lastDriftFieldSummary.names),
                  permissions: readNumber(record.lastDriftFieldSummary.permissions),
                  positions: readNumber(record.lastDriftFieldSummary.positions),
                  parentMoves: readNumber(record.lastDriftFieldSummary.parentMoves),
                  typeChanges: readNumber(record.lastDriftFieldSummary.typeChanges),
                  roleVisuals: readNumber(record.lastDriftFieldSummary.roleVisuals),
              }
            : null,
        lastDriftLiveCounts: record.lastDriftLiveCounts
            ? {
                  roles: readNumber(record.lastDriftLiveCounts.roles),
                  categories: readNumber(record.lastDriftLiveCounts.categories),
                  channels: readNumber(record.lastDriftLiveCounts.channels),
              }
            : null,
        lastDriftSummary: record.lastDriftSummary
            ? {
                  creates: readNumber(record.lastDriftSummary.creates),
                  updates: readNumber(record.lastDriftSummary.updates),
                  deletes: readNumber(record.lastDriftSummary.deletes),
                  roles: readNumber(record.lastDriftSummary.roles),
                  categories: readNumber(record.lastDriftSummary.categories),
                  channels: readNumber(record.lastDriftSummary.channels),
              }
            : null,
        lastSuccessAt: record.lastSuccessAt ? new Date(record.lastSuccessAt) : null,
        nextBackupAt: record.nextBackupAt ? new Date(record.nextBackupAt) : null,
        nextDriftCheckAt: record.nextDriftCheckAt ? new Date(record.nextDriftCheckAt) : null,
        nextRetentionPruneAt: record.nextRetentionPruneAt ? new Date(record.nextRetentionPruneAt) : null,
        updatedAt: new Date(record.updatedAt),
    };
}

function readNumber(value: unknown): number {
    return Number.isInteger(value) && typeof value === 'number' && value >= 0 ? value : 0;
}

function createConvexDb(input: {
    mutationErrors?: Error[];
    mutationResults?: unknown[];
    queryErrors?: Error[];
    queryResults?: unknown[];
}): ConvexDatabase & {
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
        mutation(reference: unknown, args: unknown): Promise<unknown> {
            this.mutationCalls.push({ args, reference });
            const error = mutationErrors.shift();

            if (error) return Promise.reject(error);

            return Promise.resolve(mutationResults.shift());
        },
        query(reference: unknown, args: unknown): Promise<unknown> {
            this.queryCalls.push({ args, reference });
            const error = queryErrors.shift();

            if (error) return Promise.reject(error);

            return Promise.resolve(queryResults.shift());
        },
    };

    return {
        client: client as unknown as ConvexDatabase['client'] & typeof client,
        kind: 'convex',
        serviceName: 'web',
    };
}

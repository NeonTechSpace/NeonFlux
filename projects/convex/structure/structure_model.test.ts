import { describe, expect, it } from 'vitest';
import type { GenericId } from 'convex/values';

import {
    buildBackupSortCursor,
    buildObservedEventStateDocument,
    buildStructureBackupDocument,
    buildStructureBackupLeaseClaimPatch,
    buildStructureBackupLeaseClearPatch,
    buildStructureBackupSettingsPatch,
    buildStructureDriftLeaseClaimPatch,
    buildStructureDriftLeaseClearPatch,
    buildStructureScheduledDriftResultPatch,
    buildStructureImportActionDocument,
    buildStructureImportRunDocument,
    chooseLatestStructureDriftBaselineBackup,
    classifyStructureImportExecutionReclaim,
    isStructureBackupRetentionEligible,
    isStructureImportDecisionLedgerComplete,
    resolveExpiredStructureImportControl,
    resolveStructureExecutionIdMap,
    validateStructureImportDecisionSequences,
    toStructureBackupRecord,
    toStructureImportActionRecord,
    toStructureImportRunRecord,
    toStructureObservedEventStateRecord,
} from './structure_model.js';

const now = '2026-06-28T12:00:00.000Z';
const backupId = 'backup-1' as GenericId<'structureBackups'>;
const runId = 'run-1' as GenericId<'structureImportRuns'>;
const actionId = 'action-1' as GenericId<'structureImportActions'>;

describe('structure model', () => {
    it('seeds executions with every resolved source-to-target match and leaves creates unresolved', () => {
        expect(
            resolveStructureExecutionIdMap({
                sourceTargetMap: {
                    'source-category': 'target-category',
                    'source-channel': 'target-channel',
                    'source-create': null,
                    'source-role': 'target-role',
                },
            })
        ).toStrictEqual({
            'source-category': 'target-category',
            'source-channel': 'target-channel',
            'source-role': 'target-role',
        });
    });

    it('rejects malformed execution source-to-target maps', () => {
        expect(() => resolveStructureExecutionIdMap({})).toThrow('structure-plan-source-target-map-invalid');
        expect(() => resolveStructureExecutionIdMap({ sourceTargetMap: { source: 42 } })).toThrow(
            'structure-plan-source-target-map-invalid'
        );
    });

    it('builds backups with defaults and validates structure shape', () => {
        const backup = unwrap(
            buildStructureBackupDocument(
                {
                    createdByUserId: ' actor-1 ',
                    guildId: ' guild-1 ',
                    structure: { roles: [{ id: 'role-1' }] },
                    source: ' manual ',
                },
                now
            )
        );
        const invalid = buildStructureBackupDocument({ guildId: 'guild-1', structure: [] as never }, now);

        expect(backup).toMatchObject({
            createdByUserId: 'actor-1',
            guildId: 'guild-1',
            source: 'manual',
            status: 'succeeded',
        });
        expect(toStructureBackupRecord({ ...backup, _id: backupId }).id).toBe(backupId);
        expect(invalid).toStrictEqual({ error: { field: 'structure', type: 'invalid-value' }, ok: false });
    });

    it('builds restore-point backups with source-specific default names', () => {
        const backup = unwrap(
            buildStructureBackupDocument(
                {
                    guildId: 'guild-1',
                    serverName: 'NeonSpace',
                    source: 'restore_point',
                    structure: { roles: [] },
                },
                now
            )
        );
        const invalid = buildStructureBackupDocument(
            {
                guildId: 'guild-1',
                source: 'legacy_restore',
                structure: { roles: [] },
            },
            now
        );

        expect(backup).toMatchObject({
            name: 'NeonSpace - restore point - 2026-06-28 - 12-00',
            source: 'restore_point',
        });
        expect(invalid).toStrictEqual({ error: { field: 'source', type: 'invalid-value' }, ok: false });
    });

    it('builds stable backup sort cursors for backups created at the same time', () => {
        const first = unwrap(
            buildStructureBackupDocument(
                {
                    guildId: 'guild-1',
                    sortKey: buildBackupSortCursor({ createdAt: now, id: 'backup-1' }),
                    structure: { roles: [] },
                },
                now
            )
        );
        const second = unwrap(
            buildStructureBackupDocument(
                {
                    guildId: 'guild-1',
                    sortKey: buildBackupSortCursor({ createdAt: now, id: 'backup-2' }),
                    structure: { roles: [] },
                },
                now
            )
        );

        expect(first.sortKey).toBe('2026-06-28T12:00:00.000Z|backup-1');
        expect(second.sortKey).toBe('2026-06-28T12:00:00.000Z|backup-2');
        expect([second, first].sort((left, right) => right.sortKey.localeCompare(left.sortKey))).toStrictEqual([
            second,
            first,
        ]);
    });

    it('chooses the latest regular successful backup with JSON as the drift baseline', () => {
        const olderManual = unwrap(
            buildStructureBackupDocument(
                {
                    guildId: 'guild-1',
                    source: 'manual',
                    sortKey: buildBackupSortCursor({ createdAt: '2026-06-27T12:00:00.000Z', id: 'backup-1' }),
                    structure: { roles: [] },
                },
                '2026-06-27T12:00:00.000Z'
            )
        );
        const latestScheduled = unwrap(
            buildStructureBackupDocument(
                {
                    guildId: 'guild-1',
                    source: 'scheduled',
                    sortKey: buildBackupSortCursor({ createdAt: '2026-06-28T12:00:00.000Z', id: 'backup-2' }),
                    structure: { roles: [] },
                },
                now
            )
        );
        const restorePoint = unwrap(
            buildStructureBackupDocument(
                {
                    guildId: 'guild-1',
                    source: 'restore_point',
                    sortKey: buildBackupSortCursor({ createdAt: '2026-06-29T12:00:00.000Z', id: 'backup-3' }),
                    structure: { roles: [] },
                },
                '2026-06-29T12:00:00.000Z'
            )
        );
        const failed = unwrap(
            buildStructureBackupDocument(
                {
                    errorMessage: 'read failed',
                    guildId: 'guild-1',
                    source: 'manual',
                    status: 'failed',
                },
                '2026-06-30T12:00:00.000Z'
            )
        );

        expect(
            chooseLatestStructureDriftBaselineBackup([olderManual, latestScheduled, restorePoint, failed])
        ).toStrictEqual(latestScheduled);
        expect(chooseLatestStructureDriftBaselineBackup([restorePoint, failed])).toBeUndefined();
    });

    it('keeps restore points for the recovery window and while linked to unresolved executions', () => {
        const cutoff = '2026-06-11T00:00:00.000Z';
        expect(
            isStructureBackupRetentionEligible(
                { createdAt: '2026-06-20T00:00:00.000Z', id: 'recent', source: 'restore_point' },
                { protectedRestorePointIds: new Set(), restorePointCutoff: cutoff }
            )
        ).toBe(false);
        expect(
            isStructureBackupRetentionEligible(
                { createdAt: '2026-05-01T00:00:00.000Z', id: 'linked', source: 'restore_point' },
                { protectedRestorePointIds: new Set(['linked']), restorePointCutoff: cutoff }
            )
        ).toBe(false);
        expect(
            isStructureBackupRetentionEligible(
                { createdAt: '2026-05-01T00:00:00.000Z', id: 'expired', source: 'restore_point' },
                { protectedRestorePointIds: new Set(), restorePointCutoff: cutoff }
            )
        ).toBe(true);
    });

    it('never replays an expired lease with a started attempt', () => {
        expect(
            classifyStructureImportExecutionReclaim({
                hasStartedAttempt: true,
                leaseExpiresAt: '2026-07-11T09:59:59.000Z',
                now: '2026-07-11T10:00:00.000Z',
            })
        ).toBe('outcome_unknown');
        expect(
            classifyStructureImportExecutionReclaim({
                hasStartedAttempt: false,
                leaseExpiresAt: '2026-07-11T09:59:59.000Z',
                now: '2026-07-11T10:00:00.000Z',
            })
        ).toBe('reclaim');
        expect(resolveExpiredStructureImportControl('pause')).toBe('paused');
        expect(resolveExpiredStructureImportControl('cancel')).toBe('cancelled');
    });

    it('rejects sparse and colliding decision-ledger sequences', () => {
        expect(validateStructureImportDecisionSequences([10, 12])).toBe('sparse');
        expect(validateStructureImportDecisionSequences([1, 0])).toBe('sparse');
        expect(validateStructureImportDecisionSequences([2, 3], [], 0)).toBe('gap');
        expect(validateStructureImportDecisionSequences([10, 11], [3, 11])).toBe('collision');
        expect(validateStructureImportDecisionSequences([10, 11], [3, 4])).toBeNull();
    });

    it('requires a complete contiguous decision ledger before review', () => {
        const plan = { decisionSummary: { create: 1, update: 1, delete: 0 } };
        expect(
            isStructureImportDecisionLedgerComplete(plan, [
                { classification: 'create', sequence: 0 },
                { classification: 'update', sequence: 1 },
            ])
        ).toBe(true);
        expect(isStructureImportDecisionLedgerComplete(plan, [{ classification: 'create', sequence: 0 }])).toBe(false);
        expect(
            isStructureImportDecisionLedgerComplete(plan, [
                { classification: 'create', sequence: 0 },
                { classification: 'update', sequence: 2 },
            ])
        ).toBe(false);
    });

    it('builds clean v2 import runs', () => {
        const run = unwrap(
            buildStructureImportRunDocument(
                {
                    createdByUserId: 'actor-1',
                    deleteActionCount: 0,
                    guildId: 'guild-1',
                    plan: { summary: { creates: 1 } },
                    planDigest: 'plan-digest',
                    planVersion: 2,
                    policy: 'merge',
                    requestedSnapshotDigest: 'snapshot-digest',
                    sourceBackupId: 'backup-1',
                },
                now
            )
        );

        expect(toStructureImportRunRecord({ ...run, _id: runId })).toMatchObject({
            deleteActionCount: 0,
            deleteSetDigest: null,
            id: runId,
            sourceBackupId: backupId,
            status: 'building',
        });
    });

    it('recalculates next automatic backup time when cadence changes', () => {
        const patch = unwrap(
            buildStructureBackupSettingsPatch(
                {
                    cadenceWeeks: 1,
                    createdAt: now,
                    enabled: true,
                    guildId: 'guild-1',
                    nextBackupAt: '2026-07-05T12:00:00.000Z',
                    retentionDays: 180,
                    updatedAt: now,
                },
                {
                    cadenceWeeks: 4,
                    enabled: true,
                    guildId: 'guild-1',
                },
                now
            )
        );

        expect(patch).toMatchObject({
            cadenceWeeks: 4,
            enabled: true,
            nextBackupAt: '2026-07-26T12:00:00.000Z',
            nextDriftCheckAt: '2026-06-28T12:00:00.000Z',
        });
    });

    it('clears next automatic backup time when automatic backups are disabled', () => {
        const patch = unwrap(
            buildStructureBackupSettingsPatch(
                {
                    cadenceWeeks: 1,
                    createdAt: now,
                    enabled: true,
                    guildId: 'guild-1',
                    nextBackupAt: '2026-07-05T12:00:00.000Z',
                    retentionDays: 180,
                    updatedAt: now,
                },
                {
                    cadenceWeeks: 1,
                    enabled: false,
                    guildId: 'guild-1',
                },
                now
            )
        );

        expect(patch).toMatchObject({
            cadenceWeeks: 1,
            enabled: false,
            nextBackupAt: undefined,
            nextDriftCheckAt: undefined,
        });
    });

    it('claims due scheduled drift settings including legacy enabled rows without nextDriftCheckAt', () => {
        const legacyPatch = unwrap(
            buildStructureDriftLeaseClaimPatch(
                {
                    cadenceWeeks: 1,
                    createdAt: now,
                    enabled: true,
                    guildId: 'guild-1',
                    nextBackupAt: '2026-07-05T12:00:00.000Z',
                    retentionDays: 180,
                    updatedAt: now,
                },
                {
                    leaseExpiresAt: '2026-06-28T12:30:00.000Z',
                    leaseId: 'drift-lease-1',
                    leaseOwner: 'bot-1',
                },
                now
            )
        );
        const activeLease = unwrap(
            buildStructureDriftLeaseClaimPatch(
                {
                    cadenceWeeks: 1,
                    createdAt: now,
                    driftLeaseExpiresAt: '2026-06-28T12:10:00.000Z',
                    driftLeaseId: 'lease-active',
                    driftLeaseOwner: 'bot-active',
                    driftLeaseStartedAt: '2026-06-28T11:50:00.000Z',
                    enabled: true,
                    guildId: 'guild-1',
                    nextDriftCheckAt: '2026-06-28T11:59:00.000Z',
                    retentionDays: 180,
                    updatedAt: now,
                },
                {
                    leaseExpiresAt: '2026-06-28T12:30:00.000Z',
                    leaseId: 'drift-lease-2',
                    leaseOwner: 'bot-2',
                },
                now
            )
        );

        expect(legacyPatch).toMatchObject({
            driftLeaseExpiresAt: '2026-06-28T12:30:00.000Z',
            driftLeaseId: 'drift-lease-1',
            driftLeaseOwner: 'bot-1',
            driftLeaseStartedAt: now,
            nextDriftCheckAt: now,
        });
        expect(activeLease).toBeNull();
    });

    it('clears matching scheduled drift leases and records compact drift results', () => {
        const existing = {
            cadenceWeeks: 1,
            createdAt: now,
            driftLeaseExpiresAt: '2026-06-28T12:30:00.000Z',
            driftLeaseId: 'drift-lease-1',
            driftLeaseOwner: 'bot-1',
            driftLeaseStartedAt: now,
            enabled: true,
            guildId: 'guild-1',
            nextDriftCheckAt: '2026-06-28T11:59:00.000Z',
            retentionDays: 180,
            updatedAt: now,
        };
        const clearPatch = unwrap(buildStructureDriftLeaseClearPatch(existing, { leaseId: 'drift-lease-1' }, now));
        const resultPatch = unwrap(
            buildStructureScheduledDriftResultPatch(
                existing,
                {
                    baselineBackupId: ' backup-1 ',
                    baselineName: ' Baseline ',
                    changeCount: 2,
                    fieldSummary: { names: 1 },
                    hasMorePreview: true,
                    liveCounts: { roles: 1, categories: 0, channels: 1 },
                    status: 'changed',
                    summary: { creates: 1, updates: 1, deletes: 0, roles: 1, categories: 0, channels: 1 },
                },
                now
            )
        );

        expect(clearPatch).toStrictEqual({
            driftLeaseExpiresAt: undefined,
            driftLeaseId: undefined,
            driftLeaseOwner: undefined,
            driftLeaseStartedAt: undefined,
            updatedAt: now,
        });
        expect(resultPatch).toMatchObject({
            driftLeaseExpiresAt: undefined,
            driftLeaseId: undefined,
            lastDriftBaselineBackupId: 'backup-1',
            lastDriftBaselineName: 'Baseline',
            lastDriftChangeCount: 2,
            lastDriftCheckedAt: now,
            lastDriftFieldSummary: { names: 1 },
            lastDriftHasMorePreview: true,
            lastDriftLiveCounts: { roles: 1, categories: 0, channels: 1 },
            lastDriftStatus: 'changed',
            nextDriftCheckAt: '2026-06-29T12:00:00.000Z',
        });
    });

    it('claims only due automatic backup settings without an active lease', () => {
        const patch = unwrap(
            buildStructureBackupLeaseClaimPatch(
                {
                    cadenceWeeks: 1,
                    createdAt: now,
                    enabled: true,
                    guildId: 'guild-1',
                    nextBackupAt: '2026-06-28T11:59:00.000Z',
                    retentionDays: 180,
                    updatedAt: now,
                },
                {
                    leaseExpiresAt: '2026-06-28T12:30:00.000Z',
                    leaseId: 'lease-1',
                    leaseOwner: 'bot-1',
                },
                now
            )
        );
        const activeLease = unwrap(
            buildStructureBackupLeaseClaimPatch(
                {
                    backupLeaseExpiresAt: '2026-06-28T12:10:00.000Z',
                    backupLeaseId: 'lease-active',
                    backupLeaseOwner: 'bot-active',
                    backupLeaseStartedAt: '2026-06-28T11:50:00.000Z',
                    cadenceWeeks: 1,
                    createdAt: now,
                    enabled: true,
                    guildId: 'guild-1',
                    nextBackupAt: '2026-06-28T11:59:00.000Z',
                    retentionDays: 180,
                    updatedAt: now,
                },
                {
                    leaseExpiresAt: '2026-06-28T12:30:00.000Z',
                    leaseId: 'lease-2',
                    leaseOwner: 'bot-2',
                },
                now
            )
        );

        expect(patch).toMatchObject({
            backupLeaseExpiresAt: '2026-06-28T12:30:00.000Z',
            backupLeaseId: 'lease-1',
            backupLeaseOwner: 'bot-1',
            backupLeaseStartedAt: now,
        });
        expect(activeLease).toBeNull();
    });

    it('clears only the matching automatic backup lease', () => {
        const existing = {
            backupLeaseExpiresAt: '2026-06-28T12:30:00.000Z',
            backupLeaseId: 'lease-1',
            backupLeaseOwner: 'bot-1',
            backupLeaseStartedAt: '2026-06-28T12:00:00.000Z',
            cadenceWeeks: 1,
            createdAt: now,
            enabled: true,
            guildId: 'guild-1',
            nextBackupAt: '2026-06-28T11:59:00.000Z',
            retentionDays: 180,
            updatedAt: now,
        };
        const patch = unwrap(buildStructureBackupLeaseClearPatch(existing, { leaseId: 'lease-1' }, now));
        const mismatch = unwrap(buildStructureBackupLeaseClearPatch(existing, { leaseId: 'lease-2' }, now));

        expect(patch).toStrictEqual({
            backupLeaseExpiresAt: undefined,
            backupLeaseId: undefined,
            backupLeaseOwner: undefined,
            backupLeaseStartedAt: undefined,
            updatedAt: now,
        });
        expect(mismatch).toBeNull();
    });

    it('builds import action records with null optional target ids', () => {
        const action = unwrap(
            buildStructureImportActionDocument(
                {
                    actionType: 'create',
                    details: { name: 'announcements' },
                    runId: 'run-1',
                    sequence: 0,
                    targetType: 'channel',
                },
                now
            )
        );

        expect(toStructureImportActionRecord({ ...action, _id: actionId })).toMatchObject({
            id: actionId,
            runId,
            targetId: null,
        });
    });

    it('rejects import action records without an explicit sequence', () => {
        const invalid = buildStructureImportActionDocument(
            {
                actionType: 'create',
                details: { name: 'announcements' },
                runId: 'run-1',
                targetType: 'channel',
            },
            now
        );

        expect(invalid).toStrictEqual({
            error: { field: 'sequence', type: 'invalid-value' },
            ok: false,
        });
    });

    it('increments observed event state and reads malformed counters as zero', () => {
        const existing = toStructureObservedEventStateRecord({
            config: { observedChangeCount: 'bad' },
            guildId: 'guild-1',
        });
        const observed = unwrap(
            buildObservedEventStateDocument(
                {
                    eventType: 'role.created',
                    guildId: 'guild-1',
                    targetId: 'role-1',
                    targetType: 'role',
                },
                existing,
                now
            )
        );
        const record = toStructureObservedEventStateRecord(observed);

        expect(existing.observedChangeCount).toBe(0);
        expect(record).toMatchObject({
            guildId: 'guild-1',
            lastEventType: 'role.created',
            lastObservedAt: now,
            lastTargetId: 'role-1',
            lastTargetType: 'role',
            observedChangeCount: 1,
            targetChangeCounts: { role: 1 },
        });
    });
});

function unwrap<TValue>(result: { ok: true; value: TValue } | { error: unknown; ok: false }): TValue {
    if (!result.ok) throw new Error(JSON.stringify(result.error));
    return result.value;
}

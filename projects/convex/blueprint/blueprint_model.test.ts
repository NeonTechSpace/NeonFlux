import type { BlueprintSnapshot } from '@neonflux/blueprint/snapshot';
import { describe, expect, it } from 'vitest';

import {
    classifyBlueprintRunReclaim,
    isBlueprintRunMutationAuthorizedForLease,
    isBlueprintRunRetryPreflightFresh,
    resolveExpiredBlueprintRunControl,
    resolveBlueprintRunAuthorizationDecision,
    resolveBlueprintRunStepAttemptCompletionStatus,
    resolveBlueprintRunStepAttemptCompletionRetry,
    selectBlueprintRunClaimAttempt,
    resolveBlueprintRunReferenceAuthority,
    resolveBlueprintRunIdMap,
    validateBlueprintRunAttemptIdMapTransition,
    validateBlueprintRunAttemptIndexedMappingDelta,
    validateBlueprintRunCheckpointIdMap,
    validateBlueprintRunIdMapTransition,
    validateBlueprintRunProgressTransition,
    validateBlueprintRunStepAttemptCompletionTransition,
} from './blueprint_run_model.js';
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
    chooseLatestStructureDriftBaselineBackup,
    isStructureBackupRetentionEligible,
    toStructureObservedEventStateRecord,
} from './structure_backup_model.js';

const now = '2026-06-28T12:00:00.000Z';
const emptySnapshot: BlueprintSnapshot = { version: 1, roles: [], categories: [], channels: [] };

describe('structure model', () => {
    it.each([
        [{ fingerprintVersionsCurrent: false }, 'fingerprint_version_mismatch'],
        [{ preflightExpiresAt: '2026-06-28T11:59:59.000Z' }, 'preflight_expired'],
        [{ restoreObservationEqual: false }, 'restore_observation_diverged'],
        [{ structureChanged: true, capabilityChanged: true }, 'structure_and_capability_changed'],
        [{ structureChanged: true }, 'structure_changed'],
        [{ capabilityChanged: true }, 'capability_changed'],
        [{}, undefined],
    ] as const)('classifies mutation-fence authorization decision %#', (override, expected) => {
        expect(
            resolveBlueprintRunAuthorizationDecision({
                capabilityChanged: false,
                fingerprintVersionsCurrent: true,
                now,
                preflightExpiresAt: '2026-06-28T12:05:00.000Z',
                restoreObservationEqual: true,
                structureChanged: false,
                ...override,
            })
        ).toBe(expected);
    });

    it('requires retry preflight to postdate a failed-before-mutation run', () => {
        const failedRun = {
            status: 'failed_before_mutation',
            updatedAt: '2026-06-28T12:01:00.000Z',
        };

        expect(
            isBlueprintRunRetryPreflightFresh({
                latestRun: failedRun,
                preflightCheckedAt: '2026-06-28T12:00:00.000Z',
            })
        ).toBe(false);
        expect(
            isBlueprintRunRetryPreflightFresh({
                latestRun: failedRun,
                preflightCheckedAt: failedRun.updatedAt,
            })
        ).toBe(false);
        expect(
            isBlueprintRunRetryPreflightFresh({
                latestRun: failedRun,
                preflightCheckedAt: '2026-06-28T12:02:00.000Z',
            })
        ).toBe(true);
        expect(
            isBlueprintRunRetryPreflightFresh({
                latestRun: { ...failedRun, status: 'cancelled' },
                preflightCheckedAt: '2026-06-28T12:00:00.000Z',
            })
        ).toBe(true);
        expect(
            isBlueprintRunRetryPreflightFresh({
                preflightCheckedAt: '2026-06-28T12:00:00.000Z',
            })
        ).toBe(true);
    });

    it('requires lease-fenced authorization before the first provider mutation', () => {
        const boundary = {
            completedMutationSteps: 0,
            expiresAt: '2026-06-28T12:05:00.000Z',
            nextStepSequence: 0,
            now,
        };
        expect(
            isBlueprintRunMutationAuthorizedForLease({
                completedMutationSteps: 0,
                expiresAt: boundary.expiresAt,
                leaseId: 'lease-2',
                mutationAuthorizedAt: now,
                mutationAuthorizationLeaseId: 'lease-1',
                nextStepSequence: 0,
                now,
            })
        ).toBe(false);
        expect(
            isBlueprintRunMutationAuthorizedForLease({
                completedMutationSteps: 0,
                expiresAt: boundary.expiresAt,
                leaseId: 'lease-1',
                mutationAuthorizedAt: now,
                mutationAuthorizationLeaseId: 'lease-1',
                nextStepSequence: 0,
                now,
            })
        ).toBe(true);
    });

    it('seeds runs with every resolved source-to-target match and leaves creates unresolved', () => {
        expect(
            resolveBlueprintRunIdMap({
                knownTargetKinds: {
                    'target-category': 'category',
                    'target-channel': 'channel',
                    'target-role': 'role',
                },
                sourceTargetMap: {
                    'source-category': 'target-category',
                    'source-channel': 'target-channel',
                    'source-create': null,
                    'source-role': 'target-role',
                },
                initialIdMap: {
                    'source-category': 'target-category',
                    'source-channel': 'target-channel',
                    'source-role': 'target-role',
                },
            })
        ).toStrictEqual({
            'source-category': 'target-category',
            'source-channel': 'target-channel',
            'source-role': 'target-role',
        });
    });

    it('rejects malformed run source-to-target maps', () => {
        expect(() => resolveBlueprintRunIdMap({})).toThrow('blueprint-run-id-map-invalid');
        expect(() =>
            resolveBlueprintRunIdMap({ initialIdMap: {}, knownTargetKinds: {}, sourceTargetMap: { source: 42 } })
        ).toThrow('blueprint-plan-source-target-map-invalid');
        expect(() =>
            resolveBlueprintRunIdMap({ initialIdMap: {}, knownTargetKinds: { target: 'guild' }, sourceTargetMap: {} })
        ).toThrow('blueprint-plan-known-target-kinds-invalid');
    });

    it('keeps destination identity authority separate from unresolved creates', () => {
        expect(
            resolveBlueprintRunReferenceAuthority({
                knownTargetKinds: {
                    'guild-1': 'role',
                    'retained-category': 'category',
                    'target-category': 'category',
                },
                sourceTargetMap: {
                    'created-channel': null,
                    'matched-category': 'target-category',
                },
                initialIdMap: { 'matched-category': 'target-category' },
            })
        ).toStrictEqual({
            idMap: { 'matched-category': 'target-category' },
            knownTargetKinds: {
                'guild-1': 'role',
                'retained-category': 'category',
                'target-category': 'category',
            },
        });
    });

    it('allows only monotonic create-id extensions of a run map', () => {
        const plan = {
            initialIdMap: { 'source-matched': 'target-role' },
            knownTargetKinds: { 'guild-1': 'role', 'target-role': 'role' },
            sourceTargetMap: {
                'source-created': null,
                'source-matched': 'target-role',
            },
        };

        expect(
            validateBlueprintRunIdMapTransition({
                next: { 'source-created': 'created-role', 'source-matched': 'target-role' },
                authority: plan,
                previous: { 'source-matched': 'target-role' },
            })
        ).toStrictEqual({ 'source-created': 'created-role', 'source-matched': 'target-role' });
        expect(() =>
            validateBlueprintRunIdMapTransition({
                next: { 'source-matched': 'different-role' },
                authority: plan,
                previous: { 'source-matched': 'target-role' },
            })
        ).toThrow('blueprint-run-id-map-regression');
        expect(() =>
            validateBlueprintRunIdMapTransition({
                next: { 'unknown-source': 'created-role', 'source-matched': 'target-role' },
                authority: plan,
                previous: { 'source-matched': 'target-role' },
            })
        ).toThrow('blueprint-run-id-map-unknown-source');
    });

    it('lets an applied recreate replace only its deleted source mapping with the provider id', () => {
        const plan = {
            initialIdMap: { 'source-channel': 'old-channel' },
            knownTargetKinds: { 'guild-1': 'role', 'old-channel': 'channel' },
            sourceTargetMap: { 'source-channel': 'old-channel' },
        };

        expect(
            validateBlueprintRunAttemptIdMapTransition({
                planStep: { actionType: 'create', targetId: 'source-channel' },
                attemptState: 'started',
                createdId: 'new-channel',
                next: { 'source-channel': 'new-channel' },
                authority: plan,
                previous: { 'source-channel': 'old-channel' },
                resultState: 'applied',
            })
        ).toStrictEqual({ 'source-channel': 'new-channel' });
        expect(
            validateBlueprintRunCheckpointIdMap({
                next: { 'source-channel': 'new-channel' },
                authority: plan,
                previous: { 'source-channel': 'new-channel' },
            })
        ).toStrictEqual({ 'source-channel': 'new-channel' });
        expect(() =>
            validateBlueprintRunCheckpointIdMap({
                next: { 'source-channel': 'new-channel' },
                authority: plan,
                previous: { 'source-channel': 'old-channel' },
            })
        ).toThrow('blueprint-run-id-map-regression');
    });

    it('does not let pause or cancel hide a hard or unknown terminal plan-step result', () => {
        expect(
            resolveBlueprintRunStepAttemptCompletionStatus({
                controlRequest: 'pause',
                runStatus: 'pause_requested',
                requestedStatus: 'partially_applied',
            })
        ).toBe('partially_applied');
        expect(
            resolveBlueprintRunStepAttemptCompletionStatus({
                controlRequest: 'cancel',
                runStatus: 'pause_requested',
                requestedStatus: 'outcome_unknown',
            })
        ).toBe('outcome_unknown');
        expect(
            resolveBlueprintRunStepAttemptCompletionStatus({
                controlRequest: 'pause',
                runStatus: 'pause_requested',
                requestedStatus: 'running',
            })
        ).toBe('paused');
        expect(
            resolveBlueprintRunStepAttemptCompletionStatus({
                controlRequest: 'cancel',
                runStatus: 'pause_requested',
                requestedStatus: 'waiting_rate_limit',
            })
        ).toBe('cancelled');
    });

    it('persists only a valid newly-created ID mapping as a per-step delta', () => {
        expect(
            validateBlueprintRunAttemptIndexedMappingDelta({
                planStep: { actionType: 'create', targetId: 'created' },
                attemptState: 'started',
                resultState: 'applied',
                createdId: 'target-created',
                sourceMappingPresent: true,
                sourceTargetId: null,
                createdTargetKnown: false,
            })
        ).toStrictEqual({ sourceId: 'created', targetId: 'target-created' });
        expect(() =>
            validateBlueprintRunAttemptIndexedMappingDelta({
                planStep: { actionType: 'update', targetId: 'existing' },
                attemptState: 'started',
                resultState: 'applied',
                createdId: 'unexpected',
                sourceMappingPresent: false,
                sourceTargetId: undefined,
                createdTargetKnown: false,
            })
        ).toThrow('blueprint-run-id-map-attempt-change');
        expect(() =>
            validateBlueprintRunAttemptIndexedMappingDelta({
                planStep: { actionType: 'create', targetId: 'created' },
                attemptState: 'pending',
                resultState: 'applied',
                createdId: 'target-created',
                sourceMappingPresent: true,
                sourceTargetId: null,
                createdTargetKnown: false,
            })
        ).toThrow('blueprint-run-create-id-map-invalid');
        expect(() =>
            validateBlueprintRunAttemptIndexedMappingDelta({
                planStep: { actionType: 'create', targetId: 'created' },
                attemptState: 'started',
                resultState: 'applied',
                createdId: 'target-created',
                sourceMappingPresent: false,
                sourceTargetId: undefined,
                createdTargetKnown: false,
            })
        ).toThrow('blueprint-run-create-id-map-invalid');
        expect(() =>
            validateBlueprintRunAttemptIndexedMappingDelta({
                planStep: { actionType: 'create', targetId: 'created' },
                attemptState: 'started',
                resultState: 'applied',
                createdId: 'target-created',
                sourceMappingPresent: true,
                sourceTargetId: null,
                createdTargetKnown: true,
            })
        ).toThrow('blueprint-run-create-id-map-invalid');
    });

    it('keeps run counters and the plan-step cursor as one monotonic state', () => {
        const previous = {
            appliedSteps: 2,
            completedMutationSteps: 2,
            failedSteps: 1,
            nextStepSequence: 3,
            skippedSteps: 0,
            totalSteps: 5,
            totalMutationSteps: 5,
        };

        expect(() =>
            validateBlueprintRunProgressTransition({
                next: {
                    appliedSteps: 3,
                    completedMutationSteps: 3,
                    failedSteps: 1,
                    nextStepSequence: 4,
                    notStartedSteps: 1,
                    skippedSteps: 0,
                    totalMutationSteps: 5,
                },
                previous,
            })
        ).not.toThrow();
        expect(() =>
            validateBlueprintRunProgressTransition({
                next: {
                    appliedSteps: 3,
                    completedMutationSteps: 3,
                    failedSteps: 1,
                    nextStepSequence: 3,
                    notStartedSteps: 2,
                    skippedSteps: 0,
                    totalMutationSteps: 5,
                },
                previous,
            })
        ).toThrow('blueprint-run-progress-invalid');
        expect(() =>
            validateBlueprintRunProgressTransition({
                next: {
                    appliedSteps: 1,
                    completedMutationSteps: 1,
                    failedSteps: 2,
                    nextStepSequence: 3,
                    notStartedSteps: 2,
                    skippedSteps: 0,
                    totalMutationSteps: 5,
                },
                previous,
            })
        ).toThrow('blueprint-run-progress-regression');
    });

    it('accepts only the exact counter delta for a completed plan-step attempt', () => {
        const run = {
            appliedSteps: 2,
            completedMutationSteps: 2,
            failedSteps: 0,
            nextStepSequence: 2,
            skippedSteps: 0,
        };
        const applied = {
            appliedSteps: 3,
            completedMutationSteps: 3,
            failedSteps: 0,
            nextStepSequence: 3,
            skippedSteps: 0,
            state: 'applied' as const,
            status: 'running' as const,
        };
        expect(() =>
            validateBlueprintRunStepAttemptCompletionTransition({ attempt: { state: 'started' }, args: applied, run })
        ).not.toThrow();
        expect(() =>
            validateBlueprintRunStepAttemptCompletionTransition({
                attempt: { state: 'started' },
                args: { ...applied, appliedSteps: 4, completedMutationSteps: 4 },
                run,
            })
        ).toThrow('blueprint-run-attempt-progress-invalid');
        expect(() =>
            validateBlueprintRunStepAttemptCompletionTransition({
                attempt: { state: 'pending' },
                args: applied,
                run,
            })
        ).toThrow('blueprint-run-attempt-progress-invalid');
    });

    it('accepts an exact terminal completion retry and rejects a conflicting retry', () => {
        expect(
            resolveBlueprintRunStepAttemptCompletionRetry({
                attemptState: 'applied',
                completionDigest: 'digest-1',
                incomingDigest: 'digest-1',
            })
        ).toBe('return_committed');
        expect(() =>
            resolveBlueprintRunStepAttemptCompletionRetry({
                attemptState: 'applied',
                completionDigest: 'digest-1',
                incomingDigest: 'digest-2',
            })
        ).toThrow('blueprint-run-step-attempt-completion-conflict');
        expect(
            resolveBlueprintRunStepAttemptCompletionRetry({
                attemptState: 'started',
                incomingDigest: 'digest-1',
            })
        ).toBe('continue');
    });

    it('reuses only the latest unique pending attempt at claim time', () => {
        const failed = { attempt: 3, state: 'failed' } as const;
        const pending = { attempt: 4, state: 'pending' } as const;
        expect(selectBlueprintRunClaimAttempt([pending, failed])).toBe(pending);
        expect(selectBlueprintRunClaimAttempt([failed])).toBe(failed);
        expect(selectBlueprintRunClaimAttempt([])).toBeNull();
        expect(() => selectBlueprintRunClaimAttempt([pending, { attempt: 2, state: 'pending' }])).toThrow(
            'blueprint-run-pending-attempt-conflict'
        );
        expect(() => selectBlueprintRunClaimAttempt([pending, { attempt: 5, state: 'failed' }])).toThrow(
            'blueprint-run-pending-attempt-conflict'
        );
        expect(() => selectBlueprintRunClaimAttempt([pending, { attempt: 4, state: 'failed' }])).toThrow(
            'blueprint-run-step-attempt-history-invalid'
        );
    });

    it('builds backups with defaults and validates structure shape', () => {
        const backup = unwrap(
            buildStructureBackupDocument(
                {
                    createdByUserId: ' actor-1 ',
                    guildId: ' guild-1 ',
                    structure: emptySnapshot,
                    source: ' manual ',
                },
                now
            )
        );
        const invalid = buildStructureBackupDocument({ guildId: 'guild-1', structure: { roles: [] } }, now);

        expect(backup).toMatchObject({
            createdByUserId: 'actor-1',
            guildId: 'guild-1',
            source: 'manual',
            status: 'succeeded',
        });
        expect(invalid).toStrictEqual({ error: { field: 'structure', type: 'invalid-value' }, ok: false });
    });

    it('builds restore-point backups with source-specific default names', () => {
        const backup = unwrap(
            buildStructureBackupDocument(
                {
                    guildId: 'guild-1',
                    serverName: 'NeonSpace',
                    source: 'restore_point',
                    structure: emptySnapshot,
                },
                now
            )
        );
        const invalid = buildStructureBackupDocument(
            {
                guildId: 'guild-1',
                source: 'legacy_restore',
                structure: emptySnapshot,
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
                    structure: emptySnapshot,
                },
                now
            )
        );
        const second = unwrap(
            buildStructureBackupDocument(
                {
                    guildId: 'guild-1',
                    sortKey: buildBackupSortCursor({ createdAt: now, id: 'backup-2' }),
                    structure: emptySnapshot,
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
                    structure: emptySnapshot,
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
                    structure: emptySnapshot,
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
                    structure: emptySnapshot,
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

    it('keeps restore points for the recovery window and while linked to unresolved runs', () => {
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
            classifyBlueprintRunReclaim({
                hasStartedAttempt: true,
                leaseExpiresAt: '2026-07-11T09:59:59.000Z',
                now: '2026-07-11T10:00:00.000Z',
            })
        ).toBe('outcome_unknown');
        expect(
            classifyBlueprintRunReclaim({
                hasStartedAttempt: false,
                leaseExpiresAt: '2026-07-11T09:59:59.000Z',
                now: '2026-07-11T10:00:00.000Z',
            })
        ).toBe('reclaim');
        expect(resolveExpiredBlueprintRunControl('pause')).toBe('paused');
        expect(resolveExpiredBlueprintRunControl('cancel')).toBe('cancelled');
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

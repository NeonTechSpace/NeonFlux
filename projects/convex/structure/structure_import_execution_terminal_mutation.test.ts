import { describe, expect, it } from 'vitest';

import { classifyStructureImportExecutionReclaim } from './structure_model.js';
import {
    buildStructureImportExecutionPausedPatch,
    buildStructureImportExecutionTerminalPatch,
    resolveStructureImportExecutionFinalizationStatus,
} from './structure_import_execution_terminal_mutation.js';

describe('structure execution expired-attempt finalization', () => {
    it('makes an expired pause-requested started attempt outcome-unknown and clears every control fence', () => {
        expect(
            classifyStructureImportExecutionReclaim({
                hasStartedAttempt: true,
                leaseExpiresAt: '2026-07-11T11:59:00.000Z',
                now: '2026-07-11T12:00:00.000Z',
            })
        ).toBe('outcome_unknown');

        expect(
            buildStructureImportExecutionTerminalPatch({
                errorType: 'expired-lease-with-started-attempt',
                now: '2026-07-11T12:00:00.000Z',
                status: 'outcome_unknown',
            })
        ).toMatchObject({
            controlRequest: undefined,
            leaseExpiresAt: undefined,
            leaseId: undefined,
            leaseOwner: undefined,
            phase: 'complete',
            retryAt: undefined,
            status: 'outcome_unknown',
        });
    });

    it('honors control committed before a successful completion is finalized', () => {
        expect(
            resolveStructureImportExecutionFinalizationStatus({
                controlRequest: 'pause',
                executionStatus: 'pause_requested',
                requestedStatus: 'succeeded',
            })
        ).toBe('paused');
        expect(
            resolveStructureImportExecutionFinalizationStatus({
                controlRequest: 'cancel',
                executionStatus: 'pause_requested',
                requestedStatus: 'needs_reconciliation',
            })
        ).toBe('cancelled');
        expect(buildStructureImportExecutionPausedPatch('2026-07-12T12:00:00.000Z')).toMatchObject({
            controlRequest: undefined,
            heartbeatAt: undefined,
            leaseExpiresAt: undefined,
            leaseId: undefined,
            leaseOwner: undefined,
            phase: 'paused',
            retryAt: undefined,
            status: 'paused',
        });
    });

    it.each(['partially_applied', 'failed_before_mutation', 'outcome_unknown'] as const)(
        'does not let a concurrent control request hide the %s terminal outcome',
        (requestedStatus) => {
            expect(
                resolveStructureImportExecutionFinalizationStatus({
                    controlRequest: 'cancel',
                    executionStatus: 'pause_requested',
                    requestedStatus,
                })
            ).toBe(requestedStatus);
        }
    );
});

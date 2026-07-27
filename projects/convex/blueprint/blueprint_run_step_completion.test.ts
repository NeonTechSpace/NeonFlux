import { describe, expect, it } from 'vitest';

import {
    buildBlueprintRunStepCompletionPatches,
    decideBlueprintRunStepCompletion,
    type BlueprintRunStepCompletionInput,
} from './blueprint_run_step_completion.js';

describe('Blueprint run step completion decisions', () => {
    it.each([
        {
            label: 'normal applied progress',
            completion: createCompletion(),
            run: { status: 'running' },
            expected: {
                releaseLease: false,
                resolvedPhase: 'update',
                resolvedStatus: 'running',
                terminal: false,
            },
        },
        {
            label: 'rate limit releases the lease',
            completion: createCompletion({
                phase: 'waiting_rate_limit',
                retryAt: '2026-07-27T12:01:00.000Z',
                state: 'failed',
                status: 'waiting_rate_limit',
            }),
            run: { status: 'running' },
            expected: {
                releaseLease: true,
                resolvedPhase: 'waiting_rate_limit',
                resolvedStatus: 'waiting_rate_limit',
                terminal: false,
            },
        },
        {
            label: 'pause request wins after an applied result',
            completion: createCompletion(),
            run: { controlRequest: 'pause' as const, status: 'pause_requested' },
            expected: {
                auditAction: 'blueprint.run_paused',
                releaseLease: true,
                resolvedPhase: 'paused',
                resolvedStatus: 'paused',
                terminal: false,
            },
        },
        {
            label: 'cancel request terminalizes after an applied result',
            completion: createCompletion(),
            run: { controlRequest: 'cancel' as const, status: 'pause_requested' },
            expected: {
                releaseLease: false,
                resolvedPhase: 'complete',
                resolvedStatus: 'cancelled',
                terminal: true,
            },
        },
        {
            label: 'unknown outcome remains terminal',
            completion: createCompletion({
                appliedSteps: 0,
                completedMutationSteps: 0,
                errorType: 'mutation-outcome-unknown',
                phase: 'complete',
                state: 'unknown',
                status: 'outcome_unknown',
            }),
            run: { status: 'running' },
            expected: {
                releaseLease: false,
                resolvedPhase: 'complete',
                resolvedStatus: 'outcome_unknown',
                terminal: true,
            },
        },
    ])('$label', ({ completion, run, expected }) => {
        expect(decideBlueprintRunStepCompletion({ completion, run })).toStrictEqual(expected);
    });

    it.each([
        createCompletion({ phase: 'complete' }),
        createCompletion({ phase: 'waiting_rate_limit', state: 'failed', status: 'waiting_rate_limit' }),
        createCompletion({
            appliedSteps: 0,
            completedMutationSteps: 0,
            phase: 'complete',
            state: 'failed',
            status: 'failed_before_mutation',
        }),
        createCompletion({
            appliedSteps: 0,
            completedMutationSteps: 0,
            phase: 'update',
            state: 'unknown',
            status: 'outcome_unknown',
        }),
    ])('rejects an invalid requested outcome %#', (completion) => {
        expect(() => decideBlueprintRunStepCompletion({ completion, run: { status: 'running' } })).toThrow(
            'blueprint-run-attempt-outcome-invalid'
        );
    });

    it('builds the exact atomic patches from the resolved decision', () => {
        const completion = createCompletion({
            createdId: 'created-role-1',
            currentStepDomain: 'role',
            currentStepId: 'step-1',
            currentStepLabel: 'Update role',
        });
        const decision = decideBlueprintRunStepCompletion({
            completion,
            run: { controlRequest: 'pause', status: 'pause_requested' },
        });

        expect(
            buildBlueprintRunStepCompletionPatches({
                completion,
                completionDigest: 'digest-1',
                currentMappingCount: 2,
                decision,
                mappingCreated: true,
            })
        ).toStrictEqual({
            attemptPatch: {
                completedAt: completion.now,
                completionDigest: 'digest-1',
                createdId: 'created-role-1',
                state: 'applied',
                updatedAt: completion.now,
            },
            cursorPatch: {
                mappingCount: 3,
                updatedAt: completion.now,
            },
            runPatch: {
                appliedSteps: 1,
                completedMutationSteps: 1,
                controlRequest: undefined,
                currentStepDomain: 'role',
                currentStepId: 'step-1',
                currentStepLabel: 'Update role',
                errorType: undefined,
                failedSteps: 0,
                heartbeatAt: undefined,
                leaseExpiresAt: undefined,
                leaseId: undefined,
                leaseOwner: undefined,
                nextStepSequence: 1,
                notStartedSteps: 0,
                phase: 'paused',
                retryAt: undefined,
                skippedSteps: 0,
                status: 'paused',
                updatedAt: completion.now,
            },
        });
    });
});

function createCompletion(overrides: Partial<BlueprintRunStepCompletionInput> = {}): BlueprintRunStepCompletionInput {
    return {
        appliedSteps: 1,
        completedMutationSteps: 1,
        failedSteps: 0,
        nextStepSequence: 1,
        notStartedSteps: 0,
        now: '2026-07-27T12:00:00.000Z',
        phase: 'update',
        skippedSteps: 0,
        state: 'applied',
        status: 'running',
        ...overrides,
    };
}

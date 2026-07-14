import {
    approveBlueprintPlan,
    enqueueBlueprintRun,
    findLatestBlueprintRunForPlan,
    findBlueprintPlanWithStepsByGuildId,
    requestBlueprintRunControl,
    BLUEPRINT_RUN_PROTOCOL_VERSION,
} from '@neonflux/db';
import type * as NeonFluxDb from '@neonflux/db';
import { err, ok } from 'neverthrow';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getWebDb } from './db.server.js';
import { applyDashboardBlueprintPlan, controlDashboardBlueprintRun } from './dashboard-blueprint-apply.server.js';
import { getDashboardBlueprintDeleteApprovalText } from './dashboard-blueprint-contracts.js';
import { loadAuthorizedBlueprintContext } from './dashboard-blueprint-context.server.js';

vi.mock('@neonflux/db', async (importActual) => ({
    ...(await importActual<typeof NeonFluxDb>()),
    approveBlueprintPlan: vi.fn(),
    enqueueBlueprintRun: vi.fn(),
    findLatestBlueprintRunForPlan: vi.fn(),
    findBlueprintPlanWithStepsByGuildId: vi.fn(),
    requestBlueprintRunControl: vi.fn(),
}));
vi.mock('./db.server.js', () => ({ getWebDb: vi.fn() }));
vi.mock('./dashboard-blueprint-context.server.js', () => ({
    createBlueprintAuditInput: vi.fn((_context, action, targetId, metadata) => ({
        action,
        actorUserId: 'user-1',
        targetId,
        metadata,
    })),
    loadAuthorizedBlueprintContext: vi.fn(),
}));

const request = new Request('http://localhost/dashboard/guild-1/blueprint');
const now = new Date('2026-07-11T10:00:00.000Z');

describe('Server Blueprint enqueue boundary', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(getWebDb).mockResolvedValue({ db: {} } as never);
        vi.mocked(loadAuthorizedBlueprintContext).mockResolvedValue({
            type: 'authorized',
            guild: { id: 'guild-1' },
            actor: { actorUserId: 'user-1', metadata: {} },
        } as never);
    });

    it('enqueues the approved plan against the exact reviewed preflight digest', async () => {
        vi.mocked(findBlueprintPlanWithStepsByGuildId).mockResolvedValue(ok(createRun([{ actionType: 'create' }])));
        vi.mocked(enqueueBlueprintRun).mockResolvedValue(ok(createRunRecord('queued') as never));

        const result = await applyDashboardBlueprintPlan(request, {
            guildId: 'guild-1',
            planId: 'run-1',
            planDigest: 'plan-digest',
            preflightDigest: 'preflight-digest',
        });

        expect(result).toMatchObject({ type: 'queued', run: { status: 'queued' } });
        expect(enqueueBlueprintRun).toHaveBeenCalledWith(
            {},
            expect.objectContaining({
                planId: 'run-1',
                preflightDigest: 'preflight-digest',
                audit: expect.objectContaining({
                    action: 'blueprint.run_queued',
                    actorUserId: 'user-1',
                    targetId: 'run-1',
                }),
            })
        );
    });

    it.each([
        [{ type: 'blueprint-run-review-obsolete' }, { type: 'review-stale' }],
        [{ type: 'blueprint-guild-run-active' }, { type: 'run-active' }],
    ] as const)('preserves an actionable enqueue conflict for the UI', async (repositoryError, expected) => {
        vi.mocked(findBlueprintPlanWithStepsByGuildId).mockResolvedValue(ok(createRun([{ actionType: 'create' }])));
        vi.mocked(enqueueBlueprintRun).mockResolvedValue(err(repositoryError));

        const result = await applyDashboardBlueprintPlan(request, {
            guildId: 'guild-1',
            planId: 'run-1',
            planDigest: 'plan-digest',
            preflightDigest: 'preflight-digest',
        });

        expect(result).toEqual(expected);
    });

    it('does not enqueue an approved plan with no actions', async () => {
        vi.mocked(findBlueprintPlanWithStepsByGuildId).mockResolvedValue(ok(createRun([])));

        const result = await applyDashboardBlueprintPlan(request, {
            guildId: 'guild-1',
            planId: 'run-1',
            planDigest: 'plan-digest',
            preflightDigest: 'preflight-digest',
        });

        expect(result).toEqual({ type: 'nothing-to-apply' });
        expect(enqueueBlueprintRun).not.toHaveBeenCalled();
    });

    it('requires delete approval text bound to the persisted count and digest', async () => {
        vi.mocked(findBlueprintPlanWithStepsByGuildId).mockResolvedValue(ok(createRun([{ actionType: 'delete' }])));

        const result = await applyDashboardBlueprintPlan(request, {
            guildId: 'guild-1',
            planId: 'run-1',
            planDigest: 'plan-digest',
            preflightDigest: 'preflight-digest',
            destructiveConfirmationText: 'DELETE 1 wrong',
        });

        expect(result).toEqual({
            type: 'destructive-confirmation-mismatch',
            expectedText: getDashboardBlueprintDeleteApprovalText('run-1', 1, 'delete-digest'),
        });
        expect(approveBlueprintPlan).not.toHaveBeenCalled();
    });

    it('only allows cancellation while an run is queued or paused', async () => {
        vi.mocked(findLatestBlueprintRunForPlan).mockResolvedValue(ok(createRunRecord('running') as never));

        const result = await controlDashboardBlueprintRun(request, {
            guildId: 'guild-1',
            planId: 'run-1',
            runId: 'run-1',
            request: 'cancel',
        });

        expect(result).toEqual({ type: 'not-controllable', status: 'running' });
        expect(requestBlueprintRunControl).not.toHaveBeenCalled();
    });

    it('attributes an accepted pause command to the dashboard actor', async () => {
        vi.mocked(findLatestBlueprintRunForPlan).mockResolvedValue(ok(createRunRecord('running') as never));
        vi.mocked(requestBlueprintRunControl).mockResolvedValue(ok(createRunRecord('pause_requested') as never));

        const result = await controlDashboardBlueprintRun(request, {
            guildId: 'guild-1',
            planId: 'run-1',
            runId: 'run-1',
            request: 'pause',
        });

        expect(result).toMatchObject({ type: 'run-updated', status: 'pause_requested' });
        expect(requestBlueprintRunControl).toHaveBeenCalledWith(
            {},
            expect.objectContaining({
                audit: expect.objectContaining({
                    action: 'blueprint.run_pause_requested',
                    actorUserId: 'user-1',
                    targetId: 'run-1',
                }),
                request: 'pause',
            })
        );
    });

    it('rejects control of a durable run created by another protocol', async () => {
        vi.mocked(findLatestBlueprintRunForPlan).mockResolvedValue(
            ok({ ...createRunRecord('paused'), protocolVersion: BLUEPRINT_RUN_PROTOCOL_VERSION + 1 } as never)
        );

        const result = await controlDashboardBlueprintRun(request, {
            guildId: 'guild-1',
            planId: 'run-1',
            runId: 'run-1',
            request: 'resume',
        });

        expect(result).toEqual({
            type: 'run-protocol-incompatible',
            runProtocolVersion: BLUEPRINT_RUN_PROTOCOL_VERSION + 1,
            requiredProtocolVersion: BLUEPRINT_RUN_PROTOCOL_VERSION,
        });
        expect(requestBlueprintRunControl).not.toHaveBeenCalled();
    });
});

function createRun(steps: Array<{ actionType: string }>) {
    return {
        id: 'run-1',
        guildId: 'guild-1',
        deleteStepCount: steps.filter((step) => step.actionType === 'delete').length,
        deleteSetDigest: 'delete-digest',
        planDigest: 'plan-digest',
        planVersion: 2,
        policy: 'synchronize' as const,
        createdByUserId: 'user-1',
        status: 'approved',
        sourceBackupId: null,
        plan: {},
        requestedSnapshotDigest: 'snapshot-digest',
        createdAt: now,
        updatedAt: now,
        steps: steps.map((step, sequence) => ({
            id: `action-${sequence}`,
            planId: 'run-1',
            sequence,
            actionType: step.actionType,
            targetType: 'role',
            targetId: 'role-1',
            details: {},
            createdAt: now,
            updatedAt: now,
        })),
    };
}

function createRunRecord(status: string) {
    return {
        id: 'run-1',
        planId: 'run-1',
        guildId: 'guild-1',
        protocolVersion: BLUEPRINT_RUN_PROTOCOL_VERSION,
        status,
        totalSteps: 0,
        createdAt: now,
        updatedAt: now,
    };
}

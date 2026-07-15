import {
    approveBlueprintPlan,
    enqueueBlueprintRun,
    listLatestBlueprintRunSummaries,
    getBlueprintPlanMetadata,
    requestBlueprintRunControl,
    BLUEPRINT_RUN_PROTOCOL_VERSION,
} from '@neonflux/db';
import type * as NeonFluxDb from '@neonflux/db';
import type { BlueprintPlanMetadataRecord } from '@neonflux/db';
import { err, ok } from 'neverthrow';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getWebDb } from './db.server.js';
import { applyDashboardBlueprintPlan, controlDashboardBlueprintRun } from './dashboard-blueprint-apply.server.js';
import { loadAuthorizedBlueprintContext } from './dashboard-blueprint-context.server.js';

vi.mock('@neonflux/db', async (importActual) => ({
    ...(await importActual<typeof NeonFluxDb>()),
    approveBlueprintPlan: vi.fn(),
    enqueueBlueprintRun: vi.fn(),
    listLatestBlueprintRunSummaries: vi.fn(),
    getBlueprintPlanMetadata: vi.fn(),
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
            guild: { id: 'guild-1', name: 'Guild One' },
            actor: { actorUserId: 'user-1', metadata: {} },
        } as never);
        vi.mocked(approveBlueprintPlan).mockResolvedValue(ok({} as never));
    });

    it('enqueues the approved plan against the exact reviewed preflight digest', async () => {
        vi.mocked(getBlueprintPlanMetadata).mockResolvedValue(ok(createRun([{ actionType: 'create' }])));
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
        expect(approveBlueprintPlan).toHaveBeenCalledWith(
            {},
            expect.objectContaining({
                confirmationMethod: 'acknowledgement',
                destructivePreflightDigest: 'preflight-digest',
            })
        );
    });

    it.each([
        [{ type: 'blueprint-run-review-stale' }, { type: 'review-stale' }],
        [{ type: 'blueprint-guild-run-active' }, { type: 'run-active' }],
    ] as const)('preserves an actionable enqueue conflict for the UI', async (repositoryError, expected) => {
        vi.mocked(getBlueprintPlanMetadata).mockResolvedValue(ok(createRun([{ actionType: 'create' }])));
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
        vi.mocked(getBlueprintPlanMetadata).mockResolvedValue(ok(createRun([])));

        const result = await applyDashboardBlueprintPlan(request, {
            guildId: 'guild-1',
            planId: 'run-1',
            planDigest: 'plan-digest',
            preflightDigest: 'preflight-digest',
        });

        expect(result).toEqual({ type: 'nothing-to-apply' });
        expect(enqueueBlueprintRun).not.toHaveBeenCalled();
    });

    it('requires risk-based deletion acknowledgement', async () => {
        vi.mocked(getBlueprintPlanMetadata).mockResolvedValue(ok(createRun([{ actionType: 'delete' }])));

        const result = await applyDashboardBlueprintPlan(request, {
            guildId: 'guild-1',
            planId: 'run-1',
            planDigest: 'plan-digest',
            preflightDigest: 'preflight-digest',
            confirmation: {},
        });

        expect(result).toEqual({
            type: 'destructive-confirmation-mismatch',
            message: 'Acknowledge that 1 existing objects will be removed.',
        });
        expect(approveBlueprintPlan).not.toHaveBeenCalled();
    });

    it('requires rebuild acknowledgements and the NFC-normalized case-sensitive target name', async () => {
        vi.mocked(getBlueprintPlanMetadata).mockResolvedValue(
            ok(createRun([{ actionType: 'delete' }], { policy: 'rebuild' }))
        );

        const missingRestore = await applyDashboardBlueprintPlan(request, {
            guildId: 'guild-1',
            planId: 'run-1',
            planDigest: 'plan-digest',
            preflightDigest: 'preflight-digest',
            confirmation: { understandsDeletion: true, targetGuildName: 'Guild One' },
        });
        expect(missingRestore).toMatchObject({ type: 'destructive-confirmation-mismatch' });

        const wrongCase = await applyDashboardBlueprintPlan(request, {
            guildId: 'guild-1',
            planId: 'run-1',
            planDigest: 'plan-digest',
            preflightDigest: 'preflight-digest',
            confirmation: {
                understandsDeletion: true,
                understandsRestorePointRequirement: true,
                targetGuildName: 'guild one',
            },
        });
        expect(wrongCase).toMatchObject({ type: 'destructive-confirmation-mismatch' });
        expect(enqueueBlueprintRun).not.toHaveBeenCalled();
    });

    it('only allows cancellation while an run is queued or paused', async () => {
        vi.mocked(listLatestBlueprintRunSummaries).mockResolvedValue(
            ok({ 'run-1': createRunRecord('running') } as never)
        );

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
        vi.mocked(listLatestBlueprintRunSummaries).mockResolvedValue(
            ok({ 'run-1': createRunRecord('running') } as never)
        );
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
        vi.mocked(listLatestBlueprintRunSummaries).mockResolvedValue(
            ok({
                'run-1': {
                    ...createRunRecord('paused'),
                    protocolVersion: BLUEPRINT_RUN_PROTOCOL_VERSION + 1,
                },
            } as never)
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

function createRun(
    steps: Array<{ actionType: string }>,
    overrides: Partial<{ policy: 'merge' | 'synchronize' | 'rebuild' }> = {}
): BlueprintPlanMetadataRecord {
    return {
        id: 'run-1',
        guildId: 'guild-1',
        deleteStepCount: steps.filter((step) => step.actionType === 'delete').length,
        deleteSetDigest: 'delete-digest',
        planDigest: 'plan-digest',
        planVersion: 4 as const,
        policy: 'synchronize' as const,
        createdByUserId: 'user-1',
        status: 'approved' as const,
        sourceBackupId: null,
        requestedSnapshotDigest: 'snapshot-digest',
        projectedSnapshotDigest: 'projected-digest',
        authorityVersion: 1 as const,
        authorityDigest: 'authority-digest',
        executionAuthorityVersion: 1 as const,
        executionAuthorityDigest: 'execution-digest',
        stepCount: steps.length,
        stepLedgerDigest: 'step-digest',
        decisionCount: 0,
        decisionLedgerDigest: 'decision-digest',
        blockerCount: 0,
        summary: { creates: 0, updates: 0, deletes: 0, roles: 0, categories: 0, channels: 0 },
        decisionSummary: {
            noOp: 0,
            create: 0,
            update: 0,
            delete: 0,
            protectedRetained: 0,
            protectedOmitted: 0,
            unmanagedRetained: 0,
            blockedAmbiguous: 0,
            blockedUnsupported: 0,
        },
        createdAt: now,
        updatedAt: now,
        ...overrides,
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

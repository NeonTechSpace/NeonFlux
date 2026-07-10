import {
    approveStructureImportPlan,
    enqueueStructureImportExecution,
    findLatestStructureImportExecution,
    findStructureImportRunWithActionsByGuildId,
    requestStructureImportExecutionControl,
} from '@neonflux/db';
import type * as NeonFluxDb from '@neonflux/db';
import { ok } from 'neverthrow';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getWebDb } from './db.server.js';
import {
    applyDashboardStructureImportRun,
    controlDashboardStructureImportExecution,
} from './dashboard-structure-apply.server.js';
import { getDashboardStructureDeleteApprovalText } from './dashboard-structure-v2.js';
import { loadAuthorizedStructureContext } from './dashboard-structure-context.server.js';

vi.mock('@neonflux/db', async (importActual) => ({
    ...(await importActual<typeof NeonFluxDb>()),
    approveStructureImportPlan: vi.fn(),
    enqueueStructureImportExecution: vi.fn(),
    findLatestStructureImportExecution: vi.fn(),
    findStructureImportRunWithActionsByGuildId: vi.fn(),
    requestStructureImportExecutionControl: vi.fn(),
}));
vi.mock('./db.server.js', () => ({ getWebDb: vi.fn() }));
vi.mock('./dashboard-structure-context.server.js', () => ({
    createStructureAuditInput: vi.fn((_context, action, targetId, metadata) => ({
        action,
        actorUserId: 'user-1',
        targetId,
        metadata,
    })),
    loadAuthorizedStructureContext: vi.fn(),
}));

const request = new Request('http://localhost/dashboard/guild-1/structure');
const now = new Date('2026-07-11T10:00:00.000Z');

describe('Server Blueprint enqueue boundary', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(getWebDb).mockResolvedValue({ db: {} } as never);
        vi.mocked(loadAuthorizedStructureContext).mockResolvedValue({
            type: 'authorized',
            guild: { id: 'guild-1' },
            actor: { actorUserId: 'user-1', metadata: {} },
        } as never);
    });

    it('enqueues the approved plan against the exact reviewed preflight digest', async () => {
        vi.mocked(findStructureImportRunWithActionsByGuildId).mockResolvedValue(ok(createRun([])));
        vi.mocked(enqueueStructureImportExecution).mockResolvedValue(ok(createExecution('queued') as never));

        const result = await applyDashboardStructureImportRun(request, {
            guildId: 'guild-1',
            importRunId: 'run-1',
            planDigest: 'plan-digest',
            preflightDigest: 'preflight-digest',
        });

        expect(result).toMatchObject({ type: 'queued', execution: { status: 'queued' } });
        expect(enqueueStructureImportExecution).toHaveBeenCalledWith(
            {},
            expect.objectContaining({
                runId: 'run-1',
                preflightDigest: 'preflight-digest',
                audit: expect.objectContaining({
                    action: 'structure.import_execution_queued',
                    actorUserId: 'user-1',
                    targetId: 'run-1',
                }),
            })
        );
    });

    it('requires delete approval text bound to the persisted count and digest', async () => {
        vi.mocked(findStructureImportRunWithActionsByGuildId).mockResolvedValue(
            ok(createRun([{ actionType: 'delete' }]))
        );

        const result = await applyDashboardStructureImportRun(request, {
            guildId: 'guild-1',
            importRunId: 'run-1',
            planDigest: 'plan-digest',
            preflightDigest: 'preflight-digest',
            destructiveConfirmationText: 'DELETE 1 wrong',
        });

        expect(result).toEqual({
            type: 'destructive-confirmation-mismatch',
            expectedText: getDashboardStructureDeleteApprovalText('run-1', 1, 'delete-digest'),
        });
        expect(approveStructureImportPlan).not.toHaveBeenCalled();
    });

    it('only allows cancellation while an execution is queued or paused', async () => {
        vi.mocked(findLatestStructureImportExecution).mockResolvedValue(ok(createExecution('running') as never));

        const result = await controlDashboardStructureImportExecution(request, {
            guildId: 'guild-1',
            runId: 'run-1',
            executionId: 'execution-1',
            request: 'cancel',
        });

        expect(result).toEqual({ type: 'not-controllable', status: 'running' });
        expect(requestStructureImportExecutionControl).not.toHaveBeenCalled();
    });
});

function createRun(actions: Array<{ actionType: string }>) {
    return {
        id: 'run-1',
        guildId: 'guild-1',
        deleteActionCount: actions.filter((action) => action.actionType === 'delete').length,
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
        actions: actions.map((action, sequence) => ({
            id: `action-${sequence}`,
            runId: 'run-1',
            sequence,
            actionType: action.actionType,
            targetType: 'role',
            targetId: 'role-1',
            details: {},
            createdAt: now,
            updatedAt: now,
        })),
    };
}

function createExecution(status: string) {
    return {
        id: 'execution-1',
        runId: 'run-1',
        guildId: 'guild-1',
        status,
        totalActions: 0,
        createdAt: now,
        updatedAt: now,
    };
}

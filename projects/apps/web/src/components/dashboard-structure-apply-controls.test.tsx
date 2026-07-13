// @vitest-environment jsdom
/* eslint-disable testing-library/no-manual-cleanup -- Vitest globals are disabled, so RTL cannot register automatic cleanup. */

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { STRUCTURE_EXECUTION_PROTOCOL_VERSION } from '../dashboard-structure-execution-protocol.js';
import type { DashboardStructureImportRun } from '../server/dashboard-structure.server.js';
import {
    createEmptyDecisionSummary,
    getDashboardStructureDeleteApprovalText,
} from '../server/dashboard-structure-contracts.js';
import { DashboardStructureApplyControls } from './dashboard-structure-apply-controls.js';
import type { DashboardStructurePreflightView } from './dashboard-structure-panel-types.js';

afterEach(cleanup);

describe('DashboardStructureApplyControls', () => {
    it('blocks application after the safety check expires', () => {
        renderControls({ preflightReport: createPreflight({ expiresAt: '2025-01-01T00:00:00.000Z' }) });

        expect(screen.getByRole('alert').textContent).toContain('Safety check expired');
        expect(screen.queryByRole('button', { name: /Apply/ })).toBeNull();
        expect(screen.getByRole('button', { name: 'Refresh safety check' })).toBeTruthy();
    });

    it('requires the plan-bound phrase before a destructive apply', async () => {
        const run = createRun();
        const onApply = vi.fn();
        const expectedText = getDashboardStructureDeleteApprovalText(run.id, 1, run.deleteSetDigest ?? '');
        const preflightReport = createPreflight({ destructiveApprovalRequired: 1 });
        const view = renderControls({ run, preflightReport, onApply });

        const input = await screen.findByLabelText(/approve 1 irreversible delete/i);
        const applyButton = screen.getByRole('button', { name: 'Apply 1 change, including 1 deletion' });
        expect(applyButton.hasAttribute('disabled')).toBe(true);
        expect(input.compareDocumentPosition(applyButton) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

        view.rerender(
            <DashboardStructureApplyControls
                run={run}
                busyAction={undefined}
                preflightReport={preflightReport}
                deleteConfirmation={expectedText}
                onPreflight={vi.fn()}
                onDeleteConfirmationChange={vi.fn()}
                onApply={onApply}
            />
        );
        fireEvent.click(screen.getByRole('button', { name: 'Apply 1 change, including 1 deletion' }));
        expect(onApply).toHaveBeenCalledWith(run);
    });

    it('requires a safety check newer than a failed-before-mutation execution', async () => {
        const expiresAt = new Date(Date.now() + 60_000).toISOString();
        const run = createRun({
            execution: {
                id: 'execution-1',
                protocolVersion: STRUCTURE_EXECUTION_PROTOCOL_VERSION,
                status: 'failed_before_mutation',
                phase: 'complete',
                completedActions: 0,
                failedActions: 1,
                totalActions: 1,
                createdAt: '2026-07-13T10:00:00.000Z',
                updatedAt: '2026-07-13T10:01:00.000Z',
            },
        });
        const view = renderControls({
            run,
            preflightReport: createPreflight({ checkedAt: '2026-07-13T10:00:00.000Z', expiresAt }),
        });

        expect(screen.getByRole('alert').textContent).toContain('Fresh safety check required');
        expect(screen.queryByRole('button', { name: /Apply/ })).toBeNull();

        view.rerender(
            <DashboardStructureApplyControls
                run={run}
                busyAction={undefined}
                preflightReport={createPreflight({ checkedAt: '2026-07-13T10:02:00.000Z', expiresAt })}
                deleteConfirmation=''
                onPreflight={vi.fn()}
                onDeleteConfirmationChange={vi.fn()}
                onApply={vi.fn()}
            />
        );
        expect(await screen.findByRole('button', { name: 'Apply 1 change' })).toBeTruthy();
    });
});

function renderControls({
    run = createRun(),
    preflightReport = createPreflight({}),
    onApply = vi.fn(),
}: {
    run?: DashboardStructureImportRun;
    preflightReport?: DashboardStructurePreflightView;
    onApply?: (run: DashboardStructureImportRun) => void;
}) {
    return render(
        <DashboardStructureApplyControls
            run={run}
            busyAction={undefined}
            preflightReport={preflightReport}
            deleteConfirmation=''
            onPreflight={vi.fn()}
            onDeleteConfirmationChange={vi.fn()}
            onApply={onApply}
        />
    );
}

function createRun(overrides: Partial<DashboardStructureImportRun> = {}): DashboardStructureImportRun {
    return {
        id: 'run-1',
        status: 'approved',
        createdAt: '2026-07-13T10:00:00.000Z',
        updatedAt: '2026-07-13T10:00:00.000Z',
        summary: { creates: 0, updates: 0, deletes: 1, roles: 1, categories: 0, channels: 0 },
        actionCount: 1,
        executionActionCount: 1,
        planBlockerCount: 0,
        actions: [],
        policy: 'synchronize',
        decisionSummary: createEmptyDecisionSummary(),
        decisions: [],
        planDigest: 'plan-digest',
        deleteActionCount: 1,
        deleteSetDigest: 'delete-digest',
        ...overrides,
    };
}

function createPreflight({
    destructiveApprovalRequired = 0,
    checkedAt = '2026-07-13T10:00:00.000Z',
    expiresAt = new Date(Date.now() + 60_000).toISOString(),
}: {
    destructiveApprovalRequired?: number;
    checkedAt?: string;
    expiresAt?: string;
}): DashboardStructurePreflightView {
    return {
        summary: {
            total: 1,
            ready: destructiveApprovalRequired ? 0 : 1,
            stale: 0,
            mappingRequired: 0,
            destructiveApprovalRequired,
            unsupported: 0,
            invalidPlan: 0,
        },
        actions: [
            {
                actionId: 'action-1',
                actionType: 'delete',
                targetType: 'role',
                targetId: 'role-1',
                status: destructiveApprovalRequired ? 'destructive-approval-required' : 'ready',
                message: 'Ready.',
            },
        ],
        checkedAt,
        expiresAt,
    };
}

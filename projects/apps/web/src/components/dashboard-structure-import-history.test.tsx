// @vitest-environment jsdom
/* eslint-disable testing-library/no-manual-cleanup -- Vitest globals are disabled, so RTL cannot register automatic cleanup. */

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { STRUCTURE_EXECUTION_PROTOCOL_VERSION } from '../dashboard-structure-execution-protocol.js';
import type { DashboardStructureImportRun } from '../server/dashboard-structure.server.js';
import {
    createEmptyDecisionSummary,
    getDashboardStructureDeleteApprovalText,
} from '../server/dashboard-structure-contracts.js';
import type { DashboardStructurePreflightView } from './dashboard-structure-panel-types.js';
import { DashboardStructureImportHistory } from './dashboard-structure-import-history.js';

afterEach(cleanup);

describe('Server Blueprint action inspection', () => {
    it('keeps raw action details secondary while selecting the canonical Explorer item', () => {
        const run = createRun();
        render(
            <DashboardStructureImportHistory
                runs={[run]}
                latestRun={run}
                busyAction={undefined}
                preflightByRunId={{}}
                deleteConfirmationByRunId={{}}
                onDeleteConfirmationChange={vi.fn()}
                onApprove={vi.fn()}
                onPreflight={vi.fn()}
                onApply={vi.fn()}
                onControl={vi.fn()}
                onLoadActions={vi.fn()}
                onLoadDecisions={vi.fn()}
                onRecoveryPlan={vi.fn()}
            />
        );

        fireEvent.click(screen.getByRole('button', { name: 'Inspect' }));

        expect(screen.getByRole('complementary', { name: 'Action details: Neon Space' }).textContent).toContain(
            'update role'
        );
        expect(screen.getAllByText('role-target-1').length).toBeGreaterThan(1);
        expect(screen.getByRole('button', { name: 'Roles, 0' }).getAttribute('aria-pressed')).toBe('true');
        fireEvent.click(screen.getByRole('button', { name: 'Close' }));
        expect(screen.queryByRole('complementary', { name: 'Action details: Neon Space' })).toBeNull();
        expect(screen.getByRole('complementary', { name: 'Blueprint inspector' })).toBeTruthy();
    });

    it('does not offer controls for an execution owned by another protocol', () => {
        const onControl = vi.fn();
        const run = createRun({
            execution: {
                id: 'execution-1',
                protocolVersion: STRUCTURE_EXECUTION_PROTOCOL_VERSION + 1,
                status: 'running',
                phase: 'update',
                completedActions: 0,
                failedActions: 0,
                totalActions: 1,
                createdAt: '2026-07-11T12:00:00.000Z',
                updatedAt: '2026-07-11T12:00:00.000Z',
            },
        });
        render(
            <DashboardStructureImportHistory
                runs={[run]}
                latestRun={run}
                busyAction={undefined}
                preflightByRunId={{}}
                deleteConfirmationByRunId={{}}
                onDeleteConfirmationChange={vi.fn()}
                onApprove={vi.fn()}
                onPreflight={vi.fn()}
                onApply={vi.fn()}
                onControl={onControl}
                onLoadActions={vi.fn()}
                onLoadDecisions={vi.fn()}
                onRecoveryPlan={vi.fn()}
            />
        );

        const pauseButton = screen.getByRole('button', { name: 'Pause deployment' });
        expect(pauseButton.hasAttribute('disabled')).toBe(true);
        fireEvent.click(pauseButton);
        expect(onControl).not.toHaveBeenCalled();
        expect(screen.getByText(/controls are disabled because this deployment uses a different/i)).toBeTruthy();
    });

    it('turns review into one clear continuation to the final safety check', () => {
        const onApprove = vi.fn();
        const run = createRun({ status: 'review_ready' });

        renderHistory(run, { onApprove });
        fireEvent.click(screen.getByRole('button', { name: 'Continue to final check' }));

        expect(onApprove).toHaveBeenCalledWith(run);
        expect(screen.getByText(/immediately check the live server again/i)).toBeTruthy();
    });

    it('does not offer approval while the plan has blocked decisions', () => {
        const onApprove = vi.fn();
        const run = createRun({ status: 'review_ready', planBlockerCount: 2 });

        renderHistory(run, { onApprove });

        expect(screen.queryByRole('button', { name: 'Continue to final check' })).toBeNull();
        expect(screen.getByRole('alert').textContent).toContain('2 blocked decisions');
        expect(onApprove).not.toHaveBeenCalled();
    });

    it('does not offer approval or apply when the blueprint already matches', () => {
        const run = createRun({
            status: 'review_ready',
            actions: [],
            actionCount: 0,
            executionActionCount: 0,
            summary: { creates: 0, updates: 0, deletes: 0, roles: 0, categories: 0, channels: 0 },
        });

        renderHistory(run);

        expect(screen.getByText(/already matches/i)).toBeTruthy();
        expect(screen.queryByRole('button', { name: 'Continue to final check' })).toBeNull();
        expect(screen.queryByRole('button', { name: /Apply/ })).toBeNull();
    });

    it('offers only the live safety check after plan approval', () => {
        const onPreflight = vi.fn();
        const run = createRun({ status: 'approved' });

        renderHistory(run, { onPreflight });

        expect(screen.getByRole('button', { name: 'Run safety check' })).toBeTruthy();
        expect(screen.queryByRole('button', { name: /Apply/ })).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: 'Run safety check' }));
        expect(onPreflight).toHaveBeenCalledWith(run);
    });

    it('surfaces a stale action as the next blocker and selects its Roles detail', () => {
        const run = createRun({ status: 'approved' });
        renderHistory(run, { preflightByRunId: { [run.id]: createPreflight({ status: 'stale' }) } });

        expect(screen.queryByRole('button', { name: /Apply/ })).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: 'Review first blocker' }));

        expect(screen.getByRole('button', { name: 'Roles, 0' }).getAttribute('aria-pressed')).toBe('true');
        expect(
            within(screen.getByRole('complementary', { name: 'Blueprint inspector' })).getByText('update role')
        ).toBeTruthy();
    });

    it('routes inspected channel and role actions to their owned Explorer sections', () => {
        const run = createRun({
            actions: [
                {
                    id: 'channel-action',
                    sequence: 1,
                    actionType: 'update',
                    targetType: 'channel',
                    targetId: 'channel-1',
                    label: 'general',
                    details: { changes: [{ field: 'name', before: 'chat', after: 'general' }] },
                },
                {
                    id: 'role-action',
                    sequence: 2,
                    actionType: 'update',
                    targetType: 'role',
                    targetId: 'role-1',
                    label: 'Members',
                    details: { changes: [{ field: 'permissions', before: '0', after: '1' }] },
                },
            ],
            actionCount: 2,
            executionActionCount: 2,
        });
        renderHistory(run);

        const inspectButtons = screen.getAllByRole('button', { name: 'Inspect' });
        fireEvent.click(inspectButtons[0]);
        expect(screen.getByRole('button', { name: 'Channels, 0' }).getAttribute('aria-pressed')).toBe('true');
        expect(
            within(screen.getByRole('complementary', { name: 'Blueprint inspector' })).getByText('update channel')
        ).toBeTruthy();

        fireEvent.click(inspectButtons[1]);
        expect(screen.getByRole('button', { name: 'Roles, 0' }).getAttribute('aria-pressed')).toBe('true');
        expect(
            within(screen.getByRole('complementary', { name: 'Blueprint inspector' })).getByText('update role')
        ).toBeTruthy();
    });

    it('requires plan-bound destructive confirmation before exposing Apply', () => {
        const run = createRun({
            status: 'approved',
            deleteActionCount: 1,
            deleteSetDigest: 'delete-digest',
        });
        const preflight = createPreflight({ status: 'destructive-approval-required' });
        render(<ControlledHistory run={run} preflight={preflight} />);

        expect(screen.queryByRole('button', { name: /Apply/ })).toBeNull();
        const input = screen.getByLabelText('Confirm 1 irreversible delete');
        fireEvent.change(input, {
            target: { value: getDashboardStructureDeleteApprovalText(run.id, 1, run.deleteSetDigest ?? '') },
        });

        expect(screen.getByRole('button', { name: 'Apply 1 change, including 1 deletion' })).toBeTruthy();
    });

    it('requires a refreshed check when expired or older than a failed-before-mutation attempt', () => {
        const execution = {
            id: 'execution-1',
            protocolVersion: STRUCTURE_EXECUTION_PROTOCOL_VERSION,
            status: 'failed_before_mutation' as const,
            phase: 'complete' as const,
            completedActions: 0,
            failedActions: 1,
            totalActions: 1,
            createdAt: '2026-07-13T10:00:00.000Z',
            updatedAt: '2026-07-13T10:01:00.000Z',
        };
        const run = createRun({ status: 'approved', execution });
        const view = renderHistory(run, {
            preflightByRunId: {
                [run.id]: createPreflight({ checkedAt: '2026-07-13T10:00:00.000Z' }),
            },
        });

        expect(screen.getByRole('button', { name: 'Refresh safety check' })).toBeTruthy();
        expect(screen.queryByRole('button', { name: /Apply/ })).toBeNull();

        view.rerender(
            historyElement(run, {
                preflightByRunId: {
                    [run.id]: createPreflight({
                        checkedAt: '2026-07-13T10:02:00.000Z',
                        expiresAt: new Date(Date.now() + 60_000).toISOString(),
                    }),
                },
            })
        );
        expect(screen.getByRole('button', { name: 'Apply 1 change' })).toBeTruthy();

        view.rerender(
            historyElement(createRun({ status: 'approved' }), {
                preflightByRunId: {
                    'run-1': createPreflight({ expiresAt: '2025-01-01T00:00:00.000Z' }),
                },
            })
        );
        expect(screen.getByRole('button', { name: 'Refresh safety check' })).toBeTruthy();
        expect(screen.queryByRole('button', { name: /Apply/ })).toBeNull();
    });
});

function renderHistory(
    run: DashboardStructureImportRun,
    overrides: Partial<Parameters<typeof DashboardStructureImportHistory>[0]> = {}
) {
    return render(historyElement(run, overrides));
}

function historyElement(
    run: DashboardStructureImportRun,
    overrides: Partial<Parameters<typeof DashboardStructureImportHistory>[0]> = {}
) {
    return (
        <DashboardStructureImportHistory
            runs={[run]}
            latestRun={run}
            busyAction={undefined}
            preflightByRunId={{}}
            deleteConfirmationByRunId={{}}
            onDeleteConfirmationChange={vi.fn()}
            onApprove={vi.fn()}
            onPreflight={vi.fn()}
            onApply={vi.fn()}
            onControl={vi.fn()}
            onLoadActions={vi.fn()}
            onLoadDecisions={vi.fn()}
            onRecoveryPlan={vi.fn()}
            {...overrides}
        />
    );
}

function ControlledHistory({
    run,
    preflight,
}: {
    run: DashboardStructureImportRun;
    preflight: DashboardStructurePreflightView;
}) {
    const [confirmation, setConfirmation] = useState('');

    return historyElement(run, {
        preflightByRunId: { [run.id]: preflight },
        deleteConfirmationByRunId: { [run.id]: confirmation },
        onDeleteConfirmationChange: (_runId, value) => setConfirmation(value),
    });
}

function createPreflight({
    checkedAt = '2026-07-13T10:00:00.000Z',
    expiresAt = new Date(Date.now() + 60_000).toISOString(),
    status = 'ready',
}: {
    checkedAt?: string;
    expiresAt?: string;
    status?: DashboardStructurePreflightView['actions'][number]['status'];
}): DashboardStructurePreflightView {
    return {
        summary: {
            total: 1,
            ready: status === 'ready' ? 1 : 0,
            stale: status === 'stale' ? 1 : 0,
            mappingRequired: status === 'mapping-required' ? 1 : 0,
            destructiveApprovalRequired: status === 'destructive-approval-required' ? 1 : 0,
            unsupported: status === 'unsupported' ? 1 : 0,
            invalidPlan: status === 'invalid-plan' ? 1 : 0,
        },
        actions: [
            {
                actionId: 'action-1',
                actionType: 'update',
                targetType: 'role',
                targetId: 'role-target-1',
                status,
                message: status === 'ready' ? 'Ready.' : 'Needs attention.',
            },
        ],
        checkedAt,
        expiresAt,
    };
}

function createRun(overrides: Partial<DashboardStructureImportRun> = {}): DashboardStructureImportRun {
    return {
        id: 'run-1',
        status: 'queued',
        createdAt: '2026-07-11T12:00:00.000Z',
        updatedAt: '2026-07-11T12:00:00.000Z',
        summary: { creates: 0, updates: 1, deletes: 0, roles: 1, categories: 0, channels: 0 },
        actionCount: 1,
        executionActionCount: 1,
        planBlockerCount: 0,
        actions: [
            {
                id: 'action-1',
                sequence: 1,
                actionType: 'update',
                targetType: 'role',
                targetId: 'role-target-1',
                label: 'Neon Space',
                details: { fields: ['hoist'], sourceId: 'role-source-1' },
            },
        ],
        policy: 'synchronize',
        decisionSummary: createEmptyDecisionSummary(),
        decisions: [],
        planDigest: 'plan-digest',
        deleteActionCount: 0,
        ...overrides,
    };
}

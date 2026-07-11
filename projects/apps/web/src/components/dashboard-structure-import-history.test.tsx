// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { STRUCTURE_EXECUTION_PROTOCOL_VERSION } from '../dashboard-structure-execution-protocol.js';
import type { DashboardStructureImportRun } from '../server/dashboard-structure.server.js';
import { createEmptyDecisionSummary } from '../server/dashboard-structure-contracts.js';
import { DashboardStructureImportHistory } from './dashboard-structure-import-history.js';

describe('Server Blueprint action inspection', () => {
    it('opens action details inline on Deploy instead of selecting a hidden Explorer item', () => {
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
        expect(screen.getByText('role-target-1')).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: 'Close' }));
        expect(screen.queryByRole('complementary')).toBeNull();
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
});

function createRun(overrides: Partial<DashboardStructureImportRun> = {}): DashboardStructureImportRun {
    return {
        id: 'run-1',
        status: 'queued',
        createdAt: '2026-07-11T12:00:00.000Z',
        updatedAt: '2026-07-11T12:00:00.000Z',
        summary: { creates: 0, updates: 1, deletes: 0, roles: 1, categories: 0, channels: 0 },
        actionCount: 1,
        executionActionCount: 1,
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

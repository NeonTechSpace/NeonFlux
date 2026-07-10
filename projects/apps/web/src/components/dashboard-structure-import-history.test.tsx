// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { DashboardStructureImportRun } from '../server/dashboard-structure.server.js';
import { createEmptyDecisionSummary } from '../server/dashboard-structure-v2.js';
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
});

function createRun(): DashboardStructureImportRun {
    return {
        id: 'run-1',
        status: 'queued',
        createdAt: '2026-07-11T12:00:00.000Z',
        updatedAt: '2026-07-11T12:00:00.000Z',
        summary: { creates: 0, updates: 1, deletes: 0, roles: 1, categories: 0, channels: 0 },
        actionCount: 1,
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
    };
}

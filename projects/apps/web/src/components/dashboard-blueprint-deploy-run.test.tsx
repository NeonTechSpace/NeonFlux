/** @vitest-environment jsdom */
/* eslint-disable testing-library/no-manual-cleanup -- Vitest globals are disabled, so RTL cannot register automatic cleanup. */

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { BLUEPRINT_RUN_PROTOCOL_VERSION } from '../dashboard-blueprint-run-protocol.js';
import type { DashboardBlueprintPlan } from '../server/dashboard-blueprint-model.js';
import { DashboardBlueprintDeployRun } from './dashboard-blueprint-deploy-run.js';
import { formatDashboardBlueprintDeployStatus } from './dashboard-blueprint-deploy-run-status.js';

afterEach(cleanup);

describe('DashboardBlueprintDeployRun', () => {
    it('updates one stable restore-point field instead of inserting a notice', () => {
        const view = renderRun(createPlan({ status: 'queued', phase: 'queued' }));
        const pendingValue = screen.getByLabelText('Restore point status');
        expect(pendingValue.textContent).toBe('Pending');

        view.rerender(
            runElement(createPlan({ status: 'running', phase: 'preparing', restorePointBackupId: 'backup-1' }))
        );

        expect(screen.getByLabelText('Restore point status')).toBe(pendingValue);
        expect(pendingValue.textContent).toBe('Saved');
        expect(screen.queryByText('Restore point saved before apply.')).toBeNull();
        expect(screen.queryByRole('button', { name: 'Create restore plan' })).toBeNull();
    });

    it('describes a failed-before-mutation result without promoting restoration', () => {
        renderRun(
            createPlan({
                status: 'failed_before_mutation',
                phase: 'complete',
                authorizationDecision: 'structure_changed',
            })
        );

        expect(screen.getByText(/0 of 4 changes applied · Restore required: No/u)).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Refresh safety check' })).toBeTruthy();
        expect(screen.queryByRole('button', { name: 'Create restore plan' })).toBeNull();
    });

    it('formats durable run states as concise status copy', () => {
        expect(formatDashboardBlueprintDeployStatus(createPlan({ status: 'queued', phase: 'queued' }).run!)).toBe(
            'Queued'
        );
        expect(
            formatDashboardBlueprintDeployStatus(
                createPlan({ status: 'running', phase: 'update', completedSteps: 2 }).run!
            )
        ).toBe('Applying changes · 2 of 4');
        expect(
            formatDashboardBlueprintDeployStatus(
                createPlan({ status: 'partially_applied', phase: 'complete', completedSteps: 2 }).run!
            )
        ).toBe('Deployment needs attention');
    });
});

function renderRun(plan: DashboardBlueprintPlan) {
    return render(runElement(plan));
}

function runElement(plan: DashboardBlueprintPlan) {
    return (
        <DashboardBlueprintDeployRun
            busy={false}
            plan={plan}
            refreshingSafety={false}
            onCreateRestorePlan={vi.fn()}
            onRecoveryPlan={vi.fn()}
            onRefreshSafetyCheck={vi.fn()}
        />
    );
}

function createPlan(runOverrides: Partial<NonNullable<DashboardBlueprintPlan['run']>>): DashboardBlueprintPlan {
    return {
        id: 'plan-1',
        status: 'approved',
        createdAt: '2026-07-15T10:00:00.000Z',
        updatedAt: '2026-07-15T10:00:00.000Z',
        summary: { creates: 2, updates: 2, deletes: 0, roles: 1, categories: 1, channels: 2 },
        changeCount: 4,
        planStepCount: 4,
        planBlockerCount: 0,
        steps: [],
        policy: 'synchronize',
        decisionSummary: {
            'no-op': 0,
            create: 2,
            update: 2,
            delete: 0,
            'unmanaged-retained': 0,
            'protected-retained': 0,
            'protected-omitted': 0,
            'blocked-ambiguous': 0,
            'blocked-unsupported': 0,
        },
        decisions: [],
        planDigest: 'plan-digest',
        deleteStepCount: 0,
        run: {
            id: 'run-1',
            protocolVersion: BLUEPRINT_RUN_PROTOCOL_VERSION,
            status: 'queued',
            phase: 'queued',
            completedSteps: 0,
            failedSteps: 0,
            totalSteps: 4,
            createdAt: '2026-07-15T10:00:00.000Z',
            updatedAt: '2026-07-15T10:00:00.000Z',
            ...runOverrides,
        },
    };
}

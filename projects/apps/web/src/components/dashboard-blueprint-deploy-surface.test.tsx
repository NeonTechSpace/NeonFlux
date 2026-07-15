/** @vitest-environment jsdom */

import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';

import type { DashboardBlueprintPlan } from '../server/dashboard-blueprint-model.js';
import { DashboardBlueprintDeploySurface } from './dashboard-blueprint-deploy-surface.js';
import type { DashboardBlueprintDeployWorkspace } from './dashboard-blueprint-deploy-surface.js';

describe('DashboardBlueprintDeploySurface', () => {
    it('replaces the reviewed plan with a reset Choose flow when starting over', () => {
        render(<DeployFlowHarness />);
        const actionRegion = screen.getByRole('region', { name: 'Deployment action' });

        expect(screen.getByText('1 changes · 0 plan steps')).toBeTruthy();
        expect(actionRegion).toBeTruthy();
        expect(screen.getByRole('listitem', { current: 'step' }).textContent).toContain('Review');

        fireEvent.click(screen.getByRole('button', { name: 'Start over with another blueprint' }));

        expect(screen.queryByText('1 changes · 0 plan steps')).toBeNull();
        expect(screen.getByRole('listitem', { current: 'step' }).textContent).toContain('Source');
        expect(screen.queryByText('Previous plan status')).toBeNull();
        expect(screen.getByRole('region', { name: 'Deployment action' })).toBe(actionRegion);
        fireEvent.click(screen.getByRole('tab', { name: 'Paste JSON' }));
        const sourceInput = screen.getByLabelText<HTMLTextAreaElement>('Blueprint JSON');
        expect(sourceInput.value).toBe('');
        fireEvent.change(sourceInput, {
            target: { value: '{"version":1,"roles":[],"categories":[],"channels":[]}' },
        });
        expect(screen.getByRole('listitem', { current: 'step' }).textContent).toContain('Configure');
        expect(screen.getByRole('region', { name: 'Deployment action' })).toBe(actionRegion);
        expect(screen.getByRole('button', { name: 'Generate review plan' })).toBeTruthy();
        expect(screen.getByRole<HTMLInputElement>('radio', { name: 'Match blueprint (recommended)' }).checked).toBe(
            true
        );
        expect(screen.queryByText('Match duplicate blueprint items')).toBeNull();
    });

    it('explains that an unconfigured progress transport cannot be retried', () => {
        render(
            <DeployFlowHarness
                runProgressIssue={{
                    code: 'BLUEPRINT_PROGRESS_TRANSPORT_UNAVAILABLE',
                    planId: 'run-1',
                }}
            />
        );

        expect(screen.getByText(/web client has no Convex URL/u)).toBeTruthy();
        expect(screen.queryByRole('button', { name: 'Retry progress' })).toBeNull();
    });

    it('shows recoverable progress retries as pending', () => {
        render(
            <DeployFlowHarness
                runProgressIssue={{ code: 'BLUEPRINT_PROGRESS_READ_FAILED', planId: 'run-1' }}
                runProgressRetrying
            />
        );

        expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Retrying…' }).disabled).toBe(true);
    });
});

function DeployFlowHarness({
    runProgressIssue,
    runProgressRetrying = false,
}: {
    runProgressIssue?: DashboardBlueprintDeployWorkspace['runProgressIssue'];
    runProgressRetrying?: boolean;
} = {}) {
    const run = createImportRun();
    const [choosingSource, setChoosingSource] = useState(false);
    const [importJson, setImportJson] = useState('{"old":true}');
    const [policy, setPolicy] = useState<'merge' | 'synchronize' | 'rebuild'>('rebuild');
    const [hasMappings, setHasMappings] = useState(true);
    const [showStatus, setShowStatus] = useState(true);

    const workspace: DashboardBlueprintDeployWorkspace = {
        busyAction: undefined,
        confirmationByPlanId: {},
        deployChoosingSource: choosingSource,
        deployPlan: choosingSource ? undefined : run,
        runProgressIssue,
        runProgressRetrying,
        importJson,
        preflightByPlanId: {},
        restoreShortcutBackupId: undefined,
        roleMappingConflicts: hasMappings
            ? [
                  {
                      candidateTargetIds: ['target-1'],
                      name: 'Duplicate',
                      sourceIds: ['source-1'],
                      targetType: 'role',
                  },
              ]
            : [],
        roleMappings: hasMappings ? { 'source-1': 'target-1' } : {},
        sourceFile: undefined,
        structurePolicy: policy,
        targetGuildId: 'guild-1',
        targetGuildName: 'Guild One',
        onApplyRun: () => {},
        onApprovePlan: () => {},
        onControlRun: () => {},
        onCreatePlan: () => {},
        onCreateRestorePlan: () => {},
        onConfirmationChange: () => {},
        onImportJsonChange: setImportJson,
        onImportStructureFile: async () => {},
        onInspectImportJson: () => {},
        onLoadPlanSteps: () => {},
        onLoadPlanDecisions: () => {},
        onPreflightRun: () => {},
        onRecoveryPlan: () => {},
        onRetryRunProgress: () => {},
        onRoleMappingChange: () => {},
        onStartNewBlueprintDeployment: () => {
            setChoosingSource(true);
            setImportJson('');
            setPolicy('synchronize');
            setHasMappings(false);
            setShowStatus(false);
        },
        onStructurePolicyChange: setPolicy,
    };

    return (
        <>
            {showStatus ? <p>Previous plan status</p> : null}
            <DashboardBlueprintDeploySurface workspace={workspace} />
        </>
    );
}

function createImportRun(): DashboardBlueprintPlan {
    return {
        id: 'run-1',
        status: 'review_ready',
        createdByUserId: 'actor-1',
        createdAt: '2026-07-09T11:30:00.000Z',
        updatedAt: '2026-07-09T11:31:00.000Z',
        summary: { creates: 1, updates: 0, deletes: 0, roles: 0, categories: 0, channels: 1 },
        changeCount: 1,
        planStepCount: 0,
        planBlockerCount: 0,
        steps: [],
        policy: 'synchronize',
        decisionSummary: {
            'no-op': 0,
            create: 1,
            update: 0,
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
    };
}

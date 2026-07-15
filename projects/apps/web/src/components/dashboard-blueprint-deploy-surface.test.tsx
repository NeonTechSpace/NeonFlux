/** @vitest-environment jsdom */

import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';

import type { DashboardBlueprintPlan } from '../server/dashboard-blueprint-model.js';
import { isDashboardBlueprintSourceReady } from './dashboard-blueprint-deploy-stage.js';
import { DashboardBlueprintDeploySurface } from './dashboard-blueprint-deploy-surface.js';
import type { DashboardBlueprintDeployWorkspace } from './dashboard-blueprint-deploy-surface.js';
import type { DashboardBlueprintSourceState } from './dashboard-blueprint-deploy-source-state.js';

describe('DashboardBlueprintDeploySurface', () => {
    it('resets to Source and advances only after explicit continuation', async () => {
        render(<DeployFlowHarness />);
        const actionRegion = screen.getByRole('region', { name: 'Deployment action' });

        expect(screen.getByText('1 changes · 0 steps')).toBeTruthy();
        expect(actionRegion).toBeTruthy();
        expect(screen.getByRole('listitem', { current: 'step' }).textContent).toContain('Review');

        fireEvent.click(screen.getByRole('button', { name: 'Start over with another blueprint' }));

        expect(screen.queryByText('1 changes · 0 steps')).toBeNull();
        expect(screen.getByRole('listitem', { current: 'step' }).textContent).toContain('Source');
        expect(screen.queryByText('Previous plan status')).toBeNull();
        expect(screen.getByRole('region', { name: 'Deployment action' })).toBe(actionRegion);
        fireEvent.click(await screen.findByRole('tab', { name: 'Paste JSON' }));
        const sourceInput = screen.getByLabelText<HTMLTextAreaElement>('Blueprint JSON');
        expect(sourceInput.value).toBe('');
        fireEvent.change(sourceInput, {
            target: { value: '{"version":1,"roles":[],"categories":[],"channels":[]}' },
        });
        expect(screen.getByRole('listitem', { current: 'step' }).textContent).toContain('Source');
        expect(screen.getByRole('region', { name: 'Deployment action' })).toBe(actionRegion);
        fireEvent.click(screen.getByRole('button', { name: 'Continue to configuration' }));
        expect(screen.getByRole('listitem', { current: 'step' }).textContent).toContain('Configure');
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
    const [draftStep, setDraftStep] = useState<'source' | 'configure' | undefined>();
    const [sourceState, setSourceState] = useState<DashboardBlueprintSourceState>({
        status: 'empty',
        mode: 'file',
    });
    const [pasteJson, setPasteJson] = useState('');
    const [policy, setPolicy] = useState<'merge' | 'synchronize' | 'rebuild'>('rebuild');
    const [hasMappings, setHasMappings] = useState(true);
    const [showStatus, setShowStatus] = useState(true);

    const workspace: DashboardBlueprintDeployWorkspace = {
        busyAction: undefined,
        confirmationByPlanId: {},
        deployDraftStep: draftStep,
        deployPlan: draftStep ? undefined : run,
        operationStatus: undefined,
        pasteJson,
        preflightByPlanId: {},
        refreshIssue: undefined,
        refreshRetrying: false,
        runProgressIssue,
        runProgressRetrying,
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
        sourceState,
        structurePolicy: policy,
        targetGuildId: 'guild-1',
        targetGuildName: 'Guild One',
        onApplyRun: () => {},
        onApprovePlan: () => {},
        onControlRun: () => {},
        onCreatePlan: () => {},
        onCreateRestorePlan: () => {},
        onConfirmationChange: () => {},
        onChangeSource: () => setDraftStep('source'),
        onContinueSource: () => setDraftStep('configure'),
        onFilesSelected: () => {},
        onInspectImportJson: () => {},
        onLoadPlanSteps: () => {},
        onLoadPlanDecisions: () => {},
        onModeChange: (mode) => {
            setPasteJson('');
            setSourceState({ status: 'empty', mode });
        },
        onPasteJsonChange: (value) => {
            setPasteJson(value);
            setSourceState(
                isDashboardBlueprintSourceReady(value)
                    ? { status: 'ready', mode: 'paste', json: value }
                    : { status: 'invalid', mode: 'paste', message: 'Invalid Blueprint JSON.' }
            );
        },
        onPreflightRun: () => {},
        onRecoveryPlan: () => {},
        onRetryRunProgress: () => {},
        onRetryRefresh: () => {},
        onRoleMappingChange: () => {},
        onStartNewBlueprintDeployment: () => {
            setDraftStep('source');
            setPasteJson('');
            setSourceState({ status: 'empty', mode: 'file' });
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

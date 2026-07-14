/** @vitest-environment jsdom */

import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';

import type { DashboardStructureImportRun } from '../server/dashboard-structure-model.js';
import { DashboardStructureDeploySurface } from './dashboard-structure-deploy-surface.js';
import type { DashboardStructureDeployWorkspace } from './dashboard-structure-deploy-surface.js';

describe('DashboardStructureDeploySurface', () => {
    it('replaces the reviewed run with a reset Choose flow when starting over', () => {
        render(<DeployFlowHarness />);

        expect(screen.getByText('1 changes · 0 execution steps')).toBeTruthy();
        expect(screen.getByRole('listitem', { current: 'step' }).textContent).toContain('Review');

        fireEvent.click(screen.getByRole('button', { name: 'Start over with another blueprint' }));

        expect(screen.queryByText('1 changes · 0 execution steps')).toBeNull();
        expect(screen.getByRole('listitem', { current: 'step' }).textContent).toContain('Choose');
        expect(screen.queryByText('Previous plan status')).toBeNull();
        const sourceInput = screen.getByLabelText<HTMLTextAreaElement>('Blueprint JSON');
        expect(sourceInput.value).toBe('');
        fireEvent.change(sourceInput, { target: { value: '{}' } });
        expect(screen.getByRole<HTMLInputElement>('radio', { name: 'Match blueprint (recommended)' }).checked).toBe(
            true
        );
        expect(screen.queryByText('Match duplicate blueprint items')).toBeNull();
    });

    it('explains that an unconfigured progress transport cannot be retried', () => {
        render(
            <DeployFlowHarness
                executionProgressIssue={{
                    code: 'BLUEPRINT_PROGRESS_TRANSPORT_UNAVAILABLE',
                    runId: 'run-1',
                }}
            />
        );

        expect(screen.getByText(/web client has no Convex URL/u)).toBeTruthy();
        expect(screen.queryByRole('button', { name: 'Retry progress' })).toBeNull();
    });

    it('shows recoverable progress retries as pending', () => {
        render(
            <DeployFlowHarness
                executionProgressIssue={{ code: 'BLUEPRINT_PROGRESS_READ_FAILED', runId: 'run-1' }}
                executionProgressRetrying
            />
        );

        expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Retrying…' }).disabled).toBe(true);
    });
});

function DeployFlowHarness({
    executionProgressIssue,
    executionProgressRetrying = false,
}: {
    executionProgressIssue?: DashboardStructureDeployWorkspace['executionProgressIssue'];
    executionProgressRetrying?: boolean;
} = {}) {
    const run = createImportRun();
    const [choosingSource, setChoosingSource] = useState(false);
    const [importJson, setImportJson] = useState('{"old":true}');
    const [policy, setPolicy] = useState<'merge' | 'synchronize' | 'rebuild'>('rebuild');
    const [hasMappings, setHasMappings] = useState(true);
    const [showStatus, setShowStatus] = useState(true);

    const workspace: DashboardStructureDeployWorkspace = {
        busyAction: undefined,
        deleteConfirmationByRunId: {},
        deployChoosingSource: choosingSource,
        deployRun: choosingSource ? undefined : run,
        executionProgressIssue,
        executionProgressRetrying,
        importJson,
        preflightByRunId: {},
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
        structurePolicy: policy,
        onApplyRun: () => {},
        onApprovePlan: () => {},
        onControlExecution: () => {},
        onCreatePlan: () => {},
        onCreateRestoreDryRun: () => {},
        onDeleteConfirmationChange: () => {},
        onImportJsonChange: setImportJson,
        onImportStructureFile: async () => {},
        onInspectImportJson: () => {},
        onLoadRunActions: () => {},
        onLoadRunDecisions: () => {},
        onPreflightRun: () => {},
        onRecoveryPlan: () => {},
        onRetryExecutionProgress: () => {},
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
            <DashboardStructureDeploySurface workspace={workspace} />
        </>
    );
}

function createImportRun(): DashboardStructureImportRun {
    return {
        id: 'run-1',
        status: 'review_ready',
        createdByUserId: 'actor-1',
        createdAt: '2026-07-09T11:30:00.000Z',
        updatedAt: '2026-07-09T11:31:00.000Z',
        summary: { creates: 1, updates: 0, deletes: 0, roles: 0, categories: 0, channels: 1 },
        actionCount: 1,
        executionActionCount: 0,
        planBlockerCount: 0,
        actions: [],
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
        deleteActionCount: 0,
    };
}

/** @vitest-environment jsdom */

import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';

import type { DashboardStructureImportRun } from '../server/dashboard-structure.server.js';
import { DashboardStructurePanelView } from './dashboard-structure-panel-view.js';
import type { DashboardStructurePanelViewProps } from './dashboard-structure-panel-view.js';

describe('DashboardStructurePanelView deploy flow', () => {
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
    executionProgressIssue?: DashboardStructurePanelViewProps['executionProgressIssue'];
    executionProgressRetrying?: boolean;
} = {}) {
    const run = createImportRun();
    const [choosingSource, setChoosingSource] = useState(false);
    const [importJson, setImportJson] = useState('{"old":true}');
    const [policy, setPolicy] = useState<'merge' | 'synchronize' | 'rebuild'>('rebuild');
    const [hasMappings, setHasMappings] = useState(true);
    const [showStatus, setShowStatus] = useState(true);

    const workspace = {
        backupJson: '',
        backupPage: { backups: [] },
        backupSettings: {},
        busyAction: undefined,
        cadenceDraft: 1,
        deleteConfirmBackupId: undefined,
        deleteConfirmationByRunId: {},
        deployChoosingSource: choosingSource,
        deployRun: choosingSource ? undefined : run,
        driftState: undefined,
        editingBackupId: undefined,
        editingBackupName: '',
        enabledDraft: false,
        executionProgressIssue,
        executionProgressRetrying,
        executionTransport: { mode: 'idle' },
        explorer: {},
        importJson,
        importRuns: [run],
        latestRun: run,
        observedState: { changedSinceLastBackup: false, observedChangeCount: 0 },
        preflightByRunId: {},
        restoreShortcutBackupId: undefined,
        retentionDraft: 180,
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
        settingsRefreshIssue: undefined,
        status: showStatus ? { message: 'Previous plan status', tone: 'success' } : undefined,
        structurePolicy: policy,
        onImportJsonChange: setImportJson,
        onImportStructureFile: async () => {},
        onInspectImportJson: () => {},
        onStructurePolicyChange: setPolicy,
        onRoleMappingChange: () => {},
        onRetryExecutionProgress: () => {},
        onCreatePlan: () => {},
        onStartNewBlueprintDeployment: () => {
            setChoosingSource(true);
            setImportJson('');
            setPolicy('synchronize');
            setHasMappings(false);
            setShowStatus(false);
        },
    } as unknown as DashboardStructurePanelViewProps;

    return <DashboardStructurePanelView {...workspace} surface='deploy' />;
}

function createImportRun(): DashboardStructureImportRun {
    return {
        id: 'run-1',
        status: 'review_ready',
        createdByUserId: 'actor-1',
        createdAt: '2026-07-09T11:30:00.000Z',
        updatedAt: '2026-07-09T11:31:00.000Z',
        summary: {
            creates: 1,
            updates: 0,
            deletes: 0,
            roles: 0,
            categories: 0,
            channels: 1,
        },
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

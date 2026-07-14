import type { Dispatch, SetStateAction } from 'react';

import type { DashboardBlueprintPolicy } from '../server/dashboard-blueprint-contracts.js';
import type {
    DashboardBlueprintPlan,
    DashboardBlueprintRoleMappingConflict,
} from '../server/dashboard-blueprint-model.js';
import {
    canStartNewBlueprintDeployment,
    getDashboardBlueprintDeployStage,
} from './dashboard-blueprint-deploy-stage.js';
import { DashboardBlueprintRunIssue, formatDashboardBlueprintRunIssue } from './dashboard-blueprint-run-issue.js';
import { DashboardBlueprintHistory } from './dashboard-blueprint-history.js';
import type { BlueprintBusyAction } from './dashboard-blueprint-history.js';
import { RestorePointShortcutNotice } from './dashboard-blueprint-panel-shared.js';
import type { DashboardBlueprintPreflightView } from './dashboard-blueprint-panel-types.js';
import { dashboardBlueprintSurfaceIdentity as surfaceIdentity } from './dashboard-blueprint-surface.js';
import {
    dashboardCompactFieldClassName,
    dashboardFieldClassName,
    dashboardPrimaryActionClassName,
    dashboardSecondaryActionClassName,
} from './dashboard-ui.js';

const dashboardBlueprintDeploymentPolicies = [
    {
        value: 'merge',
        label: 'Merge without deletions',
        description:
            'Create missing items and update matching names, permissions, parents, and order without deleting target-only items.',
    },
    {
        value: 'synchronize',
        label: 'Match blueprint (recommended)',
        description: 'Match eligible roles and channels, including deleting eligible target-only objects.',
    },
    {
        value: 'rebuild',
        label: 'Reset and rebuild',
        description: 'Delete all eligible roles and channels, retain protected objects, then recreate the blueprint.',
    },
] as const satisfies ReadonlyArray<{
    value: DashboardBlueprintPolicy;
    label: string;
    description: string;
}>;

export type DashboardBlueprintDeployWorkspace = {
    busyAction: BlueprintBusyAction | undefined;
    deleteConfirmationByPlanId: Record<string, string>;
    deployChoosingSource: boolean;
    deployPlan: DashboardBlueprintPlan | undefined;
    runProgressIssue: { code: string; planId: string } | undefined;
    runProgressRetrying: boolean;
    importJson: string;
    preflightByPlanId: Record<string, DashboardBlueprintPreflightView>;
    restoreShortcutBackupId: string | undefined;
    roleMappingConflicts: DashboardBlueprintRoleMappingConflict[];
    roleMappings: Record<string, string>;
    structurePolicy: DashboardBlueprintPolicy;
    onApplyRun: (plan: DashboardBlueprintPlan) => void;
    onApprovePlan: (plan: DashboardBlueprintPlan) => void;
    onControlRun: (plan: DashboardBlueprintPlan, request: 'pause' | 'resume' | 'cancel') => void;
    onCreatePlan: () => void;
    onCreateRestorePlan: (backupId: string) => void;
    onDeleteConfirmationChange: (planId: string, confirmation: string) => void;
    onImportJsonChange: Dispatch<SetStateAction<string>>;
    onImportStructureFile: (file: File | undefined) => Promise<void>;
    onInspectImportJson: () => void;
    onLoadPlanSteps: (plan: DashboardBlueprintPlan) => void;
    onLoadPlanDecisions: (plan: DashboardBlueprintPlan) => void;
    onPreflightRun: (plan: DashboardBlueprintPlan) => void;
    onRecoveryPlan: (plan: DashboardBlueprintPlan) => void;
    onRetryRunProgress: () => void;
    onRoleMappingChange: (sourceId: string, targetId: string) => void;
    onStartNewBlueprintDeployment: () => void;
    onStructurePolicyChange: (policy: DashboardBlueprintPolicy) => void;
};

export function DashboardBlueprintDeploySurface({ workspace }: { workspace: DashboardBlueprintDeployWorkspace }) {
    const stage = workspace.deployChoosingSource ? 1 : getDashboardBlueprintDeployStage(workspace.deployPlan);

    return (
        <section aria-labelledby='blueprint-deploy-heading'>
            <div className='border-b border-[var(--dash-border)] pb-4'>
                <h2 id='blueprint-deploy-heading' className='text-lg font-semibold text-[var(--dash-text)]'>
                    {surfaceIdentity.deploy.heading}
                </h2>
                <p className='mt-1 text-sm text-[var(--dash-text-muted)]'>{surfaceIdentity.deploy.description}</p>
            </div>
            <ol className='grid grid-cols-3 border-b border-[var(--dash-border)]' aria-label='Deployment stages'>
                {['Choose', 'Review', 'Apply'].map((label, index) => (
                    <li
                        key={label}
                        aria-current={stage === index + 1 ? 'step' : undefined}
                        className={`border-b-2 px-1 py-4 text-sm ${
                            stage === index + 1
                                ? 'border-[var(--dash-primary)] text-[var(--dash-text)]'
                                : index + 1 < stage
                                  ? 'border-transparent text-[var(--dash-text-muted)]'
                                  : 'border-transparent text-[var(--dash-text-subtle)]'
                        }`}>
                        <span className='mr-2 font-mono text-xs'>{index + 1}</span>
                        {label}
                    </li>
                ))}
            </ol>

            {stage === 1 ? <DeploySource workspace={workspace} /> : null}
            {stage > 1 && workspace.deployPlan ? (
                <div className='pt-6'>
                    <DashboardBlueprintHistory
                        plans={[workspace.deployPlan]}
                        latestPlan={workspace.deployPlan}
                        busyAction={workspace.busyAction}
                        preflightByPlanId={workspace.preflightByPlanId}
                        deleteConfirmationByPlanId={workspace.deleteConfirmationByPlanId}
                        onDeleteConfirmationChange={workspace.onDeleteConfirmationChange}
                        onApprove={workspace.onApprovePlan}
                        onPreflight={workspace.onPreflightRun}
                        onApply={workspace.onApplyRun}
                        onControl={workspace.onControlRun}
                        onLoadPlanSteps={workspace.onLoadPlanSteps}
                        onLoadDecisions={workspace.onLoadPlanDecisions}
                        onRecoveryPlan={workspace.onRecoveryPlan}
                    />
                </div>
            ) : null}
            {stage > 1 && canStartNewBlueprintDeployment(workspace.deployPlan) ? (
                <div className='mt-6 border-y border-[var(--dash-border)]'>
                    <button
                        type='button'
                        onClick={workspace.onStartNewBlueprintDeployment}
                        className='w-full py-4 text-left text-sm font-semibold text-[var(--dash-primary)]'>
                        Start over with another blueprint
                    </button>
                </div>
            ) : null}
            {workspace.runProgressIssue ? (
                <DashboardBlueprintRunIssue
                    code={workspace.runProgressIssue.code}
                    message={formatDashboardBlueprintRunIssue(workspace.runProgressIssue.code)}
                    retrying={workspace.runProgressRetrying}
                    retryLabel='Retry progress'
                    onRetry={workspace.onRetryRunProgress}
                />
            ) : null}
            {workspace.restoreShortcutBackupId ? (
                <div className='pt-5'>
                    <RestorePointShortcutNotice
                        backupId={workspace.restoreShortcutBackupId}
                        busy={workspace.busyAction === `backup-import:${workspace.restoreShortcutBackupId}`}
                        disabled={Boolean(workspace.busyAction)}
                        onCreateRestorePlan={workspace.onCreateRestorePlan}
                    />
                </div>
            ) : null}
        </section>
    );
}

function DeploySource({ workspace }: { workspace: DashboardBlueprintDeployWorkspace }) {
    const mappingRows = workspace.roleMappingConflicts.flatMap((conflict) =>
        conflict.sourceIds.map((sourceId) => ({ conflict, sourceId }))
    );
    const mappingsComplete =
        mappingRows.length === 0 || mappingRows.every(({ sourceId }) => Boolean(workspace.roleMappings[sourceId]));

    return (
        <div className='pt-6'>
            <label htmlFor='server-blueprint-import-file' className='text-sm font-semibold text-[var(--dash-text)]'>
                Import JSON file
            </label>
            <p className='mt-1 text-xs leading-5 text-[var(--dash-text-muted)]'>
                JSON is validated before a deployment plan is created. Nothing changes on Fluxer at this stage.
            </p>
            <input
                id='server-blueprint-import-file'
                type='file'
                accept='application/json,.json'
                onClick={(event) => {
                    event.currentTarget.value = '';
                }}
                onChange={(event) => {
                    void workspace.onImportStructureFile(event.currentTarget.files?.[0]);
                }}
                className='mt-3 block w-full max-w-2xl cursor-pointer bg-transparent px-0 py-3 text-sm text-[var(--dash-text-muted)] file:mr-4 file:cursor-pointer file:rounded-[var(--dash-radius-control)] file:border-0 file:bg-[var(--dash-surface-raised)] file:px-3 file:py-2 file:text-sm file:font-semibold file:text-[var(--dash-text)] hover:file:bg-[var(--dash-surface-selected)]'
            />
            <details className='mt-4 max-w-2xl border-y border-[var(--dash-border)]'>
                <summary
                    data-dashboard-disclosure
                    className='cursor-pointer list-none py-3 text-sm font-medium text-[var(--dash-text)] marker:hidden'>
                    Or paste blueprint JSON
                </summary>
                <div className='pb-4'>
                    <label htmlFor='server-blueprint-import-json' className='sr-only'>
                        Blueprint JSON
                    </label>
                    <textarea
                        id='server-blueprint-import-json'
                        value={workspace.importJson}
                        onChange={(event) => workspace.onImportJsonChange(event.currentTarget.value)}
                        rows={12}
                        spellCheck={false}
                        className={`${dashboardFieldClassName} resize-y py-2 font-mono text-xs`}
                        placeholder='Paste normalized Server Blueprint JSON.'
                    />
                    <button
                        type='button'
                        onClick={workspace.onInspectImportJson}
                        disabled={!workspace.importJson.trim() || Boolean(workspace.busyAction)}
                        className={`mt-3 ${dashboardSecondaryActionClassName}`}>
                        Inspect source
                    </button>
                </div>
            </details>
            {workspace.importJson.trim() ? (
                <fieldset className='mt-5 max-w-2xl' aria-label='Deployment policy'>
                    <legend className='text-sm font-semibold text-[var(--dash-text)]'>Deployment policy</legend>
                    <div className='mt-3 grid gap-2'>
                        {dashboardBlueprintDeploymentPolicies.map((option) => (
                            <label
                                key={option.value}
                                htmlFor={`structure-policy-${option.value}`}
                                aria-label={option.label}
                                className={`flex cursor-pointer items-start gap-3 rounded-[var(--dash-radius-control)] border p-4 transition-[border-color,background-color,box-shadow] focus-within:shadow-[var(--dash-shadow-focus)] ${
                                    workspace.structurePolicy === option.value
                                        ? 'border-[var(--dash-primary)] bg-[var(--dash-primary-ring)]'
                                        : 'border-[var(--dash-border)] bg-[var(--dash-surface-raised)]'
                                }`}>
                                <input
                                    id={`structure-policy-${option.value}`}
                                    type='radio'
                                    name='structure-policy'
                                    value={option.value}
                                    checked={workspace.structurePolicy === option.value}
                                    onChange={() => workspace.onStructurePolicyChange(option.value)}
                                    className='mt-1 size-4 border-[var(--dash-border-strong)] bg-[var(--dash-bg)] text-[var(--dash-primary)]'
                                />
                                <span>
                                    <strong className='block text-sm text-[var(--dash-text)]'>{option.label}</strong>
                                    <span className='mt-1 block text-xs leading-5 text-[var(--dash-text-muted)]'>
                                        {option.description}
                                    </span>
                                </span>
                            </label>
                        ))}
                    </div>
                </fieldset>
            ) : null}
            {mappingRows.length > 0 ? (
                <div
                    className='mt-5 max-w-2xl rounded-[var(--dash-radius-control)] border border-[color:var(--dash-warning)]/35 bg-[var(--dash-warning-soft)] p-4'
                    role='alert'>
                    <h4 className='text-sm font-semibold text-[var(--dash-warning)]'>
                        Match duplicate blueprint items
                    </h4>
                    <p className='mt-1 text-xs leading-5 text-[var(--dash-text-muted)]'>
                        These roles are still genuinely ambiguous after projecting the final hierarchy. Select each
                        existing target role once. No server changes occur until the reviewed plan is applied.
                    </p>
                    <div className='mt-4 space-y-4'>
                        {mappingRows.map(({ conflict, sourceId }) => (
                            <label key={sourceId} className='block text-xs text-[var(--dash-text-muted)]'>
                                <span className='mb-1 block font-semibold text-[var(--dash-text)]'>
                                    Source {conflict.targetType} {conflict.name} ({sourceId})
                                </span>
                                <select
                                    aria-label={`Target ${conflict.targetType} for ${conflict.name} ${sourceId}`}
                                    value={workspace.roleMappings[sourceId] ?? ''}
                                    onChange={(event) =>
                                        workspace.onRoleMappingChange(sourceId, event.currentTarget.value)
                                    }
                                    className={dashboardCompactFieldClassName}>
                                    <option value=''>Choose an existing target {conflict.targetType}</option>
                                    {conflict.candidateTargetIds.map((targetId) => {
                                        const selectedByAnotherSource = Object.entries(workspace.roleMappings).some(
                                            ([selectedSourceId, selectedTargetId]) =>
                                                selectedSourceId !== sourceId && selectedTargetId === targetId
                                        );
                                        return (
                                            <option key={targetId} value={targetId} disabled={selectedByAnotherSource}>
                                                {conflict.name} ({targetId})
                                            </option>
                                        );
                                    })}
                                </select>
                            </label>
                        ))}
                    </div>
                </div>
            ) : null}
            <div className='mt-6 flex items-center justify-between gap-4 border-t border-[var(--dash-border)] pt-4'>
                <p className='text-xs text-[var(--dash-text-muted)]'>
                    Nothing changes until the reviewed result is applied.
                </p>
                <button
                    type='button'
                    onClick={workspace.onCreatePlan}
                    disabled={Boolean(workspace.busyAction) || !workspace.importJson.trim() || !mappingsComplete}
                    className={dashboardPrimaryActionClassName}>
                    {workspace.busyAction === 'plan'
                        ? 'Preparing preview'
                        : mappingRows.length > 0
                          ? 'Preview changes with mappings'
                          : 'Preview exact changes'}
                </button>
            </div>
            <p className='mt-4 max-w-3xl text-xs leading-5 text-[var(--dash-text-subtle)]'>
                Applies supported role updates and channel/category name, position, parent, and permission-overwrite
                changes. Topic, NSFW, slowmode, type changes, and moving @everyone are blocked and remain visible during
                review.
            </p>
        </div>
    );
}

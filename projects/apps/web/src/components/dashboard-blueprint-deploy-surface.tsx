import { useEffect, useRef, useState } from 'react';
import type { Dispatch, ReactNode, SetStateAction } from 'react';

import type { DashboardBlueprintPolicy } from '../server/dashboard-blueprint-contracts.js';
import type {
    DashboardBlueprintPlan,
    DashboardBlueprintRoleMappingConflict,
} from '../server/dashboard-blueprint-model.js';
import {
    canStartNewBlueprintDeployment,
    deriveDashboardBlueprintDeployJourney,
    isDashboardBlueprintSourceReady,
    readDashboardBlueprintSourceSnapshot,
} from './dashboard-blueprint-deploy-stage.js';
import { emptyDashboardBlueprintConfirmation } from './dashboard-blueprint-deploy-readiness.js';
import type { DashboardBlueprintConfirmationDraft } from './dashboard-blueprint-deploy-readiness.js';
import { DashboardBlueprintDeployActionBar } from './dashboard-blueprint-deploy-action-bar.js';
import { DashboardBlueprintRunIssue, formatDashboardBlueprintRunIssue } from './dashboard-blueprint-run-issue.js';
import { DashboardBlueprintActiveDeployment } from './dashboard-blueprint-history.js';
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
    confirmationByPlanId: Record<string, DashboardBlueprintConfirmationDraft>;
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
    sourceFile: { name: string; size: number } | undefined;
    targetGuildId: string;
    targetGuildName: string;
    onApplyRun: (plan: DashboardBlueprintPlan) => void;
    onApprovePlan: (plan: DashboardBlueprintPlan) => void;
    onControlRun: (plan: DashboardBlueprintPlan, request: 'pause' | 'resume' | 'cancel') => void;
    onCreatePlan: () => void;
    onCreateRestorePlan: (backupId: string) => void;
    onConfirmationChange: (planId: string, confirmation: DashboardBlueprintConfirmationDraft) => void;
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
    const stepHeadingRef = useRef<HTMLHeadingElement>(null);
    const cachedPreflight = workspace.deployPlan ? workspace.preflightByPlanId[workspace.deployPlan.id] : undefined;
    const activePreflightReport =
        cachedPreflight ??
        (workspace.deployPlan?.preflight
            ? {
                  ...workspace.deployPlan.preflight.report,
                  checkedAt: workspace.deployPlan.preflight.checkedAt,
                  expiresAt: workspace.deployPlan.preflight.expiresAt,
              }
            : undefined);
    const journeyNow = useExpiryClock(activePreflightReport?.expiresAt);
    const journey = deriveDashboardBlueprintDeployJourney({
        choosingSource: workspace.deployChoosingSource,
        hasParsedSource: isDashboardBlueprintSourceReady(workspace.importJson),
        plan: workspace.deployPlan,
        now: journeyNow,
        preflight:
            workspace.deployPlan?.preflight ??
            (cachedPreflight
                ? {
                      checkedAt: cachedPreflight.checkedAt,
                      expiresAt: cachedPreflight.expiresAt,
                      status: cachedPreflight.summary.ready === cachedPreflight.summary.total ? 'ready' : 'blocked',
                  }
                : undefined),
    });
    const stage = journey.index;
    useEffect(() => {
        stepHeadingRef.current?.focus({ preventScroll: true });
    }, [journey.step]);

    return (
        <section aria-labelledby='blueprint-deploy-heading'>
            <div className='border-b border-[var(--dash-border)] pb-4'>
                <h2 id='blueprint-deploy-heading' className='text-lg font-semibold text-[var(--dash-text)]'>
                    {surfaceIdentity.deploy.heading}
                </h2>
                <p className='mt-1 text-sm text-[var(--dash-text-muted)]'>{surfaceIdentity.deploy.description}</p>
            </div>
            <p className='border-b border-[var(--dash-border)] py-3 text-sm font-semibold text-[var(--dash-text)] md:hidden'>
                Step {stage} of 6 · {journey.step.charAt(0).toUpperCase()}
                {journey.step.slice(1)}
            </p>
            <ol
                className='hidden grid-cols-6 border-b border-[var(--dash-border)] md:grid'
                aria-label='Deployment stages'>
                {['Source', 'Configure', 'Review', 'Safety', 'Confirm', 'Deploy'].map((label, index) => (
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
            <h3 ref={stepHeadingRef} tabIndex={-1} className='sr-only'>
                {journey.step} step
            </h3>
            <div className='sr-only' aria-live='polite' aria-atomic='true'>
                Blueprint deployment is at step {stage} of 6: {journey.step}.
            </div>

            <DeployActionRegion
                activePreflightReport={activePreflightReport}
                journeyStep={journey.step}
                workspace={workspace}
            />

            {journey.step === 'source' || journey.step === 'configure' ? (
                <DeploySource workspace={workspace} step={journey.step} />
            ) : null}
            {stage > 2 && workspace.deployPlan ? (
                <div className='pt-6'>
                    <DashboardBlueprintActiveDeployment
                        plan={workspace.deployPlan}
                        busyAction={workspace.busyAction}
                        preflightReport={activePreflightReport}
                        confirmation={workspace.confirmationByPlanId[workspace.deployPlan.id]}
                        targetGuildName={workspace.targetGuildName}
                        onPreflight={workspace.onPreflightRun}
                        onControl={workspace.onControlRun}
                        onLoadPlanSteps={workspace.onLoadPlanSteps}
                        onLoadDecisions={workspace.onLoadPlanDecisions}
                        onRecoveryPlan={workspace.onRecoveryPlan}
                        journeyStep={journey.step}
                    />
                </div>
            ) : null}
            {stage > 2 && canStartNewBlueprintDeployment(workspace.deployPlan) ? (
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

function DeployActionRegion({
    activePreflightReport,
    journeyStep,
    workspace,
}: {
    activePreflightReport: DashboardBlueprintPreflightView | undefined;
    journeyStep: ReturnType<typeof deriveDashboardBlueprintDeployJourney>['step'];
    workspace: DashboardBlueprintDeployWorkspace;
}) {
    const plan = workspace.deployPlan;
    const mappingsComplete = areRoleMappingsComplete(workspace);
    let content: ReactNode;

    if (journeyStep === 'source') {
        content = (
            <div className='flex items-center justify-between gap-4'>
                <p className='text-xs text-[var(--dash-text-muted)]'>Choose or paste a valid Blueprint to continue.</p>
                <button type='button' disabled className={dashboardPrimaryActionClassName}>
                    Continue to configuration
                </button>
            </div>
        );
    } else if (journeyStep === 'configure') {
        content = (
            <div className='flex items-center justify-between gap-4'>
                <p className='text-xs text-[var(--dash-text-muted)]'>
                    Nothing changes until the generated plan is reviewed and authorized.
                </p>
                <button
                    type='button'
                    onClick={workspace.onCreatePlan}
                    disabled={Boolean(workspace.busyAction) || !workspace.importJson.trim() || !mappingsComplete}
                    className={dashboardPrimaryActionClassName}>
                    {workspace.busyAction === 'plan'
                        ? 'Generating review plan'
                        : workspace.roleMappingConflicts.length > 0
                          ? 'Generate review plan with mappings'
                          : 'Generate review plan'}
                </button>
            </div>
        );
    } else if (plan && journeyStep !== 'deploy') {
        content = (
            <DashboardBlueprintDeployActionBar
                busyAction={workspace.busyAction}
                confirmation={workspace.confirmationByPlanId[plan.id] ?? emptyDashboardBlueprintConfirmation}
                targetGuildName={workspace.targetGuildName}
                plan={plan}
                preflightReport={activePreflightReport}
                onConfirmationChange={(value) => workspace.onConfirmationChange(plan.id, value)}
                onApprove={() => workspace.onApprovePlan(plan)}
                onPreflight={() => workspace.onPreflightRun(plan)}
                onApply={() => workspace.onApplyRun(plan)}
                onReviewBlocker={() => workspace.onLoadPlanDecisions(plan)}
            />
        );
    } else {
        content = (
            <p className='text-xs text-[var(--dash-text-muted)]'>
                Deployment progress and available run controls are shown below.
            </p>
        );
    }

    return (
        <div
            data-blueprint-deploy-action-region
            role='region'
            aria-label='Deployment action'
            className='min-h-16 border-b border-[var(--dash-border)] bg-[var(--dash-bg)] py-3'>
            {content}
        </div>
    );
}

function useExpiryClock(expiresAt: string | undefined): number {
    const [now, setNow] = useState(() => Date.now());

    useEffect(() => {
        if (!expiresAt) return;
        const expiryTime = new Date(expiresAt).getTime();
        if (!Number.isFinite(expiryTime)) return;
        const delay = Math.max(0, expiryTime - Date.now());
        const timeout = window.setTimeout(() => setNow(Date.now()), delay);
        return () => window.clearTimeout(timeout);
    }, [expiresAt]);

    return now;
}

function DeploySource({
    workspace,
    step,
}: {
    workspace: DashboardBlueprintDeployWorkspace;
    step: 'source' | 'configure';
}) {
    const [sourceMode, setSourceMode] = useState<'upload' | 'paste'>('upload');
    const mappingRows = workspace.roleMappingConflicts.flatMap((conflict) =>
        conflict.sourceIds.map((sourceId) => ({ conflict, sourceId }))
    );
    const sourceSummary = readBlueprintSourceSummary(workspace.importJson);

    if (step === 'source') {
        return (
            <div className='pt-6'>
                <div className='flex gap-2' role='tablist' aria-label='Blueprint source method'>
                    {(['upload', 'paste'] as const).map((mode) => (
                        <button
                            key={mode}
                            type='button'
                            role='tab'
                            aria-selected={sourceMode === mode}
                            onClick={() => setSourceMode(mode)}
                            className={
                                sourceMode === mode
                                    ? dashboardPrimaryActionClassName
                                    : dashboardSecondaryActionClassName
                            }>
                            {mode === 'upload' ? 'Upload JSON' : 'Paste JSON'}
                        </button>
                    ))}
                </div>
                {sourceMode === 'upload' ? (
                    <div
                        className='mt-5 max-w-2xl rounded-[var(--dash-radius-control)] border border-dashed border-[var(--dash-border-strong)] bg-[var(--dash-surface-raised)] p-5'
                        onDragOver={(event) => event.preventDefault()}
                        onDrop={(event) => {
                            event.preventDefault();
                            void workspace.onImportStructureFile(event.dataTransfer.files[0]);
                        }}>
                        <label
                            htmlFor='server-blueprint-import-file'
                            className='text-sm font-semibold text-[var(--dash-text)]'>
                            Drop a Blueprint JSON file here or choose one
                        </label>
                        <p className='mt-1 text-xs leading-5 text-[var(--dash-text-muted)]'>
                            JSON is validated before configuration. Nothing changes on Fluxer at this stage.
                        </p>
                        <input
                            id='server-blueprint-import-file'
                            type='file'
                            accept='application/json,.json'
                            onClick={(event) => {
                                event.currentTarget.value = '';
                            }}
                            onChange={(event) => void workspace.onImportStructureFile(event.currentTarget.files?.[0])}
                            className='mt-3 block w-full cursor-pointer bg-transparent py-3 text-sm text-[var(--dash-text-muted)]'
                        />
                    </div>
                ) : (
                    <div className='mt-5 max-w-2xl'>
                        <label
                            htmlFor='server-blueprint-import-json'
                            className='text-sm font-semibold text-[var(--dash-text)]'>
                            Blueprint JSON
                        </label>
                        <textarea
                            id='server-blueprint-import-json'
                            value={workspace.importJson}
                            onChange={(event) => workspace.onImportJsonChange(event.currentTarget.value)}
                            rows={12}
                            spellCheck={false}
                            className={`${dashboardFieldClassName} mt-2 resize-y py-2 font-mono text-xs`}
                            placeholder='Paste normalized Server Blueprint JSON.'
                        />
                        {workspace.importJson.trim() && !sourceSummary ? (
                            <p className='mt-2 text-xs text-[var(--dash-danger)]' role='alert'>
                                This is not a valid Blueprint structure. Roles, categories, and channels are required.
                            </p>
                        ) : null}
                    </div>
                )}
            </div>
        );
    }

    return (
        <div className='pt-6'>
            {sourceSummary ? (
                <div className='max-w-3xl rounded-[var(--dash-radius-control)] border border-[var(--dash-border)] bg-[var(--dash-surface-raised)] p-4'>
                    <p className='text-sm font-semibold text-[var(--dash-text)]'>Validated source</p>
                    <p className='mt-1 text-xs text-[var(--dash-text-muted)]'>
                        {sourceSummary.guildName ?? sourceSummary.guildId ?? 'Portable blueprint'} ·{' '}
                        {sourceSummary.roles} roles · {sourceSummary.categories} categories · {sourceSummary.channels}{' '}
                        channels
                    </p>
                    <dl className='mt-3 grid gap-2 text-xs text-[var(--dash-text-muted)] sm:grid-cols-2'>
                        <div>
                            <dt className='text-[var(--dash-text-subtle)]'>Source</dt>
                            <dd>
                                {workspace.sourceFile
                                    ? `${workspace.sourceFile.name} · ${formatFileSize(workspace.sourceFile.size)}`
                                    : 'Pasted or restored JSON'}
                            </dd>
                        </div>
                        <div>
                            <dt className='text-[var(--dash-text-subtle)]'>Blueprint</dt>
                            <dd>
                                Version {sourceSummary.version}
                                {sourceSummary.exportedAt ? ` · Exported ${formatDate(sourceSummary.exportedAt)}` : ''}
                            </dd>
                        </div>
                        <div>
                            <dt className='text-[var(--dash-text-subtle)]'>Target</dt>
                            <dd>
                                {workspace.targetGuildName} ({workspace.targetGuildId})
                            </dd>
                        </div>
                        <div>
                            <dt className='text-[var(--dash-text-subtle)]'>Deployment scope</dt>
                            <dd>
                                {sourceSummary.guildId && sourceSummary.guildId !== workspace.targetGuildId
                                    ? 'Cross-server deployment'
                                    : 'Same-server deployment'}
                            </dd>
                        </div>
                    </dl>
                    <button
                        type='button'
                        onClick={workspace.onInspectImportJson}
                        className={`mt-3 ${dashboardSecondaryActionClassName}`}>
                        Inspect source
                    </button>
                </div>
            ) : null}
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
            <p className='mt-4 max-w-3xl text-xs leading-5 text-[var(--dash-text-subtle)]'>
                Applies supported role updates and channel/category name, position, parent, and permission-overwrite
                changes. Topic, NSFW, slowmode, type changes, and moving @everyone are blocked and remain visible during
                review.
            </p>
        </div>
    );
}

function areRoleMappingsComplete(workspace: DashboardBlueprintDeployWorkspace): boolean {
    return workspace.roleMappingConflicts.every((conflict) =>
        conflict.sourceIds.every((sourceId) => Boolean(workspace.roleMappings[sourceId]))
    );
}

function readBlueprintSourceSummary(value: string) {
    const source = readDashboardBlueprintSourceSnapshot(value);
    if (!source) return undefined;
    return {
        version: source.version,
        guildId: source.guildId,
        guildName: source.guildName,
        exportedAt: source.exportedAt,
        roles: source.roles.length,
        categories: source.categories.length,
        channels: source.channels.length,
    };
}

function formatFileSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KiB`;
}

function formatDate(value: string): string {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';

import type { DashboardBlueprintPolicy } from '../server/dashboard-blueprint-contracts.js';
import type {
    DashboardBlueprintPlan,
    DashboardBlueprintRoleMappingConflict,
} from '../server/dashboard-blueprint-model.js';
import { DashboardBlueprintDeployActionBar } from './dashboard-blueprint-deploy-action-bar.js';
import { emptyDashboardBlueprintConfirmation } from './dashboard-blueprint-deploy-readiness.js';
import type { DashboardBlueprintConfirmationDraft } from './dashboard-blueprint-deploy-readiness.js';
import {
    canStartNewBlueprintDeployment,
    deriveDashboardBlueprintDeployJourney,
    isDashboardBlueprintSourceReady,
} from './dashboard-blueprint-deploy-stage.js';
import { formatDashboardBlueprintDeployStatus } from './dashboard-blueprint-deploy-run-status.js';
import type { DashboardBlueprintSourceState } from './dashboard-blueprint-deploy-source-state.js';
import type {
    BlueprintBusyAction,
    DashboardBlueprintPreflightView,
    PanelStatus,
} from './dashboard-blueprint-panel-types.js';
import { DashboardBlueprintRunIssue, formatDashboardBlueprintRunIssue } from './dashboard-blueprint-run-issue.js';
import { StatusMessage } from './dashboard-blueprint-panel-shared.js';
import { dashboardBlueprintSurfaceIdentity as surfaceIdentity } from './dashboard-blueprint-surface.js';
import { dashboardPrimaryActionClassName, dashboardSecondaryActionClassName, DashboardStatus } from './dashboard-ui.js';

const DashboardBlueprintDeployReview = lazy(() =>
    import('./dashboard-blueprint-deploy-review.js').then((module) => ({
        default: module.DashboardBlueprintDeployReview,
    }))
);

const DashboardBlueprintDeployRun = lazy(() =>
    import('./dashboard-blueprint-deploy-run.js').then((module) => ({
        default: module.DashboardBlueprintDeployRun,
    }))
);

const DashboardBlueprintDeploySource = lazy(() =>
    import('./dashboard-blueprint-deploy-source.js').then((module) => ({
        default: module.DashboardBlueprintDeploySource,
    }))
);

export type DashboardBlueprintDeployWorkspace = {
    busyAction: BlueprintBusyAction | undefined;
    confirmationByPlanId: Record<string, DashboardBlueprintConfirmationDraft>;
    deployDraftStep: 'source' | 'configure' | undefined;
    deployPlan: DashboardBlueprintPlan | undefined;
    operationStatus: PanelStatus | undefined;
    pasteJson: string;
    preflightByPlanId: Record<string, DashboardBlueprintPreflightView>;
    reviewAuthority: {
        planId?: string;
        status: 'idle' | 'loading' | 'ready' | 'error';
        retrying: boolean;
    };
    refreshIssue: { code: string } | undefined;
    refreshRetrying: boolean;
    roleMappingConflicts: DashboardBlueprintRoleMappingConflict[];
    roleMappings: Record<string, string>;
    runProgressIssue: { code: string; planId: string } | undefined;
    runProgressRetrying: boolean;
    sourceState: DashboardBlueprintSourceState;
    structurePolicy: DashboardBlueprintPolicy;
    targetGuildId: string;
    targetGuildName: string;
    onApplyRun: (plan: DashboardBlueprintPlan) => void;
    onApprovePlan: (plan: DashboardBlueprintPlan) => void;
    onChangeSource: () => void;
    onContinueSource: () => void;
    onControlRun: (plan: DashboardBlueprintPlan, request: 'pause' | 'resume' | 'cancel') => void;
    onCreatePlan: () => void;
    onCreateRestorePlan: (backupId: string) => void;
    onConfirmationChange: (planId: string, confirmation: DashboardBlueprintConfirmationDraft) => void;
    onFilesSelected: (files: readonly File[]) => void;
    onInspectImportJson: () => void;
    onLoadPlanSteps: (plan: DashboardBlueprintPlan) => void;
    onLoadPlanDecisions: (plan: DashboardBlueprintPlan) => void;
    onModeChange: (mode: 'file' | 'paste') => void;
    onPasteJsonChange: (value: string) => void;
    onPreflightRun: (plan: DashboardBlueprintPlan) => void;
    onRecoveryPlan: (plan: DashboardBlueprintPlan) => void;
    onRetryRefresh: () => void;
    onRetryRunProgress: () => void;
    onRoleMappingChange: (sourceId: string, targetId: string) => void;
    onStartNewBlueprintDeployment: () => void;
    onStructurePolicyChange: (policy: DashboardBlueprintPolicy) => void;
};

export function DashboardBlueprintDeploySurface({ workspace }: { workspace: DashboardBlueprintDeployWorkspace }) {
    const stepHeadingRef = useRef<HTMLHeadingElement>(null);
    const cachedPreflight = workspace.deployPlan ? workspace.preflightByPlanId[workspace.deployPlan.id] : undefined;
    const activePreflightReport = cachedPreflight;
    const journeyNow = useExpiryClock(activePreflightReport?.expiresAt);
    const journey = deriveDashboardBlueprintDeployJourney({
        draftStep: workspace.deployDraftStep,
        hasParsedSource:
            workspace.sourceState.status === 'ready' && isDashboardBlueprintSourceReady(workspace.sourceState.json),
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
                Step {journey.index} of 6 · {capitalize(journey.step)}
            </p>
            <ol
                className='hidden grid-cols-6 border-b border-[var(--dash-border)] md:grid'
                aria-label='Deployment stages'>
                {['Source', 'Configure', 'Review', 'Safety', 'Confirm', 'Deploy'].map((label, index) => (
                    <li
                        key={label}
                        aria-current={journey.index === index + 1 ? 'step' : undefined}
                        className={`border-b-2 px-1 py-4 text-sm ${
                            journey.index === index + 1
                                ? 'border-[var(--dash-primary)] text-[var(--dash-text)]'
                                : index + 1 < journey.index
                                  ? 'border-transparent text-[var(--dash-text-muted)]'
                                  : 'border-transparent text-[var(--dash-text-subtle)]'
                        }`}>
                        <span className='mr-2 font-mono text-xs'>{index + 1}</span>
                        {label}
                    </li>
                ))}
            </ol>

            <h3 ref={stepHeadingRef} tabIndex={-1} className='sr-only'>
                {capitalize(journey.step)} step
            </h3>

            <DeployStatusRegion journeyStep={journey.step} workspace={workspace} />

            {journey.step === 'source' || journey.step === 'configure' ? (
                <Suspense fallback={<DeployStageLoading />}>
                    <DashboardBlueprintDeploySource
                        mode={workspace.sourceState.mode}
                        pasteJson={workspace.pasteJson}
                        roleMappingConflicts={workspace.roleMappingConflicts}
                        roleMappings={workspace.roleMappings}
                        sourceState={workspace.sourceState}
                        step={journey.step}
                        structurePolicy={workspace.structurePolicy}
                        targetGuildId={workspace.targetGuildId}
                        targetGuildName={workspace.targetGuildName}
                        onChangeSource={workspace.onChangeSource}
                        onFilesSelected={workspace.onFilesSelected}
                        onInspectSource={workspace.onInspectImportJson}
                        onModeChange={workspace.onModeChange}
                        onPasteJsonChange={workspace.onPasteJsonChange}
                        onRoleMappingChange={workspace.onRoleMappingChange}
                        onStructurePolicyChange={workspace.onStructurePolicyChange}
                    />
                </Suspense>
            ) : null}

            {workspace.deployPlan &&
            (journey.step === 'review' || journey.step === 'safety' || journey.step === 'confirm') ? (
                <ActivePlanStage
                    activePreflightReport={activePreflightReport}
                    journeyStep={journey.step}
                    workspace={workspace}
                />
            ) : null}

            {workspace.deployPlan?.run && journey.step === 'deploy' ? (
                <div className='py-5 sm:py-6'>
                    <Suspense fallback={<DeployStageLoading compact />}>
                        <DashboardBlueprintDeployRun
                            plan={workspace.deployPlan}
                            busy={Boolean(workspace.busyAction)}
                            refreshingSafety={workspace.busyAction === `preflight:${workspace.deployPlan.id}`}
                            onCreateRestorePlan={workspace.onCreateRestorePlan}
                            onRecoveryPlan={() => workspace.onRecoveryPlan(workspace.deployPlan!)}
                            onRefreshSafetyCheck={() => workspace.onPreflightRun(workspace.deployPlan!)}
                        />
                    </Suspense>
                </div>
            ) : null}

            {journey.index > 2 && canStartNewBlueprintDeployment(workspace.deployPlan) ? (
                <div className='border-y border-[var(--dash-border)]'>
                    <button
                        type='button'
                        onClick={workspace.onStartNewBlueprintDeployment}
                        className='w-full py-4 text-left text-sm font-semibold text-[var(--dash-primary)]'>
                        Start over with another blueprint
                    </button>
                </div>
            ) : null}

            <DeployActionRegion
                activePreflightReport={activePreflightReport}
                journeyStep={journey.step}
                workspace={workspace}
            />
        </section>
    );
}

function DeployStageLoading({ compact = false }: { compact?: boolean }) {
    return (
        <div className={compact ? undefined : 'py-5 sm:py-6'}>
            <p
                role='status'
                className='rounded-[var(--dash-radius-control)] border border-[var(--dash-border)] bg-[var(--dash-surface-muted)] p-4 text-sm text-[var(--dash-text-muted)] sm:p-5'>
                Loading deployment stage…
            </p>
        </div>
    );
}

function ActivePlanStage({
    activePreflightReport,
    journeyStep,
    workspace,
}: {
    activePreflightReport: DashboardBlueprintPreflightView | undefined;
    journeyStep: 'review' | 'safety' | 'confirm';
    workspace: DashboardBlueprintDeployWorkspace;
}) {
    const plan = workspace.deployPlan!;
    return (
        <div className='py-5 sm:py-6'>
            <div className='rounded-[var(--dash-radius-control)] border border-[var(--dash-border)] bg-[var(--dash-surface-muted)] p-4 sm:p-5'>
                <div className='flex flex-wrap items-start justify-between gap-3'>
                    <div>
                        <p className='text-sm font-semibold text-[var(--dash-text)]'>Deployment plan</p>
                        <p className='mt-1 text-xs text-[var(--dash-text-muted)]'>
                            {plan.summary.creates} create · {plan.summary.updates} update · {plan.summary.deletes}{' '}
                            delete
                        </p>
                    </div>
                    <p className='rounded-[var(--dash-radius-control)] border border-[var(--dash-border-strong)] px-2.5 py-1.5 text-xs font-semibold text-[var(--dash-text)]'>
                        {plan.changeCount} changes · {plan.planStepCount} steps
                    </p>
                </div>
                <Suspense
                    fallback={
                        <p role='status' className='mt-4 text-sm text-[var(--dash-text-muted)]'>
                            Loading deployment details…
                        </p>
                    }>
                    <DashboardBlueprintDeployReview
                        plan={plan}
                        busyAction={workspace.busyAction}
                        confirmation={workspace.confirmationByPlanId[plan.id]}
                        targetGuildName={workspace.targetGuildName}
                        preflightReport={activePreflightReport}
                        onConfirmationChange={(value) => workspace.onConfirmationChange(plan.id, value)}
                        onLoadPlanSteps={workspace.onLoadPlanSteps}
                        journeyStep={journeyStep}
                    />
                </Suspense>
            </div>
        </div>
    );
}

function DeployStatusRegion({
    journeyStep,
    workspace,
}: {
    journeyStep: ReturnType<typeof deriveDashboardBlueprintDeployJourney>['step'];
    workspace: DashboardBlueprintDeployWorkspace;
}) {
    let content: ReactNode;

    if (workspace.runProgressIssue) {
        content = (
            <DashboardBlueprintRunIssue
                code={workspace.runProgressIssue.code}
                message={formatDashboardBlueprintRunIssue(workspace.runProgressIssue.code)}
                retrying={workspace.runProgressRetrying}
                retryLabel='Retry progress'
                onRetry={workspace.onRetryRunProgress}
            />
        );
    } else if (journeyStep === 'review' && workspace.reviewAuthority.status === 'loading') {
        content = (
            <p className='text-sm font-medium text-[var(--dash-text)]' role='status'>
                Loading the exact persisted plan for review…
            </p>
        );
    } else if (journeyStep === 'review' && workspace.reviewAuthority.status === 'error') {
        content = (
            <DashboardStatus
                tone='danger'
                actions={
                    <button
                        type='button'
                        onClick={workspace.onRetryRefresh}
                        disabled={workspace.reviewAuthority.retrying}
                        className={dashboardSecondaryActionClassName}>
                        {workspace.reviewAuthority.retrying ? 'Retrying…' : 'Retry plan review'}
                    </button>
                }>
                The exact persisted plan could not load. Approval remains locked until it is available.
            </DashboardStatus>
        );
    } else if (workspace.refreshIssue) {
        content = (
            <DashboardStatus
                tone='danger'
                actions={
                    <button
                        type='button'
                        onClick={workspace.onRetryRefresh}
                        disabled={workspace.refreshRetrying}
                        className={dashboardSecondaryActionClassName}>
                        {workspace.refreshRetrying ? 'Retrying…' : 'Retry refresh'}
                    </button>
                }>
                Blueprint data could not refresh. The last confirmed state remains visible.
            </DashboardStatus>
        );
    } else if (workspace.operationStatus?.tone === 'error') {
        content = <StatusMessage status={workspace.operationStatus} />;
    } else {
        const message = readDeployStatusMessage(journeyStep, workspace);
        content = (
            <p className='text-sm font-medium text-[var(--dash-text)]' aria-live='polite' aria-atomic='true'>
                {message}
            </p>
        );
    }

    return (
        <div
            data-blueprint-deploy-status-region
            role='region'
            aria-label='Deployment status'
            className='flex min-h-12 items-center border-b border-[var(--dash-border)] bg-[var(--dash-surface-muted)] px-4 py-2.5 sm:px-5'>
            <div className='w-full'>{content}</div>
        </div>
    );
}

function readDeployStatusMessage(
    journeyStep: ReturnType<typeof deriveDashboardBlueprintDeployJourney>['step'],
    workspace: DashboardBlueprintDeployWorkspace
): string {
    if (workspace.deployPlan?.run) return formatDashboardBlueprintDeployStatus(workspace.deployPlan.run);
    if (workspace.busyAction?.startsWith('apply:')) return 'Starting deployment';
    if (workspace.operationStatus && workspace.operationStatus.tone !== 'error') {
        return workspace.operationStatus.message;
    }
    if (workspace.sourceState.status === 'reading') return `Reading ${workspace.sourceState.fileName}…`;
    if (workspace.sourceState.status === 'invalid') return workspace.sourceState.message;
    if (workspace.sourceState.status === 'ready' && journeyStep === 'source') return 'Blueprint ready';
    if (journeyStep === 'source') return 'Choose a Blueprint JSON file';
    if (journeyStep === 'configure') return 'Choose how the target server should match this blueprint';
    if (journeyStep === 'review') return 'Review the planned changes';
    if (journeyStep === 'safety') return 'Check the live target before deployment';
    if (journeyStep === 'confirm') return 'Confirm the final deployment impact';
    return 'Deployment status';
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
        const sourceReady = workspace.sourceState.status === 'ready';
        content = (
            <ActionRow
                detail={
                    sourceReady
                        ? 'Review the validated source before configuring deployment.'
                        : 'Choose a valid Blueprint JSON file to continue.'
                }>
                <button
                    type='button'
                    disabled={!sourceReady}
                    onClick={workspace.onContinueSource}
                    className={dashboardPrimaryActionClassName}>
                    Continue to configuration
                </button>
            </ActionRow>
        );
    } else if (journeyStep === 'configure') {
        content = (
            <ActionRow detail='Nothing changes until the generated plan is reviewed and authorized.'>
                <button
                    type='button'
                    onClick={workspace.onCreatePlan}
                    disabled={
                        Boolean(workspace.busyAction) || workspace.sourceState.status !== 'ready' || !mappingsComplete
                    }
                    className={dashboardPrimaryActionClassName}>
                    {workspace.busyAction === 'plan' ? 'Generating review plan' : 'Generate review plan'}
                </button>
            </ActionRow>
        );
    } else if (plan && journeyStep !== 'deploy') {
        content = (
            <DashboardBlueprintDeployActionBar
                busyAction={workspace.busyAction}
                confirmation={workspace.confirmationByPlanId[plan.id] ?? emptyDashboardBlueprintConfirmation}
                targetGuildName={workspace.targetGuildName}
                plan={plan}
                preflightReport={activePreflightReport}
                onApprove={() => workspace.onApprovePlan(plan)}
                onPreflight={() => workspace.onPreflightRun(plan)}
                onApply={() => workspace.onApplyRun(plan)}
                onReviewBlocker={() => workspace.onLoadPlanDecisions(plan)}
                reviewAuthorityReady={
                    workspace.reviewAuthority.planId === plan.id && workspace.reviewAuthority.status === 'ready'
                }
            />
        );
    } else {
        content = <DeployRunAction workspace={workspace} />;
    }

    return (
        <div
            data-blueprint-deploy-action-region
            role='region'
            aria-label='Deployment action'
            className='sticky bottom-0 z-10 -mx-4 mt-2 border-t border-[var(--dash-border)] bg-[var(--dash-bg)] px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] shadow-[0_-12px_30px_rgba(0,0,0,0.22)] sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8'>
            {content}
        </div>
    );
}

function DeployRunAction({ workspace }: { workspace: DashboardBlueprintDeployWorkspace }) {
    const plan = workspace.deployPlan;
    const run = plan?.run;
    if (!plan || !run) return <p className='text-xs text-[var(--dash-text-muted)]'>Waiting for deployment state.</p>;

    if (['running', 'waiting_rate_limit'].includes(run.status)) {
        return (
            <ActionRow detail={formatDashboardBlueprintDeployStatus(run)}>
                <button
                    type='button'
                    disabled={Boolean(workspace.busyAction)}
                    onClick={() => workspace.onControlRun(plan, 'pause')}
                    className={dashboardSecondaryActionClassName}>
                    Pause deployment
                </button>
            </ActionRow>
        );
    }
    if (run.status === 'paused') {
        return (
            <ActionRow detail={formatDashboardBlueprintDeployStatus(run)}>
                <button
                    type='button'
                    disabled={Boolean(workspace.busyAction)}
                    onClick={() => workspace.onControlRun(plan, 'resume')}
                    className={dashboardPrimaryActionClassName}>
                    Resume deployment
                </button>
                <button
                    type='button'
                    disabled={Boolean(workspace.busyAction)}
                    onClick={() => workspace.onControlRun(plan, 'cancel')}
                    className={dashboardSecondaryActionClassName}>
                    Cancel deployment
                </button>
            </ActionRow>
        );
    }
    if (run.status === 'queued') {
        return (
            <ActionRow detail='Queued deployments can be cancelled before server changes begin.'>
                <button
                    type='button'
                    disabled={Boolean(workspace.busyAction)}
                    onClick={() => workspace.onControlRun(plan, 'cancel')}
                    className={dashboardSecondaryActionClassName}>
                    Cancel deployment
                </button>
            </ActionRow>
        );
    }
    return <p className='text-xs text-[var(--dash-text-muted)]'>{formatDashboardBlueprintDeployStatus(run)}</p>;
}

function ActionRow({ detail, children }: { detail: string; children: ReactNode }) {
    return (
        <div className='flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between'>
            <p className='text-xs leading-5 text-[var(--dash-text-muted)]'>{detail}</p>
            <div className='flex shrink-0 flex-wrap gap-2 [&>button]:w-full sm:[&>button]:w-auto'>{children}</div>
        </div>
    );
}

function areRoleMappingsComplete(workspace: DashboardBlueprintDeployWorkspace): boolean {
    return workspace.roleMappingConflicts.every((conflict) =>
        conflict.sourceIds.every((sourceId) => Boolean(workspace.roleMappings[sourceId]))
    );
}

function capitalize(value: string): string {
    return `${value.charAt(0).toUpperCase()}${value.slice(1)}`;
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

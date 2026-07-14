import { useEffect, useMemo, useState } from 'react';

import type {
    DashboardStructureImportAction,
    DashboardStructureImportRun,
} from '../server/dashboard-structure-model.js';
import {
    DashboardStructureActionInspector,
    DashboardStructureActionPreview,
} from './dashboard-structure-action-inspection.js';
import { readDashboardStructureDeployReadiness } from './dashboard-structure-deploy-readiness.js';
import { DashboardStructureExplorer } from './dashboard-structure-explorer.js';
import {
    readDashboardStructureExplorerEntityKey as readDashboardStructureExplorerActionEntityKey,
    readDashboardStructureExplorerSection,
} from './dashboard-structure-explorer-snapshot.js';
import type {
    DashboardStructureExplorerEntityKey,
    DashboardStructureExplorerSection,
} from './dashboard-structure-explorer-snapshot.js';
import type { StructureBusyAction } from './dashboard-structure-import-history.js';
import { readRequestedFinalStateExplorerSnapshot } from './dashboard-structure-panel-requested-snapshot.js';
import type { DashboardStructurePreflightView } from './dashboard-structure-panel-types.js';
import {
    dashboardDangerActionClassName,
    dashboardFieldClassName,
    dashboardPrimaryActionClassName,
    dashboardSecondaryActionClassName,
} from './dashboard-ui.js';

export function DashboardStructureDeployReview({
    busyAction,
    deleteConfirmation,
    onApprove,
    onApply,
    onDeleteConfirmationChange,
    onInspectAction,
    onLoadActions,
    onLoadDecisions,
    onPreflight,
    preflightReport,
    run,
}: {
    busyAction: StructureBusyAction | undefined;
    deleteConfirmation: string;
    onApprove: (run: DashboardStructureImportRun) => void;
    onApply: (run: DashboardStructureImportRun) => void;
    onDeleteConfirmationChange: (runId: string, confirmation: string) => void;
    onInspectAction?: (run: DashboardStructureImportRun, action: DashboardStructureImportAction) => void;
    onLoadActions: (run: DashboardStructureImportRun) => void;
    onLoadDecisions: (run: DashboardStructureImportRun) => void;
    onPreflight: (run: DashboardStructureImportRun) => void;
    preflightReport: DashboardStructurePreflightView | undefined;
    run: DashboardStructureImportRun;
}) {
    const snapshot = useMemo(() => readRequestedFinalStateExplorerSnapshot(run), [run]);
    const [section, setSection] = useState<DashboardStructureExplorerSection>('channels');
    const [selectedBySection, setSelectedBySection] = useState<
        Partial<Record<DashboardStructureExplorerSection, DashboardStructureExplorerEntityKey>>
    >({});
    const [inspectedAction, setInspectedAction] = useState<DashboardStructureImportAction>();
    const now = useExpiryClock(preflightReport?.expiresAt);
    const readiness = readDashboardStructureDeployReadiness({
        deleteConfirmation,
        now,
        preflightReport,
        run,
    });

    function revealAction(action: DashboardStructureImportAction): void {
        setInspectedAction(action);
        const entityKey = readDashboardStructureExplorerActionEntityKey(action);
        if (entityKey) {
            const nextSection = readDashboardStructureExplorerSection(entityKey);
            setSection(nextSection);
            setSelectedBySection((current) => ({ ...current, [nextSection]: entityKey }));
        }
        onInspectAction?.(run, action);
    }

    function revealFirstBlocker(): void {
        const firstBlocker = preflightReport?.actions.find((action) => action.status !== 'ready');
        const action = firstBlocker
            ? run.actions.find((candidate) => candidate.id === firstBlocker.actionId)
            : undefined;
        if (action) revealAction(action);
        else onLoadDecisions(run);
    }

    const targetDetail = formatTargetDetail(
        preflightReport,
        readiness.preflightExpired,
        readiness.retryPreflightRequired
    );

    return (
        <section className='mt-3 space-y-3' aria-label='Blueprint deploy review'>
            <ReadinessChecklist
                hasSnapshot={Boolean(snapshot)}
                preflightReport={preflightReport}
                readiness={readiness}
                run={run}
            />

            <DashboardStructureExplorer
                busyAction={busyAction}
                drift={undefined}
                overlayMode={`run:${run.id}`}
                preflightByRunId={preflightReport ? { [run.id]: preflightReport } : {}}
                runs={[run]}
                section={section}
                selectedEntityKey={selectedBySection[section]}
                comparisonTarget={{ label: 'Current server', detail: targetDetail, type: 'live' }}
                source={{
                    label: snapshot?.guildName ? `${snapshot.guildName} requested blueprint` : 'Requested blueprint',
                    detail: snapshot ? 'Requested final state' : 'Stored source snapshot unavailable',
                    snapshot,
                    type: 'requested-final-state',
                }}
                onCompareDriftBaseline={() => undefined}
                onCompareImportJson={() => undefined}
                onCompareLive={() => undefined}
                onCompareRequestedFinalState={() => undefined}
                onInspectImportJson={() => undefined}
                onInspectRequestedFinalState={() => undefined}
                onLoadActions={onLoadActions}
                onLoadLive={() => undefined}
                onOverlayModeChange={() => undefined}
                onSectionChange={setSection}
                onSelectedEntityKeyChange={(key) =>
                    setSelectedBySection((current) => (key ? { ...current, [section]: key } : current))
                }
                presentation='review'
            />

            <NextSafeAction
                busyAction={busyAction}
                deleteConfirmation={deleteConfirmation}
                onApprove={() => onApprove(run)}
                onApply={() => onApply(run)}
                onDeleteConfirmationChange={(value) => onDeleteConfirmationChange(run.id, value)}
                onPreflight={() => onPreflight(run)}
                onReviewBlocker={revealFirstBlocker}
                readiness={readiness}
                run={run}
            />

            <details className='rounded-[var(--dash-radius-control)] border border-[var(--dash-border)] bg-[var(--dash-bg)] p-3'>
                <summary
                    data-dashboard-disclosure
                    className='cursor-pointer text-xs font-semibold text-[var(--dash-text-muted)]'>
                    Technical action payloads
                </summary>
                <DashboardStructureActionPreview
                    actions={run.actions}
                    actionCount={run.executionActionCount}
                    isLoading={busyAction === `actions:${run.id}`}
                    onLoad={() => onLoadActions(run)}
                    onInspectAction={revealAction}
                />
                {inspectedAction ? (
                    <DashboardStructureActionInspector
                        action={inspectedAction}
                        onClose={() => setInspectedAction(undefined)}
                    />
                ) : null}
            </details>
        </section>
    );
}

function ReadinessChecklist({
    hasSnapshot,
    preflightReport,
    readiness,
    run,
}: {
    hasSnapshot: boolean;
    preflightReport: DashboardStructurePreflightView | undefined;
    readiness: ReturnType<typeof readDashboardStructureDeployReadiness>;
    run: DashboardStructureImportRun;
}) {
    const reviewed = run.status === 'approved' || Boolean(run.execution);
    const preflightComplete = readiness.preflightReady;
    const destructiveRequired = readiness.destructiveApprovalCount > 0;
    const destructiveComplete = destructiveRequired
        ? readiness.nextAction === 'apply' || Boolean(run.execution)
        : preflightComplete || Boolean(run.execution);
    const items = [
        {
            label: 'Source validity',
            detail: hasSnapshot
                ? 'Validated requested blueprint is available.'
                : 'Validated plan; source preview unavailable.',
            state: run.status === 'stale' ? 'blocked' : 'complete',
        },
        {
            label: 'Reviewed plan',
            detail: run.planBlockerCount
                ? `${run.planBlockerCount} blocked decision${run.planBlockerCount === 1 ? '' : 's'}.`
                : reviewed
                  ? 'This exact plan is approved.'
                  : 'Review Channels, Roles, permissions, and planned changes.',
            state: run.planBlockerCount ? 'blocked' : reviewed ? 'complete' : 'current',
        },
        {
            label: 'Fresh live safety check',
            detail: formatSafetyStep(preflightReport, readiness),
            state: readiness.hardBlockerCount
                ? 'blocked'
                : preflightComplete || Boolean(run.execution)
                  ? 'complete'
                  : reviewed
                    ? 'current'
                    : 'pending',
        },
        {
            label: 'Destructive confirmation',
            detail: destructiveRequired
                ? destructiveComplete
                    ? 'Plan-bound deletion confirmation is complete.'
                    : `${readiness.destructiveApprovalCount} irreversible deletion${readiness.destructiveApprovalCount === 1 ? '' : 's'} need confirmation.`
                : 'Not required for this plan.',
            state:
                destructiveRequired && !destructiveComplete ? (preflightComplete ? 'current' : 'pending') : 'complete',
        },
        {
            label: 'Apply readiness',
            detail: readiness.canApply
                ? 'Ready to start the durable deployment.'
                : 'Locked until every prior check passes.',
            state: readiness.canApply ? 'current' : run.execution ? 'complete' : 'pending',
        },
    ] as const;

    return (
        <ol className='grid gap-2 sm:grid-cols-2 xl:grid-cols-5' aria-label='Deployment readiness'>
            {items.map((item, index) => (
                <li
                    key={item.label}
                    className={`rounded-[var(--dash-radius-control)] border p-3 ${readinessStepClassName(item.state)}`}>
                    <p className='text-[11px] font-semibold tracking-wide uppercase'>
                        {index + 1}. {item.label}
                    </p>
                    <p className='mt-1 text-xs leading-5 text-[var(--dash-text-muted)]'>{item.detail}</p>
                </li>
            ))}
        </ol>
    );
}

function NextSafeAction({
    busyAction,
    deleteConfirmation,
    onApprove,
    onApply,
    onDeleteConfirmationChange,
    onPreflight,
    onReviewBlocker,
    readiness,
    run,
}: {
    busyAction: StructureBusyAction | undefined;
    deleteConfirmation: string;
    onApprove: () => void;
    onApply: () => void;
    onDeleteConfirmationChange: (value: string) => void;
    onPreflight: () => void;
    onReviewBlocker: () => void;
    readiness: ReturnType<typeof readDashboardStructureDeployReadiness>;
    run: DashboardStructureImportRun;
}) {
    if (readiness.nextAction === 'none') return null;

    return (
        <div className='rounded-[var(--dash-radius-control)] border border-[color:var(--dash-info)]/35 bg-[var(--dash-info-soft)] p-3'>
            <p className='text-xs font-semibold text-[var(--dash-text)]'>Next safe action</p>
            <p className='mt-1 text-xs leading-5 text-[var(--dash-text-muted)]'>
                {formatNextActionDetail(readiness.nextAction)}
            </p>
            {readiness.nextAction === 'confirm-delete' ? (
                <label className='mt-2 block text-xs font-semibold text-[var(--dash-text)]'>
                    Type {readiness.expectedDeleteText} to confirm {readiness.destructiveApprovalCount} irreversible
                    delete
                    {readiness.destructiveApprovalCount === 1 ? '' : 's'}
                    <input
                        aria-label={`Confirm ${readiness.destructiveApprovalCount} irreversible delete${readiness.destructiveApprovalCount === 1 ? '' : 's'}`}
                        value={deleteConfirmation}
                        onChange={(event) => onDeleteConfirmationChange(event.currentTarget.value)}
                        className={`mt-2 ${dashboardFieldClassName} focus:border-[var(--dash-danger)]`}
                    />
                </label>
            ) : (
                <div className='mt-2 flex justify-end'>
                    <button
                        type='button'
                        disabled={Boolean(busyAction)}
                        onClick={
                            readiness.nextAction === 'approve'
                                ? onApprove
                                : readiness.nextAction === 'preflight'
                                  ? onPreflight
                                  : readiness.nextAction === 'apply'
                                    ? onApply
                                    : onReviewBlocker
                        }
                        className={
                            readiness.nextAction === 'apply' && readiness.destructiveApprovalCount > 0
                                ? dashboardDangerActionClassName
                                : readiness.nextAction === 'review-blocker' || readiness.nextAction === 'preflight'
                                  ? dashboardSecondaryActionClassName
                                  : dashboardPrimaryActionClassName
                        }>
                        {formatNextActionLabel(readiness, run, busyAction)}
                    </button>
                </div>
            )}
        </div>
    );
}

function formatNextActionDetail(
    action: ReturnType<typeof readDashboardStructureDeployReadiness>['nextAction']
): string {
    if (action === 'approve') {
        return 'Records this exact review. NeonFlux will immediately check the live server again; nothing changes yet.';
    }
    if (action === 'preflight') return 'Re-reads the live server; it does not change server state.';
    if (action === 'confirm-delete') return 'Confirmation is bound to this plan and its checked deletion set.';
    if (action === 'apply') return 'Starts the durable deployment after saving its restore point.';
    return 'Inspect the blocking change before correcting the source and creating a new plan.';
}

function formatNextActionLabel(
    readiness: ReturnType<typeof readDashboardStructureDeployReadiness>,
    run: DashboardStructureImportRun,
    busyAction: StructureBusyAction | undefined
): string {
    if (readiness.nextAction === 'approve') {
        return busyAction === `approval:${run.id}` || busyAction === `preflight:${run.id}`
            ? 'Checking live server'
            : 'Continue to final check';
    }
    if (readiness.nextAction === 'preflight') {
        return busyAction === `preflight:${run.id}`
            ? 'Checking live server'
            : readiness.preflightExpired || readiness.retryPreflightRequired
              ? 'Refresh safety check'
              : 'Run safety check';
    }
    if (readiness.nextAction === 'apply') {
        return busyAction === `apply:${run.id}`
            ? 'Starting deployment'
            : `Apply ${run.actionCount} change${run.actionCount === 1 ? '' : 's'}${readiness.destructiveApprovalCount ? `, including ${readiness.destructiveApprovalCount} deletion${readiness.destructiveApprovalCount === 1 ? '' : 's'}` : ''}`;
    }
    return 'Review first blocker';
}

function formatSafetyStep(
    report: DashboardStructurePreflightView | undefined,
    readiness: ReturnType<typeof readDashboardStructureDeployReadiness>
): string {
    if (!report) return 'Not run yet.';
    if (readiness.retryPreflightRequired) return 'Must be newer than the failed deployment attempt.';
    if (readiness.preflightExpired) return 'Expired; refresh before apply.';
    if (readiness.hardBlockerCount) {
        return `${readiness.hardBlockerCount} blocking change${readiness.hardBlockerCount === 1 ? '' : 's'} found.`;
    }
    return 'Fresh and valid for this reviewed plan.';
}

function formatTargetDetail(
    report: DashboardStructurePreflightView | undefined,
    expired: boolean,
    retryRequired: boolean
): string {
    if (!report) return 'Fresh safety check not run';
    if (retryRequired) return 'Fresh safety check required after failed attempt';
    if (expired) return 'Safety check expired';
    return report.checkedAt ? `Safety checked ${formatDate(report.checkedAt)}` : 'Safety check complete';
}

function formatDate(value: string): string {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function readinessStepClassName(state: 'blocked' | 'complete' | 'current' | 'pending'): string {
    if (state === 'blocked')
        return 'border-[color:var(--dash-danger)]/35 bg-[var(--dash-danger-soft)] text-[var(--dash-danger)]';
    if (state === 'complete')
        return 'border-[color:var(--dash-success)]/35 bg-[var(--dash-success-soft)] text-[var(--dash-success)]';
    if (state === 'current')
        return 'border-[color:var(--dash-primary)]/40 bg-[var(--dash-bg)] text-[var(--dash-primary)]';
    return 'border-[var(--dash-border)] bg-[var(--dash-bg)] text-[var(--dash-text-subtle)]';
}

function useExpiryClock(expiresAt: string | undefined): number {
    const [now, setNow] = useState(() => Date.now());

    useEffect(() => {
        if (!expiresAt) return;
        const expiryTime = new Date(expiresAt).getTime();
        const delay = Number.isFinite(expiryTime) ? Math.max(0, expiryTime - Date.now()) : 0;
        const timeout = window.setTimeout(() => setNow(Date.now()), delay);
        return () => window.clearTimeout(timeout);
    }, [expiresAt]);

    return now;
}

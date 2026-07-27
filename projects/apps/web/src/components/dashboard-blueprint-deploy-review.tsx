import { useEffect, useMemo, useState } from 'react';

import type { DashboardBlueprintPlanStep, DashboardBlueprintPlan } from '../server/dashboard-blueprint-model.js';
import {
    DashboardBlueprintPlanStepInspector,
    DashboardBlueprintPlanStepPreview,
} from './dashboard-blueprint-plan-step-inspection.js';
import {
    emptyDashboardBlueprintConfirmation,
    readDashboardBlueprintDeployReadiness,
} from './dashboard-blueprint-deploy-readiness.js';
import type { DashboardBlueprintConfirmationDraft } from './dashboard-blueprint-deploy-readiness.js';
import { DashboardBlueprintExplorer } from './dashboard-blueprint-explorer.js';
import {
    readDashboardBlueprintExplorerEntityKey as readDashboardBlueprintExplorerPlanStepEntityKey,
    readDashboardBlueprintExplorerSection,
} from './dashboard-blueprint-explorer-snapshot.js';
import type {
    DashboardBlueprintExplorerEntityKey,
    DashboardBlueprintExplorerSection,
} from './dashboard-blueprint-explorer-snapshot.js';
import type { BlueprintBusyAction, DashboardBlueprintPreflightView } from './dashboard-blueprint-panel-types.js';
import type { DashboardBlueprintDeployJourneyStep } from './dashboard-blueprint-deploy-stage.js';
import { readRequestedFinalStateExplorerSnapshot } from './dashboard-blueprint-panel-requested-snapshot.js';
import { dashboardFieldClassName } from './dashboard-ui.js';

export function DashboardBlueprintDeployReview({
    busyAction,
    confirmation = emptyDashboardBlueprintConfirmation,
    targetGuildName,
    onInspectPlanStep,
    onLoadPlanSteps,
    onConfirmationChange,
    preflightReport,
    plan,
    journeyStep,
}: {
    busyAction: BlueprintBusyAction | undefined;
    confirmation?: DashboardBlueprintConfirmationDraft;
    targetGuildName: string;
    onInspectPlanStep?: (plan: DashboardBlueprintPlan, action: DashboardBlueprintPlanStep) => void;
    onLoadPlanSteps: (plan: DashboardBlueprintPlan) => void;
    onConfirmationChange?: (value: DashboardBlueprintConfirmationDraft) => void;
    preflightReport: DashboardBlueprintPreflightView | undefined;
    plan: DashboardBlueprintPlan;
    journeyStep: DashboardBlueprintDeployJourneyStep;
}) {
    const snapshot = useMemo(() => readRequestedFinalStateExplorerSnapshot(plan), [plan]);
    const [section, setSection] = useState<DashboardBlueprintExplorerSection>('channels');
    const [selectedBySection, setSelectedBySection] = useState<
        Partial<Record<DashboardBlueprintExplorerSection, DashboardBlueprintExplorerEntityKey>>
    >({});
    const [inspectedPlanStep, setInspectedPlanStep] = useState<DashboardBlueprintPlanStep>();
    const now = useExpiryClock(preflightReport?.expiresAt);
    const readiness = readDashboardBlueprintDeployReadiness({
        confirmation,
        targetGuildName,
        now,
        preflightReport,
        plan,
    });

    function revealPlanStep(action: DashboardBlueprintPlanStep): void {
        setInspectedPlanStep(action);
        const entityKey = readDashboardBlueprintExplorerPlanStepEntityKey(action);
        if (entityKey) {
            const nextSection = readDashboardBlueprintExplorerSection(entityKey);
            setSection(nextSection);
            setSelectedBySection((current) => ({ ...current, [nextSection]: entityKey }));
        }
        onInspectPlanStep?.(plan, action);
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
                plan={plan}
            />

            {journeyStep === 'review' ? (
                <DashboardBlueprintExplorer
                    busyAction={busyAction}
                    drift={undefined}
                    overlayMode={`plan:${plan.id}`}
                    preflightByPlanId={preflightReport ? { [plan.id]: preflightReport } : {}}
                    plans={[plan]}
                    section={section}
                    selectedEntityKey={selectedBySection[section]}
                    comparisonTarget={{ label: 'Current server', detail: targetDetail, type: 'live' }}
                    source={{
                        label: snapshot?.guildName
                            ? `${snapshot.guildName} requested blueprint`
                            : 'Requested blueprint',
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
                    onLoadPlanSteps={onLoadPlanSteps}
                    onLoadLive={() => undefined}
                    onOverlayModeChange={() => undefined}
                    onSectionChange={setSection}
                    onSelectedEntityKeyChange={(key) =>
                        setSelectedBySection((current) => (key ? { ...current, [section]: key } : current))
                    }
                    presentation='review'
                />
            ) : null}

            {journeyStep === 'review' ? (
                <details className='rounded-[var(--dash-radius-control)] border border-[var(--dash-border)] bg-[var(--dash-bg)] p-3'>
                    <summary
                        data-dashboard-disclosure
                        className='cursor-pointer text-xs font-semibold text-[var(--dash-text-muted)]'>
                        Technical plan steps
                    </summary>
                    <DashboardBlueprintPlanStepPreview
                        actions={plan.steps}
                        changeCount={plan.planStepCount}
                        isLoading={busyAction === `plan-steps:${plan.id}`}
                        onLoad={() => onLoadPlanSteps(plan)}
                        onInspectPlanStep={revealPlanStep}
                    />
                    {inspectedPlanStep ? (
                        <DashboardBlueprintPlanStepInspector
                            action={inspectedPlanStep}
                            onClose={() => setInspectedPlanStep(undefined)}
                        />
                    ) : null}
                </details>
            ) : null}

            {journeyStep === 'confirm' && onConfirmationChange ? (
                <ConfirmationRequirements
                    confirmation={confirmation}
                    destructiveCount={readiness.destructiveApprovalCount}
                    policy={plan.policy}
                    targetGuildName={targetGuildName}
                    onChange={onConfirmationChange}
                />
            ) : null}
        </section>
    );
}

function ConfirmationRequirements({
    confirmation,
    destructiveCount,
    policy,
    targetGuildName,
    onChange,
}: {
    confirmation: DashboardBlueprintConfirmationDraft;
    destructiveCount: number;
    policy: DashboardBlueprintPlan['policy'];
    targetGuildName: string;
    onChange: (value: DashboardBlueprintConfirmationDraft) => void;
}) {
    if (destructiveCount === 0) {
        return (
            <div className='rounded-[var(--dash-radius-control)] border border-[color:var(--dash-success)]/35 bg-[var(--dash-success-soft)] p-4 sm:p-5'>
                <p className='text-sm font-semibold text-[var(--dash-text)]'>No destructive confirmation required</p>
                <p className='mt-1 text-xs leading-5 text-[var(--dash-text-muted)]'>
                    The server will still revalidate the plan, target, safety check, and delete set before queueing.
                </p>
            </div>
        );
    }

    return (
        <fieldset className='rounded-[var(--dash-radius-control)] border border-[color:var(--dash-danger)]/35 bg-[var(--dash-danger-soft)] p-4 sm:p-5'>
            <legend className='px-1 text-sm font-semibold text-[var(--dash-text)]'>Confirm destructive changes</legend>
            <div className='mt-2 space-y-4'>
                <label className='flex items-start gap-2 text-sm text-[var(--dash-text)]'>
                    <input
                        type='checkbox'
                        checked={confirmation.understandsDeletion}
                        onChange={(event) =>
                            onChange({ ...confirmation, understandsDeletion: event.currentTarget.checked })
                        }
                        className='mt-0.5'
                    />
                    I understand that {destructiveCount} existing object{destructiveCount === 1 ? '' : 's'} will be
                    removed.
                </label>
                {policy === 'rebuild' ? (
                    <>
                        <label className='flex items-start gap-2 text-sm text-[var(--dash-text)]'>
                            <input
                                type='checkbox'
                                checked={confirmation.understandsRestorePointRequirement}
                                onChange={(event) =>
                                    onChange({
                                        ...confirmation,
                                        understandsRestorePointRequirement: event.currentTarget.checked,
                                    })
                                }
                                className='mt-0.5'
                            />
                            I understand that NeonFlux must create a restore point before mutation.
                        </label>
                        <label className='block text-sm font-semibold text-[var(--dash-text)]'>
                            Type the target server name to continue: {targetGuildName}
                            <input
                                aria-label='Target server name confirmation'
                                value={confirmation.targetGuildName}
                                onChange={(event) =>
                                    onChange({ ...confirmation, targetGuildName: event.currentTarget.value })
                                }
                                className={`mt-2 ${dashboardFieldClassName} focus:border-[var(--dash-danger)]`}
                            />
                        </label>
                    </>
                ) : null}
            </div>
        </fieldset>
    );
}

function ReadinessChecklist({
    hasSnapshot,
    preflightReport,
    readiness,
    plan,
}: {
    hasSnapshot: boolean;
    preflightReport: DashboardBlueprintPreflightView | undefined;
    readiness: ReturnType<typeof readDashboardBlueprintDeployReadiness>;
    plan: DashboardBlueprintPlan;
}) {
    const reviewed = plan.status === 'approved' || Boolean(plan.run);
    const preflightComplete = readiness.preflightReady;
    const destructiveRequired = readiness.destructiveApprovalCount > 0;
    const destructiveComplete = destructiveRequired
        ? readiness.nextAction === 'apply' || Boolean(plan.run)
        : preflightComplete || Boolean(plan.run);
    const items = [
        {
            label: 'Source validity',
            detail: hasSnapshot
                ? 'Validated requested blueprint is available.'
                : 'Validated plan; source preview unavailable.',
            state: plan.status === 'stale' ? 'blocked' : 'complete',
        },
        {
            label: 'Reviewed plan',
            detail: plan.planBlockerCount
                ? `${plan.planBlockerCount} blocked decision${plan.planBlockerCount === 1 ? '' : 's'}.`
                : reviewed
                  ? 'This exact plan is approved.'
                  : 'Review Channels, Roles, permissions, and planned changes.',
            state: plan.planBlockerCount ? 'blocked' : reviewed ? 'complete' : 'current',
        },
        {
            label: 'Fresh live safety check',
            detail: formatSafetyStep(preflightReport, readiness),
            state: readiness.hardBlockerCount
                ? 'blocked'
                : preflightComplete || Boolean(plan.run)
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
            state: readiness.canApply ? 'current' : plan.run ? 'complete' : 'pending',
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

function formatSafetyStep(
    report: DashboardBlueprintPreflightView | undefined,
    readiness: ReturnType<typeof readDashboardBlueprintDeployReadiness>
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
    report: DashboardBlueprintPreflightView | undefined,
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

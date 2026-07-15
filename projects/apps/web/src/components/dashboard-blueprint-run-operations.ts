import { useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';

import {
    applyDashboardBlueprintPlanRouteData,
    approveDashboardBlueprintPlanRouteData,
    controlDashboardBlueprintRunRouteData,
    createDashboardBlueprintRecoveryPlanRouteData,
    preflightDashboardBlueprintPlanRouteData,
} from '../server/dashboard-blueprint-route-data.js';
import type { DashboardBlueprintPlan } from '../server/dashboard-blueprint-model.js';
import type { BlueprintBusyAction } from './dashboard-blueprint-history.js';
import { formatStatus } from './dashboard-blueprint-panel-format.js';
import {
    toApplyErrorStatus,
    toErrorStatus,
    toRunActionStatus,
    toUnexpectedErrorStatus,
} from './dashboard-blueprint-panel-status.js';
import type { DashboardBlueprintPreflightView, PanelStatus } from './dashboard-blueprint-panel-types.js';
import { emptyDashboardBlueprintConfirmation } from './dashboard-blueprint-deploy-readiness.js';
import type { DashboardBlueprintConfirmationDraft } from './dashboard-blueprint-deploy-readiness.js';

export function useDashboardBlueprintRunOperations({
    guildId,
    refreshAuditEvents,
    refreshRuns,
    seedPlanSteps,
    setBusyAction,
    setStatus,
}: {
    guildId: string;
    refreshAuditEvents: () => Promise<void>;
    refreshRuns: () => Promise<void>;
    seedPlanSteps: (plan: DashboardBlueprintPlan) => void;
    setBusyAction: Dispatch<SetStateAction<BlueprintBusyAction | undefined>>;
    setStatus: Dispatch<SetStateAction<PanelStatus | undefined>>;
}) {
    const [confirmationByPlanId, setConfirmationByPlanId] = useState<
        Record<string, DashboardBlueprintConfirmationDraft>
    >({});
    const [preflightByPlanId, setPreflightByPlanId] = useState<Record<string, DashboardBlueprintPreflightView>>({});
    const [preflightDigestByPlanId, setPreflightDigestByPlanId] = useState<Partial<Record<string, string>>>({});

    async function approvePlan(plan: DashboardBlueprintPlan): Promise<DashboardBlueprintPlan | undefined> {
        setStatus(undefined);
        setBusyAction(`approval:${plan.id}`);

        try {
            const result = await approveDashboardBlueprintPlanRouteData({
                data: { guildId, planId: plan.id, planDigest: plan.planDigest },
            });
            if (result.type !== 'approved') {
                setStatus(toRunActionStatus(result));
                return undefined;
            }

            seedPlanSteps(result.plan);
            setStatus({ tone: 'success', message: 'Reviewed plan approved. No server changes were applied.' });
            await refreshRuns();
            await refreshAuditEvents();
            return result.plan;
        } catch {
            setStatus(toUnexpectedErrorStatus());
        } finally {
            setBusyAction(undefined);
        }
    }

    async function preflightPlan(plan: DashboardBlueprintPlan): Promise<void> {
        setStatus(undefined);
        setBusyAction(`preflight:${plan.id}`);

        try {
            const result = await preflightDashboardBlueprintPlanRouteData({
                data: { guildId, planId: plan.id },
            });
            if (result.type !== 'preflight') {
                setStatus(
                    result.type === 'invalid-input'
                        ? { tone: 'error', message: result.message }
                        : result.type === 'not-preflightable'
                          ? {
                                tone: 'error',
                                message: `This plan is ${formatStatus(result.status)} and cannot be checked.`,
                            }
                          : toErrorStatus(result.type)
                );
                return;
            }

            setPreflightByPlanId((current) => ({
                ...current,
                [plan.id]: {
                    ...result.report,
                    ...(result.checkedAt ? { checkedAt: result.checkedAt } : {}),
                    ...(result.expiresAt ? { expiresAt: result.expiresAt } : {}),
                },
            }));
            if (result.preflightDigest) {
                setPreflightDigestByPlanId((current) => ({ ...current, [plan.id]: result.preflightDigest! }));
            }
            setConfirmationByPlanId((current) => ({
                ...current,
                [plan.id]: emptyDashboardBlueprintConfirmation,
            }));
            setStatus({
                tone: 'neutral',
                message: `Preflight checked ${result.report.summary.total} planned changes. No server changes were applied.`,
            });
            await refreshRuns();
            await refreshAuditEvents();
        } catch {
            setStatus(toUnexpectedErrorStatus());
        } finally {
            setBusyAction(undefined);
        }
    }

    async function reviewAndPreflight(plan: DashboardBlueprintPlan): Promise<void> {
        const approvedRun = await approvePlan(plan);
        if (approvedRun) await preflightPlan(approvedRun);
    }

    async function applyPlan(plan: DashboardBlueprintPlan): Promise<void> {
        setStatus(undefined);
        setBusyAction(`apply:${plan.id}`);

        try {
            const result = await applyDashboardBlueprintPlanRouteData({
                data: {
                    guildId,
                    planId: plan.id,
                    planDigest: plan.planDigest,
                    preflightDigest: preflightDigestByPlanId[plan.id] ?? plan.preflight?.digest ?? '',
                    confirmation: toConfirmationInput(confirmationByPlanId[plan.id]),
                },
            });
            if (result.type !== 'queued') {
                setStatus(toApplyErrorStatus(result));
                return;
            }

            setConfirmationByPlanId((current) => ({
                ...current,
                [plan.id]: emptyDashboardBlueprintConfirmation,
            }));
            setStatus({ tone: 'neutral', message: 'Queued' });
            const refreshResults = await Promise.allSettled([refreshRuns(), refreshAuditEvents()]);
            if (refreshResults.some((refreshResult) => refreshResult.status === 'rejected')) {
                setStatus({ tone: 'neutral', message: 'Queued · live status is reconnecting' });
            }
        } catch {
            setStatus(toUnexpectedErrorStatus());
        } finally {
            setBusyAction(undefined);
        }
    }

    async function controlRun(plan: DashboardBlueprintPlan, request: 'pause' | 'resume' | 'cancel'): Promise<void> {
        if (!plan.run) return;
        setStatus(undefined);
        setBusyAction(`control:${plan.id}`);

        try {
            const result = await controlDashboardBlueprintRunRouteData({
                data: { guildId, planId: plan.id, runId: plan.run.id, request },
            });
            if (result.type !== 'run-updated') {
                setStatus(toErrorStatus(result.type));
                return;
            }
            setStatus({ tone: 'neutral', message: `Deployment ${result.status.replaceAll('_', ' ')}.` });
            await refreshRuns();
        } catch {
            setStatus(toUnexpectedErrorStatus());
        } finally {
            setBusyAction(undefined);
        }
    }

    async function createRecoveryPlan(plan: DashboardBlueprintPlan): Promise<DashboardBlueprintPlan | undefined> {
        setStatus(undefined);
        setBusyAction(`recovery:${plan.id}`);

        try {
            const result = await createDashboardBlueprintRecoveryPlanRouteData({
                data: { guildId, planId: plan.id },
            });
            if (result.type !== 'recovery-plan-created') {
                setStatus(
                    result.type === 'invalid-input'
                        ? { tone: 'error', message: result.message }
                        : result.type === 'not-recoverable'
                          ? {
                                tone: 'error',
                                message: `This plan is ${formatStatus(result.status)} and cannot be retried.`,
                            }
                          : toErrorStatus(result.type)
                );
                return undefined;
            }

            seedPlanSteps(result.plan);
            setStatus({
                tone: 'success',
                message: `Recovery plan created with ${result.plan.changeCount} live change${result.plan.changeCount === 1 ? '' : 's'}.`,
            });
            await refreshRuns();
            return result.plan;
        } catch {
            setStatus(toUnexpectedErrorStatus());
            return undefined;
        } finally {
            setBusyAction(undefined);
        }
    }

    return {
        applyPlan,
        controlRun,
        createRecoveryPlan,
        confirmationByPlanId,
        preflightByPlanId,
        preflightPlan,
        reviewAndPreflight,
        setConfirmationByPlanId,
    };
}

function toConfirmationInput(confirmation: DashboardBlueprintConfirmationDraft | undefined) {
    if (!confirmation) return undefined;
    return {
        ...(confirmation.understandsDeletion ? { understandsDeletion: true as const } : {}),
        ...(confirmation.understandsRestorePointRequirement
            ? { understandsRestorePointRequirement: true as const }
            : {}),
        ...(confirmation.targetGuildName ? { targetGuildName: confirmation.targetGuildName } : {}),
    };
}

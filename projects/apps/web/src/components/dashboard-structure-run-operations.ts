import { useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';

import {
    applyDashboardStructureImportRunRouteData,
    approveDashboardStructurePlanRouteData,
    controlDashboardStructureImportExecutionRouteData,
    createDashboardStructureRecoveryPlanRouteData,
    preflightDashboardStructureImportRunRouteData,
} from '../server/dashboard-structure-route-data.js';
import type { DashboardStructureImportRun } from '../server/dashboard-structure-model.js';
import type { StructureBusyAction } from './dashboard-structure-import-history.js';
import { formatStatus } from './dashboard-structure-panel-format.js';
import {
    toApplyErrorStatus,
    toErrorStatus,
    toRunActionStatus,
    toUnexpectedErrorStatus,
} from './dashboard-structure-panel-status.js';
import type { DashboardStructurePreflightView, PanelStatus } from './dashboard-structure-panel-types.js';

export function useDashboardStructureRunOperations({
    guildId,
    refreshAuditEvents,
    refreshRuns,
    seedRunActions,
    setBusyAction,
    setStatus,
}: {
    guildId: string;
    refreshAuditEvents: () => Promise<void>;
    refreshRuns: () => Promise<void>;
    seedRunActions: (run: DashboardStructureImportRun) => void;
    setBusyAction: Dispatch<SetStateAction<StructureBusyAction | undefined>>;
    setStatus: Dispatch<SetStateAction<PanelStatus | undefined>>;
}) {
    const [deleteConfirmationByRunId, setDeleteConfirmationByRunId] = useState<Record<string, string>>({});
    const [preflightByRunId, setPreflightByRunId] = useState<Record<string, DashboardStructurePreflightView>>({});
    const [preflightDigestByRunId, setPreflightDigestByRunId] = useState<Partial<Record<string, string>>>({});

    async function approvePlan(run: DashboardStructureImportRun): Promise<DashboardStructureImportRun | undefined> {
        setStatus(undefined);
        setBusyAction(`approval:${run.id}`);

        try {
            const result = await approveDashboardStructurePlanRouteData({
                data: { guildId, importRunId: run.id, planDigest: run.planDigest },
            });
            if (result.type !== 'approved') {
                setStatus(toRunActionStatus(result));
                return undefined;
            }

            seedRunActions(result.importRun);
            setStatus({ tone: 'success', message: 'Reviewed plan approved. No server changes were applied.' });
            await refreshRuns();
            await refreshAuditEvents();
            return result.importRun;
        } catch {
            setStatus(toUnexpectedErrorStatus());
        } finally {
            setBusyAction(undefined);
        }
    }

    async function preflightImportRun(run: DashboardStructureImportRun): Promise<void> {
        setStatus(undefined);
        setBusyAction(`preflight:${run.id}`);

        try {
            const result = await preflightDashboardStructureImportRunRouteData({
                data: { guildId, importRunId: run.id },
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

            setPreflightByRunId((current) => ({
                ...current,
                [run.id]: {
                    ...result.report,
                    ...(result.checkedAt ? { checkedAt: result.checkedAt } : {}),
                    ...(result.expiresAt ? { expiresAt: result.expiresAt } : {}),
                },
            }));
            if (result.preflightDigest) {
                setPreflightDigestByRunId((current) => ({ ...current, [run.id]: result.preflightDigest! }));
            }
            setStatus({
                tone: 'neutral',
                message: `Preflight checked ${result.report.summary.total} planned changes. No server changes were applied.`,
            });
            await refreshAuditEvents();
        } catch {
            setStatus(toUnexpectedErrorStatus());
        } finally {
            setBusyAction(undefined);
        }
    }

    async function reviewAndPreflight(run: DashboardStructureImportRun): Promise<void> {
        const approvedRun = await approvePlan(run);
        if (approvedRun) await preflightImportRun(approvedRun);
    }

    async function applyImportRun(run: DashboardStructureImportRun): Promise<void> {
        setStatus(undefined);
        setBusyAction(`apply:${run.id}`);

        try {
            const result = await applyDashboardStructureImportRunRouteData({
                data: {
                    guildId,
                    importRunId: run.id,
                    planDigest: run.planDigest,
                    preflightDigest: preflightDigestByRunId[run.id] ?? run.preflight?.digest ?? '',
                    destructiveConfirmationText: deleteConfirmationByRunId[run.id],
                },
            });
            if (result.type !== 'queued') {
                setStatus(toApplyErrorStatus(result));
                return;
            }

            setDeleteConfirmationByRunId((current) => ({ ...current, [run.id]: '' }));
            setStatus({
                tone: 'success',
                message: 'Deployment queued. Progress will update while the bot applies and verifies the plan.',
            });
            await refreshRuns();
            await refreshAuditEvents();
        } catch {
            setStatus(toUnexpectedErrorStatus());
        } finally {
            setBusyAction(undefined);
        }
    }

    async function controlExecution(
        run: DashboardStructureImportRun,
        request: 'pause' | 'resume' | 'cancel'
    ): Promise<void> {
        if (!run.execution) return;
        setStatus(undefined);
        setBusyAction(`control:${run.id}`);

        try {
            const result = await controlDashboardStructureImportExecutionRouteData({
                data: { guildId, runId: run.id, executionId: run.execution.id, request },
            });
            if (result.type !== 'execution-updated') {
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

    async function createRecoveryPlan(
        run: DashboardStructureImportRun
    ): Promise<DashboardStructureImportRun | undefined> {
        setStatus(undefined);
        setBusyAction(`recovery:${run.id}`);

        try {
            const result = await createDashboardStructureRecoveryPlanRouteData({
                data: { guildId, importRunId: run.id },
            });
            if (result.type !== 'recovery-plan-created') {
                setStatus(
                    result.type === 'invalid-input'
                        ? { tone: 'error', message: result.message }
                        : result.type === 'not-recoverable'
                          ? {
                                tone: 'error',
                                message: `This run is ${formatStatus(result.status)} and cannot be retried.`,
                            }
                          : toErrorStatus(result.type)
                );
                return undefined;
            }

            seedRunActions(result.importRun);
            setStatus({
                tone: 'success',
                message: `Recovery plan created with ${result.importRun.actionCount} live change${result.importRun.actionCount === 1 ? '' : 's'}.`,
            });
            await refreshRuns();
            return result.importRun;
        } catch {
            setStatus(toUnexpectedErrorStatus());
            return undefined;
        } finally {
            setBusyAction(undefined);
        }
    }

    return {
        applyImportRun,
        controlExecution,
        createRecoveryPlan,
        deleteConfirmationByRunId,
        preflightByRunId,
        preflightImportRun,
        reviewAndPreflight,
        setDeleteConfirmationByRunId,
    };
}

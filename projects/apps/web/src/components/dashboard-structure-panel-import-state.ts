import { useState } from 'react';
import {
    FLUXER_GUILD_STRUCTURE_SNAPSHOT_LIMITS,
    isFluxerGuildStructureSnapshotJsonWithinByteLimit,
} from '@neonflux/fluxer/guild-structure-snapshot';

import {
    applyDashboardStructureImportRunRouteData,
    approveDashboardStructurePlanRouteData,
    controlDashboardStructureImportExecutionRouteData,
    createDashboardStructurePlanRouteData,
    importDashboardStructureBackupRouteData,
    preflightDashboardStructureImportRunRouteData,
    readDashboardStructureImportActionPageRouteData,
    readDashboardStructureImportDecisionPageRouteData,
    createDashboardStructureRecoveryPlanRouteData,
} from '../server/dashboard-structure-route-data.js';
import type {
    DashboardStructureImportRun,
    DashboardStructureRoleMappingConflict,
} from '../server/dashboard-structure.server.js';
import type { StructureBusyAction } from './dashboard-structure-import-history.js';
import { formatStatus } from './dashboard-structure-panel-format.js';
import {
    toApplyErrorStatus,
    toErrorStatus,
    toRunActionStatus,
    toUnexpectedErrorStatus,
} from './dashboard-structure-panel-status.js';
import type {
    ActionPageState,
    DashboardStructurePreflightView,
    PanelStatus,
} from './dashboard-structure-panel-types.js';
import type { DashboardStructurePolicy } from '../server/dashboard-structure-contracts.js';

export function useDashboardStructureImportState({
    guildId,
    policy,
    importJson,
    refreshAuditEvents,
    refreshSettings,
    setBusyAction,
    setStatus,
}: {
    guildId: string;
    policy: DashboardStructurePolicy;
    importJson: string;
    refreshAuditEvents: () => Promise<void>;
    refreshSettings: (options?: { resetBackups?: boolean }) => Promise<void>;
    setBusyAction: (action: StructureBusyAction | undefined) => void;
    setStatus: (status: PanelStatus | undefined) => void;
}) {
    const [actionPagesByRunId, setActionPagesByRunId] = useState<Partial<Record<string, ActionPageState>>>({});
    const [decisionPagesByRunId, setDecisionPagesByRunId] = useState<
        Partial<Record<string, { decisions: DashboardStructureImportRun['decisions']; nextCursor?: number }>>
    >({});
    const [deleteConfirmationByRunId, setDeleteConfirmationByRunId] = useState<Record<string, string>>({});
    const [preflightByRunId, setPreflightByRunId] = useState<Record<string, DashboardStructurePreflightView>>({});
    const [preflightDigestByRunId, setPreflightDigestByRunId] = useState<Partial<Record<string, string>>>({});
    const [roleMappingConflicts, setRoleMappingConflicts] = useState<DashboardStructureRoleMappingConflict[]>([]);
    const [roleMappings, setRoleMappings] = useState<Record<string, string>>({});

    function clearRoleMappings(): void {
        setRoleMappingConflicts([]);
        setRoleMappings({});
    }

    async function createDryRunFromBackupId({
        backupId,
        intent = 'backup',
    }: {
        backupId: string;
        intent?: 'backup' | 'restore';
    }): Promise<boolean> {
        setStatus(undefined);
        setBusyAction(`backup-import:${backupId}`);

        try {
            const result = await importDashboardStructureBackupRouteData({ data: { backupId, guildId } });

            if (result.type !== 'backup-import-created') {
                setStatus(
                    result.type === 'invalid-input'
                        ? { tone: 'error', message: result.message }
                        : result.type === 'backup-json-unavailable'
                          ? { tone: 'error', message: 'This backup does not have server blueprint JSON.' }
                          : toErrorStatus(result.type)
                );
                return false;
            }

            setActionPagesByRunId((current) => ({
                ...current,
                [result.importRun.id]: { actions: result.importRun.actions },
            }));
            setStatus({
                tone: 'success',
                message:
                    intent === 'restore'
                        ? `Restore plan created with ${result.importRun.actionCount} planned changes. Review it before queueing.`
                        : `Deployment plan created from backup with ${result.importRun.actionCount} planned changes.`,
            });
            await refreshSettings();
            await refreshAuditEvents();
            return true;
        } catch {
            setStatus(toUnexpectedErrorStatus());
            return false;
        } finally {
            setBusyAction(undefined);
        }
    }

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

            setActionPagesByRunId((current) => ({
                ...current,
                [result.importRun.id]: { actions: result.importRun.actions },
            }));
            setStatus({ tone: 'success', message: 'Reviewed plan approved. No server changes were applied.' });
            await refreshSettings();
            await refreshAuditEvents();
            return result.importRun;
        } catch {
            setStatus(toUnexpectedErrorStatus());
        } finally {
            setBusyAction(undefined);
        }
    }

    async function reviewAndPreflight(run: DashboardStructureImportRun): Promise<void> {
        const approvedRun = await approvePlan(run);
        if (!approvedRun) return;

        await preflightImportRun(approvedRun);
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
            await refreshSettings();
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
            await refreshSettings();
        } catch {
            setStatus(toUnexpectedErrorStatus());
        } finally {
            setBusyAction(undefined);
        }
    }

    async function loadRunDecisions(run: DashboardStructureImportRun): Promise<void> {
        setBusyAction(`decisions:${run.id}`);
        try {
            const current = decisionPagesByRunId[run.id];
            const result = await readDashboardStructureImportDecisionPageRouteData({
                data: {
                    guildId,
                    importRunId: run.id,
                    ...(current?.nextCursor !== undefined ? { cursor: current.nextCursor } : {}),
                    limit: 50,
                },
            });
            if (result.type !== 'decision-page') {
                setStatus(toErrorStatus(result.type));
                return;
            }
            setDecisionPagesByRunId((pages) => ({
                ...pages,
                [run.id]: {
                    decisions: [...(pages[run.id]?.decisions ?? []), ...result.decisions],
                    ...(result.nextCursor !== undefined ? { nextCursor: result.nextCursor } : {}),
                },
            }));
        } catch {
            setStatus(toUnexpectedErrorStatus());
        } finally {
            setBusyAction(undefined);
        }
    }

    async function createPlan(): Promise<void> {
        setStatus(undefined);

        if (!isFluxerGuildStructureSnapshotJsonWithinByteLimit(importJson)) {
            setStatus({
                tone: 'error',
                message: `Blueprint JSON must be ${String(FLUXER_GUILD_STRUCTURE_SNAPSHOT_LIMITS.maxJsonBytes / 1024 / 1024)} MiB or smaller.`,
            });
            return;
        }

        setBusyAction('plan');

        try {
            const mappingsByType = Object.fromEntries(
                (['role', 'category', 'channel'] as const).map((targetType) => [
                    targetType,
                    Object.fromEntries(
                        Object.entries(roleMappings).filter(([sourceId]) =>
                            roleMappingConflicts.some(
                                (conflict) =>
                                    conflict.targetType === targetType && conflict.sourceIds.includes(sourceId)
                            )
                        )
                    ),
                ])
            ) as Record<'role' | 'category' | 'channel', Record<string, string>>;
            const result = await createDashboardStructurePlanRouteData({
                data: {
                    guildId,
                    backupJson: importJson,
                    policy,
                    ...(Object.keys(mappingsByType.role).length > 0 ? { roleMappings: mappingsByType.role } : {}),
                    ...(Object.keys(mappingsByType.category).length > 0
                        ? { categoryMappings: mappingsByType.category }
                        : {}),
                    ...(Object.keys(mappingsByType.channel).length > 0
                        ? { channelMappings: mappingsByType.channel }
                        : {}),
                },
            });

            if (result.type !== 'plan-created') {
                if (result.type === 'mapping-required') {
                    setRoleMappingConflicts(result.conflicts);
                    setRoleMappings((current) => {
                        const acceptedMappings = result.conflicts.flatMap((conflict) =>
                            conflict.sourceIds.flatMap((sourceId) => {
                                const targetId = current[sourceId];
                                return targetId && conflict.candidateTargetIds.includes(targetId)
                                    ? ([[sourceId, targetId]] as const)
                                    : [];
                            })
                        );

                        return Object.fromEntries(acceptedMappings);
                    });
                    setStatus({
                        tone: 'neutral',
                        message:
                            'Choose which existing role matches each ambiguous source role, then create the plan again.',
                    });
                    return;
                }
                setStatus(
                    result.type === 'invalid-input'
                        ? { tone: 'error', message: result.message }
                        : toErrorStatus(result.type)
                );
                return;
            }

            setRoleMappingConflicts([]);
            setRoleMappings({});
            setActionPagesByRunId((current) => ({
                ...current,
                [result.importRun.id]: { actions: result.importRun.actions },
            }));
            setStatus({
                tone: 'success',
                message: `${formatPolicyLabel(policy)} plan created with ${result.importRun.actionCount} changes across ${result.importRun.executionActionCount} execution steps. Review the complete scope before approval.`,
            });
            await refreshSettings();
            await refreshAuditEvents();
        } catch {
            setStatus(toUnexpectedErrorStatus());
        } finally {
            setBusyAction(undefined);
        }
    }

    async function loadRunActions(run: DashboardStructureImportRun): Promise<void> {
        setBusyAction(`actions:${run.id}`);

        try {
            const currentPage: ActionPageState | undefined = actionPagesByRunId[run.id];
            const result = await readDashboardStructureImportActionPageRouteData({
                data: {
                    guildId,
                    importRunId: run.id,
                    ...(currentPage?.nextCursor ? { cursor: currentPage.nextCursor } : {}),
                    limit: 100,
                },
            });

            if (result.type !== 'action-page') {
                setStatus(
                    result.type === 'invalid-input'
                        ? { tone: 'error', message: result.message }
                        : toErrorStatus(result.type)
                );
                return;
            }

            setActionPagesByRunId((current) => {
                const existingPage: ActionPageState | undefined = current[run.id];

                return {
                    ...current,
                    [run.id]: {
                        actions: [...(existingPage?.actions ?? []), ...result.page.actions],
                        ...(result.page.nextCursor ? { nextCursor: result.page.nextCursor } : {}),
                    },
                };
            });
        } catch {
            setStatus(toUnexpectedErrorStatus());
        } finally {
            setBusyAction(undefined);
        }
    }

    async function createRecoveryPlan(run: DashboardStructureImportRun): Promise<void> {
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
                return;
            }

            setActionPagesByRunId((current) => ({
                ...current,
                [result.importRun.id]: { actions: result.importRun.actions },
            }));
            setStatus({
                tone: 'success',
                message: `Recovery plan created with ${result.importRun.actionCount} live change${
                    result.importRun.actionCount === 1 ? '' : 's'
                }.`,
            });
            await refreshSettings();
        } catch {
            setStatus(toUnexpectedErrorStatus());
        } finally {
            setBusyAction(undefined);
        }
    }

    return {
        actionPagesByRunId,
        applyImportRun,
        clearRoleMappings,
        controlExecution,
        approvePlan,
        createPlan,
        createDryRunFromBackupId,
        deleteConfirmationByRunId,
        decisionPagesByRunId,
        loadRunActions,
        loadRunDecisions,
        preflightByRunId,
        preflightImportRun,
        roleMappingConflicts,
        roleMappings,
        createRecoveryPlan,
        reviewAndPreflight,
        setDeleteConfirmationByRunId,
        setRoleMappings,
    };
}

function formatPolicyLabel(policy: DashboardStructurePolicy): string {
    if (policy === 'synchronize') return 'Match blueprint';
    if (policy === 'rebuild') return 'Reset and rebuild';
    return 'Merge without deletions';
}

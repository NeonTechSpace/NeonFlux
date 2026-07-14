import { useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import {
    FLUXER_GUILD_STRUCTURE_SNAPSHOT_LIMITS,
    isFluxerGuildStructureSnapshotJsonWithinByteLimit,
} from '@neonflux/fluxer/guild-structure-snapshot';

import { createDashboardStructurePlanRouteData } from '../server/dashboard-structure-route-data.js';
import type {
    DashboardStructureImportRun,
    DashboardStructureRoleMappingConflict,
} from '../server/dashboard-structure-model.js';
import type { DashboardStructurePolicy } from '../server/dashboard-structure-contracts.js';
import type { StructureBusyAction } from './dashboard-structure-import-history.js';
import { toErrorStatus, toUnexpectedErrorStatus } from './dashboard-structure-panel-status.js';
import type { PanelStatus } from './dashboard-structure-panel-types.js';

export function useDashboardStructureDeployDraftState({
    guildId,
    importJson,
    policy,
    refreshAuditEvents,
    refreshRuns,
    seedRunActions,
    setBusyAction,
    setStatus,
}: {
    guildId: string;
    importJson: string;
    policy: DashboardStructurePolicy;
    refreshAuditEvents: () => Promise<void>;
    refreshRuns: () => Promise<void>;
    seedRunActions: (run: DashboardStructureImportRun) => void;
    setBusyAction: Dispatch<SetStateAction<StructureBusyAction | undefined>>;
    setStatus: Dispatch<SetStateAction<PanelStatus | undefined>>;
}) {
    const [roleMappingConflicts, setRoleMappingConflicts] = useState<DashboardStructureRoleMappingConflict[]>([]);
    const [roleMappings, setRoleMappings] = useState<Record<string, string>>({});

    function clearRoleMappings(): void {
        setRoleMappingConflicts([]);
        setRoleMappings({});
    }

    async function createPlan(): Promise<DashboardStructureImportRun | undefined> {
        setStatus(undefined);
        if (!isFluxerGuildStructureSnapshotJsonWithinByteLimit(importJson)) {
            setStatus({
                tone: 'error',
                message: `Blueprint JSON must be ${String(FLUXER_GUILD_STRUCTURE_SNAPSHOT_LIMITS.maxJsonBytes / 1024 / 1024)} MiB or smaller.`,
            });
            return undefined;
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
                    setRoleMappings((current) =>
                        Object.fromEntries(
                            result.conflicts.flatMap((conflict) =>
                                conflict.sourceIds.flatMap((sourceId) => {
                                    const targetId = current[sourceId];
                                    return targetId && conflict.candidateTargetIds.includes(targetId)
                                        ? ([[sourceId, targetId]] as const)
                                        : [];
                                })
                            )
                        )
                    );
                    setStatus({
                        tone: 'neutral',
                        message:
                            'Choose which existing role matches each ambiguous source role, then create the plan again.',
                    });
                    return undefined;
                }
                setStatus(
                    result.type === 'invalid-input'
                        ? { tone: 'error', message: result.message }
                        : toErrorStatus(result.type)
                );
                return undefined;
            }

            clearRoleMappings();
            seedRunActions(result.importRun);
            setStatus({
                tone: 'success',
                message: `${formatPolicyLabel(policy)} plan created with ${result.importRun.actionCount} changes across ${result.importRun.executionActionCount} execution steps. Review the complete scope before approval.`,
            });
            await refreshRuns();
            await refreshAuditEvents();
            return result.importRun;
        } catch {
            setStatus(toUnexpectedErrorStatus());
            return undefined;
        } finally {
            setBusyAction(undefined);
        }
    }

    return { clearRoleMappings, createPlan, roleMappingConflicts, roleMappings, setRoleMappings };
}

function formatPolicyLabel(policy: DashboardStructurePolicy): string {
    if (policy === 'synchronize') return 'Match blueprint';
    if (policy === 'rebuild') return 'Reset and rebuild';
    return 'Merge without deletions';
}

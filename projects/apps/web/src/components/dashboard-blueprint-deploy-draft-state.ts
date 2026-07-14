import { useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { BLUEPRINT_SNAPSHOT_LIMITS, isBlueprintSnapshotJsonWithinByteLimit } from '@neonflux/blueprint/snapshot';

import { createDashboardBlueprintPlanRouteData } from '../server/dashboard-blueprint-route-data.js';
import type {
    DashboardBlueprintPlan,
    DashboardBlueprintRoleMappingConflict,
} from '../server/dashboard-blueprint-model.js';
import type { DashboardBlueprintPolicy } from '../server/dashboard-blueprint-contracts.js';
import type { BlueprintBusyAction } from './dashboard-blueprint-history.js';
import { toErrorStatus, toUnexpectedErrorStatus } from './dashboard-blueprint-panel-status.js';
import type { PanelStatus } from './dashboard-blueprint-panel-types.js';

export function useDashboardBlueprintDeployDraftState({
    guildId,
    importJson,
    policy,
    refreshAuditEvents,
    refreshRuns,
    seedPlanSteps,
    setBusyAction,
    setStatus,
}: {
    guildId: string;
    importJson: string;
    policy: DashboardBlueprintPolicy;
    refreshAuditEvents: () => Promise<void>;
    refreshRuns: () => Promise<void>;
    seedPlanSteps: (plan: DashboardBlueprintPlan) => void;
    setBusyAction: Dispatch<SetStateAction<BlueprintBusyAction | undefined>>;
    setStatus: Dispatch<SetStateAction<PanelStatus | undefined>>;
}) {
    const [roleMappingConflicts, setRoleMappingConflicts] = useState<DashboardBlueprintRoleMappingConflict[]>([]);
    const [roleMappings, setRoleMappings] = useState<Record<string, string>>({});

    function clearRoleMappings(): void {
        setRoleMappingConflicts([]);
        setRoleMappings({});
    }

    async function createPlan(): Promise<DashboardBlueprintPlan | undefined> {
        setStatus(undefined);
        if (!isBlueprintSnapshotJsonWithinByteLimit(importJson)) {
            setStatus({
                tone: 'error',
                message: `Blueprint JSON must be ${String(BLUEPRINT_SNAPSHOT_LIMITS.maxJsonBytes / 1024 / 1024)} MiB or smaller.`,
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
            const result = await createDashboardBlueprintPlanRouteData({
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
            seedPlanSteps(result.plan);
            setStatus({
                tone: 'success',
                message: `${formatPolicyLabel(policy)} plan created with ${result.plan.changeCount} changes across ${result.plan.planStepCount} plan steps. Review the complete scope before approval.`,
            });
            await refreshRuns();
            await refreshAuditEvents();
            return result.plan;
        } catch {
            setStatus(toUnexpectedErrorStatus());
            return undefined;
        } finally {
            setBusyAction(undefined);
        }
    }

    return { clearRoleMappings, createPlan, roleMappingConflicts, roleMappings, setRoleMappings };
}

function formatPolicyLabel(policy: DashboardBlueprintPolicy): string {
    if (policy === 'synchronize') return 'Match blueprint';
    if (policy === 'rebuild') return 'Reset and rebuild';
    return 'Merge without deletions';
}

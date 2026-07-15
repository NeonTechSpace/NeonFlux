import type {
    BlueprintPlanDecision,
    BlueprintPlanDecisionSummary,
    BlueprintPlanStep,
    BlueprintPlanSummary,
} from './plan.js';

export const blueprintPlanDecisionSummaryFields = [
    'noOp',
    'create',
    'update',
    'delete',
    'protectedRetained',
    'protectedOmitted',
    'unmanagedRetained',
    'blockedAmbiguous',
    'blockedUnsupported',
] as const satisfies ReadonlyArray<keyof BlueprintPlanDecisionSummary>;

export function summarizeBlueprintPlanChanges(changes: readonly BlueprintPlanStep[]): BlueprintPlanSummary {
    return {
        creates: changes.filter((change) => change.actionType === 'create').length,
        updates: changes.filter((change) => change.actionType === 'update').length,
        deletes: changes.filter((change) => change.actionType === 'delete').length,
        roles: changes.filter((change) => change.targetType === 'role' || change.targetType === 'role-order').length,
        categories: changes.filter((change) => change.targetType === 'category').length,
        channels: changes.filter((change) => change.targetType === 'channel' || change.targetType === 'channel-order')
            .length,
    };
}

export function summarizeBlueprintPlanDecisions(
    decisions: readonly BlueprintPlanDecision[]
): BlueprintPlanDecisionSummary {
    const summary: BlueprintPlanDecisionSummary = {
        noOp: 0,
        create: 0,
        update: 0,
        delete: 0,
        protectedRetained: 0,
        protectedOmitted: 0,
        unmanagedRetained: 0,
        blockedAmbiguous: 0,
        blockedUnsupported: 0,
    };
    const fieldByClassification = {
        'no-op': 'noOp',
        create: 'create',
        update: 'update',
        delete: 'delete',
        'protected-retained': 'protectedRetained',
        'protected-omitted': 'protectedOmitted',
        'unmanaged-retained': 'unmanagedRetained',
        'blocked-ambiguous': 'blockedAmbiguous',
        'blocked-unsupported': 'blockedUnsupported',
    } as const satisfies Record<BlueprintPlanDecision['classification'], keyof BlueprintPlanDecisionSummary>;
    for (const decision of decisions) summary[fieldByClassification[decision.classification]] += 1;
    return summary;
}

export function countBlueprintPlanDecisions(summary: BlueprintPlanDecisionSummary): number {
    return blueprintPlanDecisionSummaryFields.reduce((total, field) => total + summary[field], 0);
}

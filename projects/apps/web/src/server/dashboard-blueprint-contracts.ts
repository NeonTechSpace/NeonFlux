import type { BlueprintRunPhase } from '@neonflux/db';

import type { DashboardBlueprintPlan } from './dashboard-blueprint-diff.js';

const dashboardBlueprintPolicies = ['synchronize', 'merge', 'rebuild'] as const;

export type DashboardBlueprintPolicy = DashboardBlueprintPlan['policy'];

type DashboardBlueprintDecisionClassification =
    | 'no-op'
    | 'create'
    | 'update'
    | 'delete'
    | 'protected-retained'
    | 'protected-omitted'
    | 'unmanaged-retained'
    | 'blocked-ambiguous'
    | 'blocked-unsupported';

export type DashboardBlueprintDecisionSummary = Record<DashboardBlueprintDecisionClassification, number>;

export type DashboardBlueprintPlanDecision = {
    logicalId: string;
    targetType: 'role' | 'category' | 'channel';
    name: string;
    classification: DashboardBlueprintDecisionClassification;
    sourceId?: string;
    targetId?: string;
    fields: string[];
    reason?: string;
};

export type DashboardBlueprintPlanPreflight = {
    checkedAt: string;
    expiresAt: string;
    digest: string;
    status: 'ready' | 'blocked' | 'stale';
    blockerCount: number;
};

type DashboardBlueprintRunStatus =
    | 'queued'
    | 'running'
    | 'waiting_rate_limit'
    | 'pause_requested'
    | 'paused'
    | 'verifying'
    | 'succeeded'
    | 'partially_applied'
    | 'failed_before_mutation'
    | 'needs_reconciliation'
    | 'outcome_unknown'
    | 'cancelled';

export type DashboardBlueprintRunProgress = {
    id: string;
    protocolVersion: number;
    status: DashboardBlueprintRunStatus;
    phase: BlueprintRunPhase;
    completedSteps: number;
    failedSteps: number;
    totalSteps: number;
    currentStepLabel?: string;
    retryAt?: string;
    errorType?: string;
    restorePointBackupId?: string;
    createdAt: string;
    startedAt?: string;
    updatedAt: string;
    completedAt?: string;
};

export const dashboardBlueprintRunPhases = [
    'queued',
    'preparing',
    'create',
    'update',
    'delete',
    'channel_order',
    'role_order',
    'waiting_rate_limit',
    'paused',
    'verifying',
    'complete',
] as const satisfies ReadonlyArray<BlueprintRunPhase>;

export function formatDashboardBlueprintRunPhase(phase: DashboardBlueprintRunProgress['phase']): string {
    switch (phase) {
        case 'queued':
            return 'Queued';
        case 'preparing':
            return 'Preparing restore point and mappings';
        case 'create':
            return 'Creating roles and channels';
        case 'update':
            return 'Updating roles and channels';
        case 'delete':
            return 'Deleting eligible roles and channels';
        case 'channel_order':
            return 'Applying channel order';
        case 'role_order':
            return 'Applying role order';
        case 'waiting_rate_limit':
            return 'Waiting for Fluxer rate limit';
        case 'paused':
            return 'Paused';
        case 'verifying':
            return 'Verifying final layout';
        case 'complete':
            return 'Complete';
    }
}

export function formatDashboardBlueprintRunState(run: DashboardBlueprintRunProgress): string {
    if (run.status === 'pause_requested') {
        return 'Pause requested; finishing the current Fluxer request';
    }

    return formatDashboardBlueprintRunPhase(run.phase);
}

export function createEmptyDecisionSummary(): DashboardBlueprintDecisionSummary {
    return {
        'no-op': 0,
        create: 0,
        update: 0,
        delete: 0,
        'protected-retained': 0,
        'protected-omitted': 0,
        'unmanaged-retained': 0,
        'blocked-ambiguous': 0,
        'blocked-unsupported': 0,
    };
}

export function isDashboardBlueprintPolicy(value: unknown): value is DashboardBlueprintPolicy {
    return dashboardBlueprintPolicies.includes(value as DashboardBlueprintPolicy);
}

export function getDashboardBlueprintDeleteApprovalText(
    planId: string,
    deleteStepCount: number,
    deleteSetDigest: string
): string {
    return `DELETE ${planId} ${deleteStepCount} ${deleteSetDigest.slice(0, 12)}`;
}

import type { StructureImportExecutionPhase } from '@neonflux/db';

import type { DashboardStructurePlan } from './dashboard-structure-diff.js';

const dashboardStructurePolicies = ['synchronize', 'merge', 'rebuild'] as const;

export type DashboardStructurePolicy = DashboardStructurePlan['policy'];

type DashboardStructureDecisionClassification =
    | 'no-op'
    | 'create'
    | 'update'
    | 'delete'
    | 'protected-retained'
    | 'protected-omitted'
    | 'unmanaged-retained'
    | 'blocked-ambiguous'
    | 'blocked-unsupported';

export type DashboardStructureDecisionSummary = Record<DashboardStructureDecisionClassification, number>;

export type DashboardStructureReviewDecision = {
    logicalId: string;
    targetType: 'role' | 'category' | 'channel';
    name: string;
    classification: DashboardStructureDecisionClassification;
    sourceId?: string;
    targetId?: string;
    fields: string[];
    reason?: string;
};

export type DashboardStructurePersistedPreflight = {
    checkedAt: string;
    digest: string;
    status: 'ready' | 'blocked' | 'stale';
    blockerCount: number;
};

type DashboardStructureExecutionStatus =
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

export type DashboardStructureExecutionProgress = {
    id: string;
    protocolVersion: number;
    status: DashboardStructureExecutionStatus;
    phase: StructureImportExecutionPhase;
    completedActions: number;
    failedActions: number;
    totalActions: number;
    currentActionLabel?: string;
    retryAt?: string;
    errorType?: string;
    restorePointBackupId?: string;
    createdAt: string;
    startedAt?: string;
    updatedAt: string;
    completedAt?: string;
};

export const dashboardStructureExecutionPhases = [
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
] as const satisfies ReadonlyArray<StructureImportExecutionPhase>;

export function formatDashboardStructureExecutionPhase(phase: DashboardStructureExecutionProgress['phase']): string {
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

export function createEmptyDecisionSummary(): DashboardStructureDecisionSummary {
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

export function isDashboardStructurePolicy(value: unknown): value is DashboardStructurePolicy {
    return dashboardStructurePolicies.includes(value as DashboardStructurePolicy);
}

export function getDashboardStructureDeleteApprovalText(
    runId: string,
    deleteActionCount: number,
    deleteSetDigest: string
): string {
    return `DELETE ${runId} ${deleteActionCount} ${deleteSetDigest.slice(0, 12)}`;
}

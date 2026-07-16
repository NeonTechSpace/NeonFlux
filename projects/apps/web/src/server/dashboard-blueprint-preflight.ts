import { isBlueprintPreflightReportReady } from '@neonflux/blueprint';
import type { BlueprintPreflightReport, BlueprintPreflightStepStatus } from '@neonflux/blueprint';

import type { DashboardBlueprintPolicy } from './dashboard-blueprint-contracts.js';
import type { DashboardBlueprintSnapshot } from './dashboard-blueprint-diff.js';
import { preflightCreateAction } from './dashboard-blueprint-preflight-create.js';
import {
    isCanonicalReferenceId,
    normalizeTargetType,
    toPreflightPlanStep,
} from './dashboard-blueprint-preflight-internal.js';
import type {
    DashboardBlueprintPreflightContext,
    DashboardBlueprintPreflightInputPlanStep,
    DashboardBlueprintPreflightPlanStep,
} from './dashboard-blueprint-preflight-internal.js';
import { preflightDeleteAction, preflightUpdateAction } from './dashboard-blueprint-preflight-mutations.js';
import { preflightChannelOrderAction, preflightRoleOrderAction } from './dashboard-blueprint-preflight-order.js';

export type { DashboardBlueprintPreflightInputPlanStep } from './dashboard-blueprint-preflight-internal.js';

export type DashboardBlueprintPreflightReport = BlueprintPreflightReport;

export function countDashboardBlueprintPreflightHardBlockers(report: DashboardBlueprintPreflightReport): number {
    return (
        report.summary.stale + report.summary.mappingRequired + report.summary.unsupported + report.summary.invalidPlan
    );
}

export function isDashboardBlueprintPreflightReady(report: DashboardBlueprintPreflightReport): boolean {
    return isBlueprintPreflightReportReady(report);
}

export function prependDashboardBlueprintProjectionBlocker(
    report: DashboardBlueprintPreflightReport,
    message: string
): DashboardBlueprintPreflightReport {
    return {
        summary: {
            ...report.summary,
            total: report.summary.total + 1,
            stale: report.summary.stale + 1,
        },
        steps: [
            {
                planStepId: 'role-projection',
                actionType: 'verify',
                targetType: 'role-projection',
                label: 'Projected role layout',
                status: 'stale',
                message,
            },
            ...report.steps,
        ],
    };
}

export type DashboardBlueprintPreflightOptions = {
    allowDestructiveDeletes?: boolean;
    idMap?: Record<string, string>;
    knownTargetIds?: readonly string[];
    policy: DashboardBlueprintPolicy;
    sourceIds?: readonly string[];
    sourceGuildId?: string;
};

export function preflightDashboardBlueprintPlan(
    current: DashboardBlueprintSnapshot,
    actions: DashboardBlueprintPreflightInputPlanStep[],
    options: DashboardBlueprintPreflightOptions = { policy: 'synchronize' }
): DashboardBlueprintPreflightReport {
    const context = createPreflightContext(options);
    const preflightSteps = actions.map((action) => preflightStep(current, action, actions, context));

    return {
        summary: {
            total: preflightSteps.length,
            ready: countStatus(preflightSteps, 'ready'),
            stale: countStatus(preflightSteps, 'stale'),
            mappingRequired: countStatus(preflightSteps, 'mapping-required'),
            destructiveApprovalRequired: countStatus(preflightSteps, 'destructive-approval-required'),
            unsupported: countStatus(preflightSteps, 'unsupported'),
            invalidPlan: countStatus(preflightSteps, 'invalid-plan'),
        },
        steps: preflightSteps,
    };
}

function createPreflightContext(options: DashboardBlueprintPreflightOptions): DashboardBlueprintPreflightContext {
    const idMap = options.idMap ?? {};

    return {
        ...(options.allowDestructiveDeletes === undefined
            ? {}
            : { allowDestructiveDeletes: options.allowDestructiveDeletes }),
        idMap,
        knownTargetIds: new Set(options.knownTargetIds ?? []),
        policy: options.policy,
        ...(options.sourceGuildId ? { sourceGuildId: options.sourceGuildId } : {}),
        sourceIds: new Set([...(options.sourceIds ?? []), ...Object.keys(idMap)]),
    };
}

function preflightStep(
    current: DashboardBlueprintSnapshot,
    action: DashboardBlueprintPreflightInputPlanStep,
    actions: DashboardBlueprintPreflightInputPlanStep[],
    options: DashboardBlueprintPreflightContext
): DashboardBlueprintPreflightPlanStep {
    if (action.targetType === 'role-order') {
        return preflightRoleOrderAction(current, action, actions, options);
    }
    if (action.targetType === 'channel-order') {
        return preflightChannelOrderAction(current, action, actions, options);
    }

    const targetType = normalizeTargetType(action.targetType);

    if (!targetType || !isCanonicalReferenceId(action.targetId)) {
        return toPreflightPlanStep(action, 'invalid-plan', 'The reviewed plan step is missing a valid target.');
    }

    switch (action.actionType) {
        case 'create':
            return preflightCreateAction(current, action, targetType, actions, options);
        case 'delete':
            return preflightDeleteAction(current, action, targetType, options);
        case 'update':
            return preflightUpdateAction(current, action, targetType, actions, options);
        default:
            return toPreflightPlanStep(action, 'invalid-plan', 'The reviewed plan step type is not recognized.');
    }
}

function countStatus(actions: DashboardBlueprintPreflightPlanStep[], status: BlueprintPreflightStepStatus): number {
    return actions.filter((action) => action.status === status).length;
}

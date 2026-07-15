import { normalizeBlueprintSnapshot } from '@neonflux/blueprint/snapshot';
import type { BlueprintSnapshot } from '@neonflux/blueprint/snapshot';

import type { DashboardBlueprintPlan } from '../server/dashboard-blueprint-model.js';

export type DashboardBlueprintDeployJourneyStep = 'source' | 'configure' | 'review' | 'safety' | 'confirm' | 'deploy';

export type DashboardBlueprintDeployJourney = {
    index: 1 | 2 | 3 | 4 | 5 | 6;
    step: DashboardBlueprintDeployJourneyStep;
};

export function isDashboardBlueprintSourceReady(value: string): boolean {
    return readDashboardBlueprintSourceSnapshot(value) !== undefined;
}

export function readDashboardBlueprintSourceSnapshot(value: string): BlueprintSnapshot | undefined {
    try {
        const parsed: unknown = JSON.parse(value);
        const normalized = normalizeBlueprintSnapshot(parsed);
        return normalized.type === 'valid' ? normalized.snapshot : undefined;
    } catch {
        return undefined;
    }
}

/** Durable plan and run state outrank local route and draft hints. */
export function deriveDashboardBlueprintDeployJourney({
    choosingSource,
    hasParsedSource,
    now = Date.now(),
    plan,
    preflight,
}: {
    choosingSource: boolean;
    hasParsedSource: boolean;
    now?: number;
    plan: DashboardBlueprintPlan | undefined;
    preflight: { checkedAt?: string; expiresAt?: string; status?: string } | undefined;
}): DashboardBlueprintDeployJourney {
    if (plan?.run) {
        const retryPreflightIsFresh =
            plan.run.status === 'failed_before_mutation' &&
            Boolean(preflight?.checkedAt) &&
            new Date(preflight?.checkedAt ?? '').getTime() > new Date(plan.run.updatedAt).getTime();
        if (!retryPreflightIsFresh) return { index: 6, step: 'deploy' };
        if (isReadyAndCurrent(preflight, now)) return { index: 5, step: 'confirm' };
        return { index: 4, step: 'safety' };
    }
    if (plan?.status === 'approved') {
        if (isReadyAndCurrent(preflight, now)) return { index: 5, step: 'confirm' };
        return { index: 4, step: 'safety' };
    }
    if (plan) return { index: 3, step: 'review' };
    if (hasParsedSource) return { index: 2, step: 'configure' };
    if (choosingSource) return { index: 1, step: 'source' };
    return { index: 1, step: 'source' };
}

function isReadyAndCurrent(preflight: { expiresAt?: string; status?: string } | undefined, now: number): boolean {
    if (preflight?.status !== 'ready') return false;
    if (!preflight.expiresAt) return true;
    const expiresAt = new Date(preflight.expiresAt).getTime();
    return Number.isFinite(expiresAt) && expiresAt > now;
}

export function canStartNewBlueprintDeployment(plan: DashboardBlueprintPlan | undefined): boolean {
    if (!plan?.run) return true;

    return ['succeeded', 'failed_before_mutation', 'cancelled'].includes(plan.run.status);
}

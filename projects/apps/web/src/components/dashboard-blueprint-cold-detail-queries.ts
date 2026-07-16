import { useQuery } from '@tanstack/react-query';

import {
    getDashboardBlueprintPlanAuthorityQueryKey,
    getDashboardBlueprintPreflightEvidenceQueryKey,
    getDashboardBlueprintVerificationEvidenceQueryKey,
} from '../dashboard-query-keys.js';
import {
    readDashboardBlueprintPlanAuthorityRouteData,
    readDashboardBlueprintPreflightEvidenceRouteData,
    readDashboardBlueprintVerificationEvidenceRouteData,
} from '../server/dashboard-blueprint-route-data.js';
import type { DashboardBlueprintPlan, DashboardBlueprintPlanColdDetail } from '../server/dashboard-blueprint-model.js';

export type { DashboardBlueprintPlanColdDetail } from '../server/dashboard-blueprint-model.js';

export function useDashboardBlueprintPlanAuthorityQuery(input: { enabled: boolean; guildId: string; planId?: string }) {
    const planId = input.planId ?? '';
    return useQuery({
        queryKey: getDashboardBlueprintPlanAuthorityQueryKey(input.guildId, planId),
        enabled: input.enabled && Boolean(planId),
        refetchOnMount: false,
        refetchOnReconnect: false,
        refetchOnWindowFocus: false,
        retry: 1,
        staleTime: Infinity,
        queryFn: async () => {
            const result = await readDashboardBlueprintPlanAuthorityRouteData({
                data: { guildId: input.guildId, planId },
            });
            if (result.type !== 'plan-authority') throw new Error(result.type);
            return toDashboardBlueprintPlanColdDetail(result.detail);
        },
    });
}

export function mergeDashboardBlueprintPlanColdDetail(
    plan: DashboardBlueprintPlan,
    detail: DashboardBlueprintPlanColdDetail | undefined
): DashboardBlueprintPlan {
    if (!detail || detail.id !== plan.id) return plan;
    return {
        ...plan,
        ...(detail.requestedSnapshot === undefined ? {} : { requestedSnapshot: detail.requestedSnapshot }),
        ...(detail.requestedSnapshotStoredAt === undefined
            ? {}
            : { requestedSnapshotStoredAt: detail.requestedSnapshotStoredAt }),
    };
}

function toDashboardBlueprintPlanColdDetail(
    detail: DashboardBlueprintPlanColdDetail
): DashboardBlueprintPlanColdDetail {
    return {
        id: detail.id,
        ...(detail.requestedSnapshot === undefined ? {} : { requestedSnapshot: detail.requestedSnapshot }),
        ...(detail.requestedSnapshotStoredAt === undefined
            ? {}
            : { requestedSnapshotStoredAt: detail.requestedSnapshotStoredAt }),
    };
}

export function useDashboardBlueprintPreflightEvidenceQuery(input: {
    checkedAt?: string;
    enabled: boolean;
    expiresAt?: string;
    guildId: string;
    preflightId?: string;
}) {
    const preflightId = input.preflightId ?? '';
    return useQuery({
        queryKey: getDashboardBlueprintPreflightEvidenceQueryKey(input.guildId, preflightId),
        enabled: input.enabled && Boolean(preflightId),
        refetchOnMount: false,
        refetchOnReconnect: false,
        refetchOnWindowFocus: false,
        retry: 1,
        staleTime: Infinity,
        queryFn: async () => {
            const result = await readDashboardBlueprintPreflightEvidenceRouteData({
                data: { guildId: input.guildId, preflightId },
            });
            if (result.type !== 'preflight-evidence') throw new Error(result.type);
            return result.report;
        },
        select: (report) => ({
            ...report,
            ...(input.checkedAt ? { checkedAt: input.checkedAt } : {}),
            ...(input.expiresAt ? { expiresAt: input.expiresAt } : {}),
        }),
    });
}

export function useDashboardBlueprintVerificationEvidenceQuery(input: {
    enabled: boolean;
    guildId: string;
    runId?: string;
}) {
    const runId = input.runId ?? '';
    return useQuery({
        queryKey: getDashboardBlueprintVerificationEvidenceQueryKey(input.guildId, runId),
        enabled: input.enabled && Boolean(runId),
        refetchOnMount: false,
        refetchOnReconnect: false,
        refetchOnWindowFocus: false,
        retry: 1,
        staleTime: Infinity,
        queryFn: async () => {
            const result = await readDashboardBlueprintVerificationEvidenceRouteData({
                data: { guildId: input.guildId, runId },
            });
            if (result.type !== 'verification-evidence') throw new Error(result.type);
            return result.verification;
        },
    });
}

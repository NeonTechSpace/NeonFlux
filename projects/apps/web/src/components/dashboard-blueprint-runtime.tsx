import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Outlet, useNavigate, useRouterState } from '@tanstack/react-router';
import { useCallback, useMemo, useState } from 'react';

import { getDashboardBlueprintQueryKey, getDashboardBlueprintStatusQueryKey } from '../dashboard-query-keys.js';
import { readDashboardBlueprintStatusRouteData } from '../server/dashboard-blueprint-route-data.js';
import {
    getDashboardBlueprintSurfaceTo,
    readDashboardBlueprintSurfaceFromPathname,
} from '../dashboard-blueprint-navigation.js';
import type { DashboardBlueprintExplorerSource } from './dashboard-blueprint-explorer-types.js';
import { useDashboardLiveInvalidation } from './dashboard-live-invalidation.js';
import { DashboardBlueprintErrorBoundary } from './dashboard-blueprint-error-boundary.js';
import { useDashboardBlueprintRunProgress } from './dashboard-blueprint-run-progress.js';
import { createDashboardBlueprintReadRegistry } from './dashboard-blueprint-request-registry.js';
import { DashboardBlueprintRuntimeProvider } from './dashboard-blueprint-runtime-context.js';
import type { DashboardBlueprintDeployFlow } from './dashboard-blueprint-runtime-context.js';
import { DashboardBlueprintWorkspaceShell } from './dashboard-blueprint-workspace-shell.js';
import type { DashboardBlueprintSurface } from './dashboard-blueprint-surface.js';

const blueprintLiveArea = ['blueprint', 'blueprint_run'] as const;

export function DashboardBlueprintRuntime({ guildId }: { guildId: string }) {
    const queryClient = useQueryClient();
    const navigate = useNavigate();
    const routeTransition = useRouterState({
        select: (state) => ({
            isLoading: state.isLoading,
            pathname: state.location.pathname,
            resolvedPathname: state.resolvedLocation?.pathname,
        }),
    });
    const readSlice = useMemo(() => createDashboardBlueprintReadRegistry(guildId), [guildId]);
    const [importJson, setImportJson] = useState('');
    const [structurePolicy, setStructurePolicy] = useState<'merge' | 'synchronize' | 'rebuild'>('synchronize');
    const [deployFlow, setDeployFlow] = useState<DashboardBlueprintDeployFlow>({ type: 'latest' });
    const [comparisonSource, setComparisonSource] = useState<DashboardBlueprintExplorerSource | undefined>();
    const [pendingSurface, setPendingSurface] = useState<DashboardBlueprintSurface | undefined>();
    const [failedNavigation, setFailedNavigation] = useState<
        { surface: DashboardBlueprintSurface; origin: DashboardBlueprintSurface | undefined } | undefined
    >();

    const resolvedPathname = routeTransition.resolvedPathname ?? routeTransition.pathname;
    const currentSurface = readDashboardBlueprintSurfaceFromPathname(resolvedPathname);
    const blueprintPath = `/dashboard/${guildId}/blueprint`;
    const routerPendingSurface =
        routeTransition.isLoading && routeTransition.pathname !== resolvedPathname
            ? routeTransition.pathname === blueprintPath || routeTransition.pathname === `${blueprintPath}/`
                ? 'current'
                : routeTransition.pathname.startsWith(`${blueprintPath}/`)
                  ? readDashboardBlueprintSurfaceFromPathname(routeTransition.pathname)
                  : undefined
            : undefined;
    const visiblePendingSurface =
        routerPendingSurface ?? (pendingSurface === currentSurface ? undefined : pendingSurface);
    const visibleFailedSurface =
        !visiblePendingSurface && failedNavigation && failedNavigation.origin === currentSurface
            ? failedNavigation.surface
            : undefined;

    const navigateToSurface = useCallback(
        async (surface: DashboardBlueprintSurface): Promise<void> => {
            if (surface === currentSurface) {
                setPendingSurface(undefined);
                setFailedNavigation(undefined);
                return;
            }
            setFailedNavigation(undefined);
            setPendingSurface(surface);
            try {
                await navigate({ to: getDashboardBlueprintSurfaceTo(surface), params: { guildId } });
                setPendingSurface(undefined);
            } catch {
                setPendingSurface(undefined);
                setFailedNavigation({ surface, origin: currentSurface });
            }
        },
        [currentSurface, guildId, navigate]
    );

    useDashboardLiveInvalidation({ guildId, areas: blueprintLiveArea });

    // The registry only coalesces overlapping transport reads; each leaf query
    // retains ownership of its cache and invalidation lifecycle.
    // eslint-disable-next-line @tanstack/query/exhaustive-deps
    const statusQuery = useQuery({
        queryKey: getDashboardBlueprintStatusQueryKey(guildId),
        queryFn: () =>
            readSlice('status', 'status', () => readDashboardBlueprintStatusRouteData({ data: { guildId } })),
        retry: false,
    });
    const activePlan = statusQuery.data?.activePlan;
    const runProgress = useDashboardBlueprintRunProgress({
        guildId,
        planId: activePlan?.id,
        initialRun: activePlan?.run,
    });
    const shellActivePlan = activePlan
        ? {
              ...activePlan,
              ...(runProgress.run ? { run: runProgress.run } : {}),
          }
        : undefined;

    const runtime = {
        guildId,
        importJson,
        setImportJson,
        structurePolicy,
        setStructurePolicy,
        deployFlow,
        setDeployFlow,
        ...(comparisonSource ? { comparisonSource } : {}),
        setComparisonSource,
        navigateToSurface,
        readSlice,
        statusError: statusQuery.error,
        statusRefreshing: statusQuery.isFetching,
        retryStatus: () => void statusQuery.refetch(),
        ...(activePlan ? { activePlan } : {}),
        runProgress,
    };

    return (
        <DashboardBlueprintErrorBoundary
            onRetry={() => {
                void queryClient.invalidateQueries({ queryKey: getDashboardBlueprintQueryKey(guildId) });
            }}>
            <DashboardBlueprintRuntimeProvider value={runtime}>
                <DashboardBlueprintWorkspaceShell
                    guildId={guildId}
                    pendingSurface={visiblePendingSurface}
                    failedSurface={visibleFailedSurface}
                    onNavigateSurface={navigateToSurface}
                    activePlan={shellActivePlan}
                    runProgressIssue={
                        runProgress.issueCode && activePlan
                            ? { code: runProgress.issueCode, planId: activePlan.id }
                            : undefined
                    }
                    runTransport={runProgress.transport}
                    showActiveRunStrip={currentSurface !== 'deploy'}>
                    <DashboardBlueprintErrorBoundary
                        onRetry={() => {
                            void queryClient.invalidateQueries({ queryKey: getDashboardBlueprintQueryKey(guildId) });
                        }}>
                        <Outlet />
                    </DashboardBlueprintErrorBoundary>
                </DashboardBlueprintWorkspaceShell>
            </DashboardBlueprintRuntimeProvider>
        </DashboardBlueprintErrorBoundary>
    );
}

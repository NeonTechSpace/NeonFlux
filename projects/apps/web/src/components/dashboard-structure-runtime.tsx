import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Outlet, useNavigate, useRouterState } from '@tanstack/react-router';
import { useCallback, useMemo, useState } from 'react';

import { getDashboardStructureQueryKey, getDashboardStructureStatusQueryKey } from '../dashboard-query-keys.js';
import { readDashboardStructureStatusRouteData } from '../server/dashboard-structure-route-data.js';
import type { DashboardStructureImportRun } from '../server/dashboard-structure-model.js';
import {
    getDashboardStructureSurfaceTo,
    readDashboardStructureSurfaceFromPathname,
} from '../dashboard-structure-navigation.js';
import type { DashboardStructureExplorerSource } from './dashboard-structure-explorer-types.js';
import { useDashboardLiveInvalidation } from './dashboard-live-invalidation.js';
import { DashboardStructureErrorBoundary } from './dashboard-structure-error-boundary.js';
import { useDashboardStructureExecutionProgress } from './dashboard-structure-execution-progress.js';
import { createDashboardStructureReadRegistry } from './dashboard-structure-request-registry.js';
import { DashboardStructureRuntimeProvider } from './dashboard-structure-runtime-context.js';
import { DashboardStructureWorkspaceShell } from './dashboard-structure-workspace-shell.js';
import type { DashboardStructureSurface } from './dashboard-structure-surface.js';

const structureLiveArea = ['import_export', 'structure'] as const;

export function DashboardStructureRuntime({ guildId }: { guildId: string }) {
    const queryClient = useQueryClient();
    const navigate = useNavigate();
    const routeTransition = useRouterState({
        select: (state) => ({
            isLoading: state.isLoading,
            pathname: state.location.pathname,
            resolvedPathname: state.resolvedLocation?.pathname,
        }),
    });
    const readSlice = useMemo(() => createDashboardStructureReadRegistry(guildId), [guildId]);
    const [importJson, setImportJson] = useState('');
    const [structurePolicy, setStructurePolicy] = useState<'merge' | 'synchronize' | 'rebuild'>('synchronize');
    const [deployFlow, setDeployFlow] = useState<
        { type: 'latest' } | { type: 'choose' } | { type: 'run'; run: DashboardStructureImportRun }
    >({ type: 'latest' });
    const [comparisonSource, setComparisonSource] = useState<DashboardStructureExplorerSource | undefined>();
    const [pendingSurface, setPendingSurface] = useState<DashboardStructureSurface | undefined>();
    const [failedNavigation, setFailedNavigation] = useState<
        { surface: DashboardStructureSurface; origin: DashboardStructureSurface | undefined } | undefined
    >();

    const resolvedPathname = routeTransition.resolvedPathname ?? routeTransition.pathname;
    const currentSurface = readDashboardStructureSurfaceFromPathname(resolvedPathname);
    const structurePath = `/dashboard/${guildId}/structure`;
    const routerPendingSurface =
        routeTransition.isLoading && routeTransition.pathname !== resolvedPathname
            ? routeTransition.pathname === structurePath || routeTransition.pathname === `${structurePath}/`
                ? 'current'
                : routeTransition.pathname.startsWith(`${structurePath}/`)
                  ? readDashboardStructureSurfaceFromPathname(routeTransition.pathname)
                  : undefined
            : undefined;
    const visiblePendingSurface =
        routerPendingSurface ?? (pendingSurface === currentSurface ? undefined : pendingSurface);
    const visibleFailedSurface =
        !visiblePendingSurface && failedNavigation && failedNavigation.origin === currentSurface
            ? failedNavigation.surface
            : undefined;

    const navigateToSurface = useCallback(
        async (surface: DashboardStructureSurface): Promise<void> => {
            if (surface === currentSurface) {
                setPendingSurface(undefined);
                setFailedNavigation(undefined);
                return;
            }
            setFailedNavigation(undefined);
            setPendingSurface(surface);
            try {
                await navigate({ to: getDashboardStructureSurfaceTo(surface), params: { guildId } });
                setPendingSurface(undefined);
            } catch {
                setPendingSurface(undefined);
                setFailedNavigation({ surface, origin: currentSurface });
            }
        },
        [currentSurface, guildId, navigate]
    );

    useDashboardLiveInvalidation({ guildId, areas: structureLiveArea });

    // The registry only coalesces overlapping transport reads; each leaf query
    // retains ownership of its cache and invalidation lifecycle.
    // eslint-disable-next-line @tanstack/query/exhaustive-deps
    const statusQuery = useQuery({
        queryKey: getDashboardStructureStatusQueryKey(guildId),
        queryFn: () =>
            readSlice('status', 'status', () => readDashboardStructureStatusRouteData({ data: { guildId } })),
        retry: false,
    });
    const activeExecutionRun = statusQuery.data?.activeRun;
    const executionProgress = useDashboardStructureExecutionProgress({
        guildId,
        runId: activeExecutionRun?.id,
        initialExecution: activeExecutionRun?.execution,
    });
    const shellActiveRun = activeExecutionRun
        ? {
              ...activeExecutionRun,
              ...(executionProgress.execution ? { execution: executionProgress.execution } : {}),
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
        ...(activeExecutionRun ? { activeExecutionRun } : {}),
        executionProgress,
    };

    return (
        <DashboardStructureErrorBoundary
            onRetry={() => {
                void queryClient.invalidateQueries({ queryKey: getDashboardStructureQueryKey(guildId) });
            }}>
            <DashboardStructureRuntimeProvider value={runtime}>
                <DashboardStructureWorkspaceShell
                    guildId={guildId}
                    pendingSurface={visiblePendingSurface}
                    failedSurface={visibleFailedSurface}
                    onNavigateSurface={navigateToSurface}
                    activeRun={shellActiveRun}
                    executionProgressIssue={
                        executionProgress.issueCode && activeExecutionRun
                            ? { code: executionProgress.issueCode, runId: activeExecutionRun.id }
                            : undefined
                    }
                    executionTransport={executionProgress.transport}>
                    <DashboardStructureErrorBoundary
                        onRetry={() => {
                            void queryClient.invalidateQueries({ queryKey: getDashboardStructureQueryKey(guildId) });
                        }}>
                        <Outlet />
                    </DashboardStructureErrorBoundary>
                </DashboardStructureWorkspaceShell>
            </DashboardStructureRuntimeProvider>
        </DashboardStructureErrorBoundary>
    );
}

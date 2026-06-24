import { redirect } from '@tanstack/react-router';
import { createServerFn } from '@tanstack/react-start';

import type { DashboardDataResult } from './dashboard.server.js';
import type { DashboardViewModel } from './dashboard-view-model.server.js';

const fluxerLoginPath = '/auth/fluxer/login';
const dashboardUnavailableMessage = 'NeonFlux dashboard unavailable.';
const deploymentConfigUnavailableMessage = 'NeonFlux deployment config unavailable.';

export type DashboardRouteData =
    | {
          type: 'dashboard';
          viewModel: DashboardViewModel;
      }
    | {
          type: 'unavailable';
          status: 500 | 502 | 503;
          message: string;
      };

export type DashboardRouteResult =
    | DashboardRouteData
    | { type: 'auth-required' }
    | { type: 'guild-redirect'; guildId: string };

export function toDashboardRouteResult(dashboardData: DashboardDataResult): DashboardRouteResult {
    switch (dashboardData.type) {
        case 'dashboard':
            if (dashboardData.viewModel.type === 'guild-list' && dashboardData.viewModel.mode === 'single') {
                const guildId = dashboardData.viewModel.guilds.at(0)?.id;

                if (guildId) {
                    return {
                        type: 'guild-redirect',
                        guildId,
                    };
                }
            }

            if (dashboardData.viewModel.type === 'single-unauthorized') {
                return {
                    type: 'guild-redirect',
                    guildId: dashboardData.viewModel.configuredGuildId,
                };
            }

            return dashboardData;

        case 'auth-required':
            return { type: 'auth-required' };

        case 'database-error':
            return {
                type: 'unavailable',
                status: 500,
                message: dashboardUnavailableMessage,
            };

        case 'deployment-config-not-found':
            return {
                type: 'unavailable',
                status: 503,
                message: deploymentConfigUnavailableMessage,
            };

        case 'guild-lookup-failed':
            return {
                type: 'unavailable',
                status: 502,
                message: dashboardUnavailableMessage,
            };
    }
}

export function resolveDashboardRouteResult(routeResult: DashboardRouteResult): DashboardRouteData {
    switch (routeResult.type) {
        case 'dashboard':
        case 'unavailable':
            return routeResult;

        case 'auth-required':
            throw redirect({
                to: fluxerLoginPath,
                reloadDocument: true,
                statusCode: 302,
            });

        case 'guild-redirect':
            throw redirect({
                to: '/dashboard/$guildId',
                params: {
                    guildId: routeResult.guildId,
                },
                statusCode: 302,
            });
    }
}

export const loadDashboardRouteData = createServerFn({ method: 'GET' }).handler(
    async (): Promise<DashboardRouteData> => {
        const { getRequest, setResponseHeader, setResponseStatus } = await import('@tanstack/react-start/server');
        const { loadDashboardData } = await import('./dashboard.server.js');
        const routeResult = toDashboardRouteResult(await loadDashboardData(getRequest()));

        setResponseHeader('Cache-Control', 'no-store');

        const routeData = resolveDashboardRouteResult(routeResult);

        if (routeData.type === 'unavailable') {
            setResponseStatus(routeData.status);
        }

        return routeData;
    }
);

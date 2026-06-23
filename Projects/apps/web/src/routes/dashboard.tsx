import { Link, createFileRoute, redirect } from '@tanstack/react-router';
import { createServerFn } from '@tanstack/react-start';

import { DashboardShell, DashboardStatusSection } from '../components/dashboard-layout.js';
import type { DashboardDataResult } from '../server/dashboard.server.js';
import type { DashboardViewModel, DashboardViewModelGuild } from '../server/dashboard-view-model.server.js';

const createRoute = createFileRoute('/dashboard');
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
        const { loadDashboardData } = await import('../server/dashboard.server.js');
        const routeResult = toDashboardRouteResult(await loadDashboardData(getRequest()));

        setResponseHeader('Cache-Control', 'no-store');

        const routeData = resolveDashboardRouteResult(routeResult);

        if (routeData.type === 'unavailable') {
            setResponseStatus(routeData.status);
        }

        return routeData;
    }
);

export const dashboardRouteOptions = {
    loader: () => loadDashboardRouteData(),
    component: DashboardPage,
} satisfies NonNullable<Parameters<typeof createRoute>[0]>;

export const Route = createRoute(dashboardRouteOptions);

function DashboardPage() {
    const data = Route.useLoaderData();

    return <DashboardPageContent data={data} />;
}

export function DashboardPageContent({ data }: { data: DashboardRouteData }) {
    switch (data.type) {
        case 'dashboard':
            return <DashboardView viewModel={data.viewModel} />;

        case 'unavailable':
            return (
                <DashboardShell>
                    <DashboardStatusSection
                        eyebrow='Dashboard'
                        title='Dashboard unavailable'
                        body={data.message}
                        actionLabel='Try again'
                        actionTo='/dashboard'
                    />
                </DashboardShell>
            );
    }
}

function DashboardView({ viewModel }: { viewModel: DashboardViewModel }) {
    switch (viewModel.type) {
        case 'guild-list':
            return (
                <DashboardShell>
                    <header className='space-y-2 border-b border-neutral-800 pb-6'>
                        <p className='text-sm font-medium tracking-wide text-sky-300 uppercase'>
                            {viewModel.mode === 'single' ? 'Single instance' : 'Multi instance'}
                        </p>
                        <h1 className='text-3xl font-semibold text-white'>NeonFlux Dashboard</h1>
                        <p className='max-w-2xl text-sm leading-6 text-neutral-300'>
                            Manage communities connected to NeonFlux.
                        </p>
                    </header>

                    <section className='space-y-4' aria-labelledby='dashboard-communities-heading'>
                        <div className='flex items-end justify-between gap-4'>
                            <div>
                                <h2 id='dashboard-communities-heading' className='text-xl font-semibold text-white'>
                                    Communities
                                </h2>
                                <p className='mt-1 text-sm text-neutral-400'>
                                    {viewModel.mode === 'single'
                                        ? 'The configured community for this bot.'
                                        : 'Communities where you can manage this bot.'}
                                </p>
                            </div>
                            <span className='text-sm text-neutral-400'>{viewModel.guilds.length}</span>
                        </div>

                        <ul className='grid gap-3 sm:grid-cols-2'>
                            {viewModel.guilds.map((guild) => (
                                <DashboardGuildItem key={guild.id} guild={guild} />
                            ))}
                        </ul>
                    </section>
                </DashboardShell>
            );

        case 'single-unauthorized':
            return (
                <DashboardShell>
                    <DashboardStatusSection
                        eyebrow='Single instance'
                        title='Not authorized'
                        body={`You are not authorized to modify ${viewModel.configuredGuildName}.`}
                        actionLabel='Use another account'
                        actionTo={fluxerLoginPath}
                    />
                </DashboardShell>
            );

        case 'multi-empty':
            return (
                <DashboardShell>
                    <DashboardStatusSection
                        eyebrow='Multi instance'
                        title='No manageable communities'
                        body='No communities are available for this account.'
                        actionLabel='Use another account'
                        actionTo={fluxerLoginPath}
                    />
                </DashboardShell>
            );
    }
}

function DashboardGuildItem({ guild }: { guild: DashboardViewModelGuild }) {
    return (
        <li>
            <Link
                to='/dashboard/$guildId'
                params={{ guildId: guild.id }}
                className='block rounded-lg border border-neutral-800 bg-neutral-900 p-4 transition hover:border-sky-500 focus:ring-2 focus:ring-sky-300 focus:ring-offset-2 focus:ring-offset-neutral-950 focus:outline-none'>
                <p className='text-xs font-medium tracking-wide text-neutral-500 uppercase'>Community</p>
                <div className='mt-2 flex items-center justify-between gap-4'>
                    <h3 className='text-lg font-semibold text-white'>{guild.name}</h3>
                    <span className='text-sm font-medium text-sky-300'>Open</span>
                </div>
            </Link>
        </li>
    );
}

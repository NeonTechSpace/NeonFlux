import { Link, createFileRoute, redirect } from '@tanstack/react-router';
import { createServerFn } from '@tanstack/react-start';

import { DashboardShell, DashboardStatusSection } from '../components/dashboard-layout.js';
import type { DashboardGuildPageDataResult } from '../server/dashboard-guild-page.server.js';

const createRoute = createFileRoute('/dashboard/$guildId');
const fluxerLoginPath = '/auth/fluxer/login';
const dashboardUnavailableMessage = 'NeonFlux dashboard unavailable.';
const deploymentConfigUnavailableMessage = 'NeonFlux deployment config unavailable.';
const communityUnavailableMessage = 'This community is not available for this account.';

export type DashboardGuildRouteData =
    | {
          type: 'guild';
          mode: 'single' | 'multi';
          guild: {
              id: string;
              name: string;
          };
      }
    | {
          type: 'single-unauthorized';
          configuredGuildId: string;
          configuredGuildName: string;
      }
    | {
          type: 'unavailable';
          status: 404 | 500 | 502 | 503;
          title: string;
          message: string;
      };

export type DashboardGuildRouteResult = DashboardGuildRouteData | { type: 'auth-required' };

type DashboardGuildRouteInput = {
    guildId: string;
};

export function toDashboardGuildRouteResult(data: DashboardGuildPageDataResult): DashboardGuildRouteResult {
    switch (data.type) {
        case 'guild':
        case 'single-unauthorized':
            return data;

        case 'auth-required':
            return { type: 'auth-required' };

        case 'not-found':
            return {
                type: 'unavailable',
                status: 404,
                title: 'Community unavailable',
                message: communityUnavailableMessage,
            };

        case 'database-error':
            return {
                type: 'unavailable',
                status: 500,
                title: 'Dashboard unavailable',
                message: dashboardUnavailableMessage,
            };

        case 'deployment-config-not-found':
            return {
                type: 'unavailable',
                status: 503,
                title: 'Dashboard unavailable',
                message: deploymentConfigUnavailableMessage,
            };

        case 'guild-lookup-failed':
            return {
                type: 'unavailable',
                status: 502,
                title: 'Dashboard unavailable',
                message: dashboardUnavailableMessage,
            };
    }
}

export function resolveDashboardGuildRouteResult(routeResult: DashboardGuildRouteResult): DashboardGuildRouteData {
    switch (routeResult.type) {
        case 'guild':
        case 'single-unauthorized':
        case 'unavailable':
            return routeResult;

        case 'auth-required':
            throw redirect({
                to: fluxerLoginPath,
                statusCode: 302,
            });
    }
}

export const loadDashboardGuildRouteData = createServerFn({ method: 'GET' })
    .validator(validateDashboardGuildRouteInput)
    .handler(async ({ data }): Promise<DashboardGuildRouteData> => {
        const { getRequest, setResponseHeader, setResponseStatus } = await import('@tanstack/react-start/server');
        const { loadDashboardGuildPageData } = await import('../server/dashboard-guild-page.server.js');
        const routeResult = toDashboardGuildRouteResult(await loadDashboardGuildPageData(getRequest(), data.guildId));

        setResponseHeader('Cache-Control', 'no-store');

        const routeData = resolveDashboardGuildRouteResult(routeResult);

        if (routeData.type === 'unavailable') {
            setResponseStatus(routeData.status);
        }

        return routeData;
    });

export const dashboardGuildRouteOptions = {
    loader: ({ params }) => loadDashboardGuildRouteData({ data: { guildId: getGuildIdParam(params) } }),
    component: DashboardGuildPage,
} satisfies NonNullable<Parameters<typeof createRoute>[0]>;

export const Route = createRoute(dashboardGuildRouteOptions);

function DashboardGuildPage() {
    const data = Route.useLoaderData();

    return <DashboardGuildPageContent data={data} />;
}

export function DashboardGuildPageContent({ data }: { data: DashboardGuildRouteData }) {
    switch (data.type) {
        case 'guild':
            return <DashboardGuildView data={data} />;

        case 'single-unauthorized':
            return (
                <DashboardShell>
                    <DashboardStatusSection
                        eyebrow='Single instance'
                        title='Not authorized'
                        body={`You are not authorized to modify ${data.configuredGuildName}.`}
                        actionLabel='Use another account'
                        actionTo={fluxerLoginPath}
                    />
                </DashboardShell>
            );

        case 'unavailable':
            return (
                <DashboardShell>
                    <DashboardStatusSection
                        eyebrow='Dashboard'
                        title={data.title}
                        body={data.message}
                        actionLabel='Choose server'
                        actionTo='/dashboard'
                    />
                </DashboardShell>
            );
    }
}

function DashboardGuildView({ data }: { data: Extract<DashboardGuildRouteData, { type: 'guild' }> }) {
    return (
        <DashboardShell>
            <header className='space-y-3 border-b border-neutral-800 pb-6'>
                <div className='flex flex-wrap items-center justify-between gap-3'>
                    <p className='text-sm font-medium tracking-wide text-sky-300 uppercase'>
                        {data.mode === 'single' ? 'Single instance' : 'Multi instance'}
                    </p>
                    {data.mode === 'multi' ? (
                        <Link
                            to='/dashboard'
                            className='inline-flex min-h-9 items-center rounded-md border border-neutral-700 px-3 text-sm font-semibold text-neutral-100 transition hover:border-sky-400 hover:text-sky-200 focus:ring-2 focus:ring-sky-300 focus:ring-offset-2 focus:ring-offset-neutral-950 focus:outline-none'>
                            Choose server
                        </Link>
                    ) : null}
                </div>
                <div>
                    <h1 className='text-3xl font-semibold text-white'>{data.guild.name}</h1>
                    <p className='mt-2 text-sm text-neutral-400'>Community ID: {data.guild.id}</p>
                </div>
            </header>

            <section className='grid gap-3 sm:grid-cols-2' aria-label='Community setup status'>
                <StatusCard title='Capabilities' body='Feature controls will appear here as they are implemented.' />
                <StatusCard title='Access' body='Server-side permission checks are active for this community.' />
            </section>
        </DashboardShell>
    );
}

function StatusCard({ title, body }: { title: string; body: string }) {
    return (
        <article className='rounded-lg border border-neutral-800 bg-neutral-900 p-4'>
            <h2 className='text-lg font-semibold text-white'>{title}</h2>
            <p className='mt-2 text-sm leading-6 text-neutral-400'>{body}</p>
        </article>
    );
}

function validateDashboardGuildRouteInput(input: unknown): DashboardGuildRouteInput {
    if (!input || typeof input !== 'object') {
        return { guildId: '' };
    }

    const guildId = (input as Record<string, unknown>).guildId;

    return {
        guildId: typeof guildId === 'string' ? guildId : '',
    };
}

function getGuildIdParam(params: unknown): string {
    if (!params || typeof params !== 'object') {
        return '';
    }

    const guildId = (params as Record<string, unknown>).guildId;

    return typeof guildId === 'string' ? guildId : '';
}

import { useMutation } from '@tanstack/react-query';
import { COMMAND_PREFIX_INVALID_MESSAGE, normalizeCommandPrefix } from '@neonflux/core/command-prefix';
import { Link, createFileRoute, redirect, useRouter } from '@tanstack/react-router';
import { createServerFn } from '@tanstack/react-start';
import { useState } from 'react';
import type { FormEvent } from 'react';

import { DashboardShell, DashboardStatusSection } from '../components/dashboard-layout.js';
import type {
    DashboardCommandPrefixUpdateResult,
    DashboardCommandSettings,
    DashboardCommandSettingsPageDataResult,
} from '../server/dashboard-command-settings.server.js';

const createRoute = createFileRoute('/dashboard/$guildId');
const fluxerLoginPath = '/auth/fluxer/login';
const dashboardUnavailableMessage = 'NeonFlux dashboard unavailable.';
const deploymentConfigUnavailableMessage = 'NeonFlux deployment config unavailable.';
const communityUnavailableMessage = 'This community is not available for this account.';
const invalidPrefixMessage = COMMAND_PREFIX_INVALID_MESSAGE;
const genericPrefixUpdateErrorMessage = 'Could not update the command prefix. Try again.';

export type DashboardGuildRouteData =
    | {
          type: 'guild';
          mode: 'single' | 'multi';
          guild: {
              id: string;
              name: string;
          };
          commandSettings: DashboardCommandSettings;
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

type DashboardCommandPrefixUpdateRouteInput = {
    guildId: string;
    prefix: string;
};

export function toDashboardGuildRouteResult(data: DashboardCommandSettingsPageDataResult): DashboardGuildRouteResult {
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
                reloadDocument: true,
                statusCode: 302,
            });
    }
}

export const loadDashboardGuildRouteData = createServerFn({ method: 'GET' })
    .validator(validateDashboardGuildRouteInput)
    .handler(async ({ data }): Promise<DashboardGuildRouteData> => {
        const { getRequest, setResponseHeader, setResponseStatus } = await import('@tanstack/react-start/server');
        const { loadDashboardCommandSettingsPageData } = await import('../server/dashboard-command-settings.server.js');
        const routeResult = toDashboardGuildRouteResult(
            await loadDashboardCommandSettingsPageData(getRequest(), data.guildId)
        );

        setResponseHeader('Cache-Control', 'no-store');

        const routeData = resolveDashboardGuildRouteResult(routeResult);

        if (routeData.type === 'unavailable') {
            setResponseStatus(routeData.status);
        }

        return routeData;
    });

const updateDashboardCommandPrefixRouteData = createServerFn({ method: 'POST' })
    .validator(validateDashboardCommandPrefixUpdateRouteInput)
    .handler(async ({ data }): Promise<DashboardCommandPrefixUpdateResult> => {
        const { getRequest, setResponseHeader } = await import('@tanstack/react-start/server');
        const { updateDashboardGuildCommandPrefix } = await import('../server/dashboard-command-settings.server.js');

        setResponseHeader('Cache-Control', 'no-store');

        return updateDashboardGuildCommandPrefix(getRequest(), data);
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
                <CommandPrefixSettingsPanel
                    key={`${data.guild.id}:${data.commandSettings.prefix}`}
                    guildId={data.guild.id}
                    commandSettings={data.commandSettings}
                />
                <StatusCard title='Access' body='Server-side permission checks are active for this community.' />
            </section>
        </DashboardShell>
    );
}

function CommandPrefixSettingsPanel({
    guildId,
    commandSettings,
}: {
    guildId: string;
    commandSettings: DashboardCommandSettings;
}) {
    const router = useRouter();
    const [draftPrefix, setDraftPrefix] = useState(commandSettings.prefix);
    const [optimisticPrefix, setOptimisticPrefix] = useState<string | undefined>();
    const [formMessage, setFormMessage] = useState<{ type: 'error' | 'success'; text: string } | undefined>();
    const visiblePrefix = optimisticPrefix ?? commandSettings.prefix;
    const mutation = useMutation({
        mutationFn: (prefix: string) =>
            updateDashboardCommandPrefixRouteData({
                data: {
                    guildId,
                    prefix,
                },
            }),
        onMutate: (prefix) => {
            const previousPrefix = optimisticPrefix;

            setFormMessage(undefined);
            setOptimisticPrefix(prefix);

            return { previousPrefix };
        },
        onError: (_error, _prefix, context) => {
            setOptimisticPrefix(context?.previousPrefix);
            setFormMessage({ type: 'error', text: genericPrefixUpdateErrorMessage });
        },
        onSuccess: async (result, _prefix, context) => {
            switch (result.type) {
                case 'updated':
                    setDraftPrefix(result.commandSettings.prefix);
                    setFormMessage({ type: 'success', text: 'Command prefix updated.' });
                    await router.invalidate();
                    setOptimisticPrefix(undefined);
                    return;

                case 'invalid-prefix':
                    setOptimisticPrefix(context.previousPrefix);
                    setFormMessage({ type: 'error', text: result.message });
                    return;

                case 'auth-required':
                    setOptimisticPrefix(context.previousPrefix);
                    setFormMessage({ type: 'error', text: 'Sign in again before changing this setting.' });
                    return;

                case 'not-found':
                    setOptimisticPrefix(context.previousPrefix);
                    setFormMessage({ type: 'error', text: 'This community is not available for this account.' });
                    return;

                case 'deployment-config-not-found':
                case 'database-error':
                case 'guild-lookup-failed':
                    setOptimisticPrefix(context.previousPrefix);
                    setFormMessage({ type: 'error', text: genericPrefixUpdateErrorMessage });
                    return;
            }
        },
    });

    function submitPrefixUpdate(event: FormEvent<HTMLFormElement>): void {
        event.preventDefault();

        const validationResult = validateDashboardCommandPrefix(draftPrefix);

        if (!validationResult.valid) {
            setFormMessage({ type: 'error', text: validationResult.message });
            return;
        }

        mutation.mutate(validationResult.prefix);
    }

    return (
        <article className='rounded-lg border border-neutral-800 bg-neutral-900 p-4'>
            <div className='flex flex-wrap items-start justify-between gap-3'>
                <div>
                    <h2 className='text-lg font-semibold text-white'>Command prefix</h2>
                    <p className='mt-2 text-sm leading-6 text-neutral-400'>
                        Current prefix:{' '}
                        <code className='rounded bg-neutral-950 px-1.5 py-0.5 text-sm text-sky-200'>
                            {visiblePrefix}
                        </code>
                    </p>
                </div>
                {commandSettings.isDefaultPrefix ? (
                    <span className='rounded-md border border-neutral-700 px-2 py-1 text-xs font-medium text-neutral-300'>
                        Default
                    </span>
                ) : null}
            </div>

            <form className='mt-4 flex flex-col gap-3' onSubmit={submitPrefixUpdate}>
                <label className='space-y-2 text-sm font-medium text-neutral-200'>
                    <span>New prefix</span>
                    <input
                        value={draftPrefix}
                        onChange={(event) => setDraftPrefix(event.currentTarget.value)}
                        className='min-h-10 w-full rounded-md border border-neutral-700 bg-neutral-950 px-3 text-base text-white transition outline-none placeholder:text-neutral-600 focus:border-sky-400 focus:ring-2 focus:ring-sky-400/40'
                        maxLength={6}
                        inputMode='text'
                        autoComplete='off'
                        aria-describedby='command-prefix-help command-prefix-message'
                    />
                </label>
                <p id='command-prefix-help' className='text-xs leading-5 text-neutral-500'>
                    Start with an allowed symbol, then use up to two more letters, numbers, or symbols.
                </p>
                <div className='flex flex-wrap items-center gap-3'>
                    <button
                        type='submit'
                        disabled={mutation.isPending}
                        className='inline-flex min-h-10 items-center rounded-md bg-sky-500 px-4 text-sm font-semibold text-white transition hover:bg-sky-400 focus:ring-2 focus:ring-sky-300 focus:ring-offset-2 focus:ring-offset-neutral-950 focus:outline-none disabled:cursor-not-allowed disabled:bg-neutral-700 disabled:text-neutral-400'>
                        {mutation.isPending ? 'Saving...' : 'Save prefix'}
                    </button>
                    <span
                        id='command-prefix-message'
                        role='status'
                        className={
                            formMessage?.type === 'success' ? 'text-sm text-emerald-300' : 'text-sm text-rose-300'
                        }>
                        {formMessage?.text}
                    </span>
                </div>
            </form>
        </article>
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

function validateDashboardCommandPrefix(
    prefix: string
): { valid: true; prefix: string } | { valid: false; message: string } {
    const prefixResult = normalizeCommandPrefix(prefix);

    if (prefixResult.isErr()) {
        return { valid: false, message: invalidPrefixMessage };
    }

    return { valid: true, prefix: prefixResult.value };
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

function validateDashboardCommandPrefixUpdateRouteInput(input: unknown): DashboardCommandPrefixUpdateRouteInput {
    if (!input || typeof input !== 'object') {
        return { guildId: '', prefix: '' };
    }

    const guildId = (input as Record<string, unknown>).guildId;
    const prefix = (input as Record<string, unknown>).prefix;

    return {
        guildId: typeof guildId === 'string' ? guildId : '',
        prefix: typeof prefix === 'string' ? prefix : '',
    };
}

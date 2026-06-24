import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
    COMMAND_PREFIX_INVALID_MESSAGE,
    DEFAULT_COMMAND_PREFIX,
    normalizeCommandPrefix,
} from '@neonflux/core/command-prefix';
import { Link } from '@tanstack/react-router';
import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';

import type { DashboardLiveArea } from '../dashboard-live.js';
import { getDashboardCommandSettingsQueryKey } from '../dashboard-query-keys.js';
import type { DashboardCommandSettings } from '../server/dashboard-command-settings.server.js';
import type { DashboardGuildRouteData } from '../server/dashboard-guild-route-data.js';
import {
    readDashboardCommandSettingsRouteData,
    updateDashboardCommandPrefixRouteData,
} from '../server/dashboard-guild-route-data.js';
import { useDashboardLiveInvalidation } from './dashboard-live-invalidation.js';
import { DashboardShell, DashboardStatusSection } from './dashboard-layout.js';

const fluxerLoginPath = '/auth/fluxer/login';
const invalidPrefixMessage = COMMAND_PREFIX_INVALID_MESSAGE;
const genericPrefixUpdateErrorMessage = 'Could not update the command prefix. Try again.';
const commandSettingsLiveAreas = ['commands'] as const satisfies readonly DashboardLiveArea[];

type CommandPrefixFormState = {
    draftPrefix: string;
    draftBasePrefix: string;
    formMessage?: { type: 'error' | 'success'; text: string };
};

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
                <div className='flex min-w-0 items-center gap-4'>
                    <DashboardGuildAvatar guild={data.guild} />
                    <div className='min-w-0'>
                        <h1 className='truncate text-3xl font-semibold text-white'>{data.guild.name}</h1>
                        <p className='mt-2 text-sm text-neutral-400'>Server ID: {data.guild.id}</p>
                    </div>
                </div>
            </header>

            <section className='grid gap-3 sm:grid-cols-2' aria-label='Server setup status'>
                <CommandPrefixSettingsPanel guildId={data.guild.id} commandSettings={data.commandSettings} />
                <StatusCard
                    title='Permissions'
                    body='Every setting change is checked again on the server before it is saved.'
                />
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
    const queryClient = useQueryClient();
    const commandSettingsQueryKey = getDashboardCommandSettingsQueryKey(guildId);
    const commandSettingsQuery = useQuery({
        queryKey: commandSettingsQueryKey,
        queryFn: async () => {
            const result = await readDashboardCommandSettingsRouteData({
                data: {
                    guildId,
                },
            });

            if (result.type !== 'settings') {
                throw new Error('Could not refresh command settings.');
            }

            return result.commandSettings;
        },
        initialData: commandSettings,
        staleTime: Number.POSITIVE_INFINITY,
    });
    const liveCommandSettings = commandSettingsQuery.data;
    const [formState, setFormState] = useState<CommandPrefixFormState>({
        draftPrefix: commandSettings.prefix,
        draftBasePrefix: commandSettings.prefix,
    });
    const formStateRef = useRef(formState);
    useDashboardLiveInvalidation({
        guildId,
        areas: commandSettingsLiveAreas,
    });

    useEffect(() => {
        formStateRef.current = formState;
    }, [formState]);
    const normalizedDraftPrefix = formState.draftPrefix.trim();
    const draftIsDirty =
        normalizedDraftPrefix !== formState.draftBasePrefix && normalizedDraftPrefix !== liveCommandSettings.prefix;
    const displayedDraftPrefix = draftIsDirty ? formState.draftPrefix : liveCommandSettings.prefix;
    const externalChangeMessage =
        draftIsDirty && liveCommandSettings.prefix !== formState.draftBasePrefix
            ? {
                  type: 'success' as const,
                  text: `Command prefix changed elsewhere to ${liveCommandSettings.prefix}.`,
              }
            : undefined;
    const displayedFormMessage = formState.formMessage ?? externalChangeMessage;

    const mutation = useMutation({
        mutationFn: (prefix: string) =>
            updateDashboardCommandPrefixRouteData({
                data: {
                    guildId,
                    prefix,
                },
            }),
        onMutate: async (prefix) => {
            await queryClient.cancelQueries({ queryKey: commandSettingsQueryKey });
            const previousSettings = queryClient.getQueryData<DashboardCommandSettings>(commandSettingsQueryKey);
            const previousFormState = formStateRef.current;

            queryClient.setQueryData<DashboardCommandSettings>(commandSettingsQueryKey, {
                prefix,
                isDefaultPrefix: prefix === DEFAULT_COMMAND_PREFIX,
            });
            setFormState({
                draftPrefix: prefix,
                draftBasePrefix: prefix,
                formMessage: undefined,
            });

            return { previousSettings, previousFormState };
        },
        onError: (_error, _prefix, context) => {
            restorePreviousCommandSettings(context?.previousSettings);
            restorePreviousFormState(context?.previousFormState, genericPrefixUpdateErrorMessage);
        },
        onSuccess: async (result, _prefix, context) => {
            switch (result.type) {
                case 'updated':
                    queryClient.setQueryData(commandSettingsQueryKey, result.commandSettings);
                    setFormState({
                        draftPrefix: result.commandSettings.prefix,
                        draftBasePrefix: result.commandSettings.prefix,
                        formMessage: { type: 'success', text: 'Command prefix updated.' },
                    });
                    await queryClient.invalidateQueries({ queryKey: commandSettingsQueryKey });
                    return;

                case 'invalid-prefix':
                    restorePreviousCommandSettings(context.previousSettings);
                    restorePreviousFormState(context.previousFormState, result.message);
                    return;

                case 'auth-required':
                    restorePreviousCommandSettings(context.previousSettings);
                    restorePreviousFormState(context.previousFormState, 'Sign in again before changing this setting.');
                    return;

                case 'not-found':
                    restorePreviousCommandSettings(context.previousSettings);
                    restorePreviousFormState(
                        context.previousFormState,
                        'This server is not available for this account.'
                    );
                    return;

                case 'deployment-config-not-found':
                case 'database-error':
                case 'guild-lookup-failed':
                    restorePreviousCommandSettings(context.previousSettings);
                    restorePreviousFormState(context.previousFormState, genericPrefixUpdateErrorMessage);
                    return;
            }
        },
    });
    const displayedDraftPrefixHasChanged = displayedDraftPrefix.trim() !== liveCommandSettings.prefix;
    const canSubmit = displayedDraftPrefixHasChanged && !mutation.isPending;

    function restorePreviousCommandSettings(previousSettings?: DashboardCommandSettings): void {
        if (previousSettings) {
            queryClient.setQueryData(commandSettingsQueryKey, previousSettings);
        } else {
            void queryClient.invalidateQueries({ queryKey: commandSettingsQueryKey });
        }
    }

    function restorePreviousFormState(previousFormState: CommandPrefixFormState | undefined, message: string): void {
        setFormState({
            ...(previousFormState ?? formStateRef.current),
            formMessage: { type: 'error', text: message },
        });
    }

    function submitPrefixUpdate(event: FormEvent<HTMLFormElement>): void {
        event.preventDefault();

        const validationResult = validateDashboardCommandPrefix(displayedDraftPrefix);

        if (!validationResult.valid) {
            setFormState((currentState) => ({
                ...currentState,
                formMessage: { type: 'error', text: validationResult.message },
            }));
            return;
        }

        if (validationResult.prefix === liveCommandSettings.prefix) {
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
                            {liveCommandSettings.prefix}
                        </code>
                    </p>
                    {commandSettingsQuery.isFetching ? (
                        <p className='mt-1 text-xs text-neutral-500'>Refreshing live setting...</p>
                    ) : null}
                </div>
                {liveCommandSettings.prefix === DEFAULT_COMMAND_PREFIX ? (
                    <span className='rounded-md border border-neutral-700 px-2 py-1 text-xs font-medium text-neutral-300'>
                        Default
                    </span>
                ) : null}
            </div>

            <form className='mt-4 flex flex-col gap-3' onSubmit={submitPrefixUpdate}>
                <label className='space-y-2 text-sm font-medium text-neutral-200'>
                    <span>New prefix</span>
                    <input
                        value={displayedDraftPrefix}
                        onChange={(event) => {
                            setFormState((currentState) => ({
                                ...currentState,
                                draftPrefix: event.currentTarget.value,
                                draftBasePrefix: draftIsDirty
                                    ? currentState.draftBasePrefix
                                    : liveCommandSettings.prefix,
                                formMessage: undefined,
                            }));
                        }}
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
                        disabled={!canSubmit}
                        className='inline-flex min-h-10 items-center rounded-md bg-sky-500 px-4 text-sm font-semibold text-white transition hover:bg-sky-400 focus:ring-2 focus:ring-sky-300 focus:ring-offset-2 focus:ring-offset-neutral-950 focus:outline-none disabled:cursor-not-allowed disabled:bg-neutral-700 disabled:text-neutral-400'>
                        {mutation.isPending ? 'Saving...' : 'Save prefix'}
                    </button>
                    <span
                        id='command-prefix-message'
                        role='status'
                        className={
                            displayedFormMessage?.type === 'success'
                                ? 'text-sm text-emerald-300'
                                : 'text-sm text-rose-300'
                        }>
                        {displayedFormMessage?.text}
                    </span>
                </div>
                {commandSettingsQuery.isError ? (
                    <p className='text-sm text-rose-300'>Could not refresh this setting.</p>
                ) : null}
            </form>
        </article>
    );
}

function DashboardGuildAvatar({ guild }: { guild: { name: string; iconUrl?: string } }) {
    const fallbackLabel = getGuildFallbackLabel(guild.name);

    if (guild.iconUrl) {
        return (
            <img
                src={guild.iconUrl}
                alt={`${guild.name} icon`}
                className='size-14 shrink-0 rounded-xl bg-neutral-800 object-cover'
                loading='lazy'
                referrerPolicy='no-referrer'
            />
        );
    }

    return (
        <span
            className='grid size-14 shrink-0 place-items-center rounded-xl bg-neutral-800 text-base font-semibold text-neutral-200'
            aria-hidden='true'>
            {fallbackLabel}
        </span>
    );
}

function getGuildFallbackLabel(name: string): string {
    const letters = name
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2)
        .map((part) => part.at(0)?.toUpperCase())
        .join('');

    return letters || '?';
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

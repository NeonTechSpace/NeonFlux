import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
    COMMAND_PREFIX_INVALID_MESSAGE,
    DEFAULT_COMMAND_PREFIX,
    normalizeCommandPrefix,
} from '@neonflux/core/command-prefix';
import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';

import { getDashboardCommandSettingsQueryKey } from '../dashboard-query-keys.js';
import type { DashboardCommandSettings } from '../server/dashboard-command-settings.server.js';
import {
    readDashboardCommandSettingsRouteData,
    updateDashboardCommandPrefixRouteData,
} from '../server/dashboard-guild-route-data.js';

type CommandPrefixFormState = {
    draftPrefix: string;
    draftBasePrefix: string;
    formMessage?: { type: 'error' | 'success'; text: string };
};

const invalidPrefixMessage = COMMAND_PREFIX_INVALID_MESSAGE;
const genericPrefixUpdateErrorMessage = 'Could not update the command prefix. Try again.';

export function DashboardCommandPrefixSettingsPanel({
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
        <article
            className='rounded-lg border border-neutral-800 bg-neutral-900 p-4'
            aria-busy={commandSettingsQuery.isFetching || undefined}>
            <div className='flex flex-wrap items-start justify-between gap-3'>
                <div>
                    <h2 className='text-lg font-semibold text-white'>Command prefix</h2>
                    <p className='mt-2 text-sm leading-6 text-neutral-400'>
                        Current prefix:{' '}
                        <code className='rounded bg-neutral-950 px-1.5 py-0.5 text-sm text-sky-200'>
                            {liveCommandSettings.prefix}
                        </code>
                    </p>
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
                            const nextPrefix = event.currentTarget.value;

                            setFormState((currentState) => ({
                                ...currentState,
                                draftPrefix: nextPrefix,
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

export function DashboardCommandPrefixSettingsPanelLoading() {
    return (
        <article className='rounded-lg border border-neutral-800 bg-neutral-900 p-4' aria-busy='true'>
            <div className='flex flex-wrap items-start justify-between gap-3'>
                <div>
                    <h2 className='text-lg font-semibold text-white'>Command prefix</h2>
                    <p className='mt-2 text-sm leading-6 text-neutral-400'>Current prefix is loading.</p>
                </div>
                <span className='rounded-md border border-neutral-700 px-2 py-1 text-xs font-medium text-neutral-500'>
                    Loading
                </span>
            </div>
            <div className='mt-4 flex flex-col gap-3'>
                <label className='space-y-2 text-sm font-medium text-neutral-500'>
                    <span>New prefix</span>
                    <input
                        value=''
                        disabled
                        className='min-h-10 w-full rounded-md border border-neutral-800 bg-neutral-950 px-3 text-base text-neutral-500 outline-none'
                        aria-label='New prefix'
                    />
                </label>
                <div className='h-4 w-52 animate-pulse rounded bg-neutral-800' />
                <button
                    type='button'
                    disabled
                    className='inline-flex min-h-10 w-fit items-center rounded-md bg-neutral-700 px-4 text-sm font-semibold text-neutral-400'>
                    Save prefix
                </button>
            </div>
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

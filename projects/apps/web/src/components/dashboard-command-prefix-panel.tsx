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
            className='relative overflow-hidden rounded-[var(--dash-radius-panel)] border border-[rgba(56,189,248,0.34)] bg-[rgba(7,10,16,0.9)] p-4 shadow-[var(--dash-shadow-surface)] md:bg-[linear-gradient(135deg,rgba(56,189,248,0.12),rgba(167,139,250,0.08)_42%,rgba(7,10,16,0.88)_100%)] md:backdrop-blur-md'
            aria-busy={commandSettingsQuery.isFetching || undefined}>
            <div className='pointer-events-none absolute inset-x-0 top-0 h-px bg-[linear-gradient(90deg,rgba(0,229,255,0.8),rgba(255,43,214,0.52),rgba(255,234,0,0.34))]' />
            <div className='flex flex-wrap items-start justify-between gap-3'>
                <div>
                    <h2 className='text-xl font-semibold text-[var(--dash-text)]'>Command prefix</h2>
                    <p className='mt-2 text-[0.95rem] leading-6 text-[var(--dash-text-muted)]'>
                        Current prefix:{' '}
                        <code className='rounded-[var(--dash-radius-control)] border border-[rgba(56,189,248,0.28)] bg-[rgba(2,6,23,0.72)] px-1.5 py-0.5 text-sm font-semibold text-[var(--dash-primary)]'>
                            {liveCommandSettings.prefix}
                        </code>
                    </p>
                </div>
                {liveCommandSettings.prefix === DEFAULT_COMMAND_PREFIX ? (
                    <span className='rounded-[var(--dash-radius-control)] border border-[rgba(167,139,250,0.4)] bg-[rgba(167,139,250,0.12)] px-2 py-1 text-xs font-semibold text-violet-100'>
                        Default
                    </span>
                ) : null}
            </div>

            <form className='mt-4 flex flex-col gap-3' onSubmit={submitPrefixUpdate}>
                <label className='space-y-2 text-sm font-semibold text-[var(--dash-text)]'>
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
                        className='min-h-11 w-full rounded-[var(--dash-radius-control)] border border-[rgba(107,125,152,0.72)] bg-[rgba(2,6,23,0.76)] px-3 text-base text-[var(--dash-text)] transition outline-none placeholder:text-[var(--dash-text-subtle)] focus:border-[var(--dash-primary)] focus:shadow-[var(--dash-shadow-focus)]'
                        maxLength={6}
                        inputMode='text'
                        autoComplete='off'
                        aria-describedby='command-prefix-help command-prefix-message'
                    />
                </label>
                <p id='command-prefix-help' className='text-xs leading-5 text-[var(--dash-text-muted)]'>
                    Start with an allowed symbol, then use up to two more letters, numbers, or symbols.
                </p>
                <div className='flex flex-wrap items-center gap-3'>
                    <button
                        type='submit'
                        disabled={!canSubmit}
                        className='inline-flex min-h-10 items-center rounded-[var(--dash-radius-control)] bg-[var(--dash-primary)] px-4 text-sm font-semibold text-neutral-950 transition hover:bg-sky-300 focus-visible:shadow-[var(--dash-shadow-focus)] focus-visible:outline-none disabled:cursor-not-allowed disabled:bg-[var(--dash-surface-raised)] disabled:text-[var(--dash-text-disabled)]'>
                        {mutation.isPending ? 'Saving...' : 'Save prefix'}
                    </button>
                    <span
                        id='command-prefix-message'
                        role='status'
                        className={
                            displayedFormMessage?.type === 'success'
                                ? 'text-sm text-cyan-200'
                                : 'text-sm text-rose-200'
                        }>
                        {displayedFormMessage?.text}
                    </span>
                </div>
                {commandSettingsQuery.isError ? (
                    <p className='text-sm text-rose-200'>Could not refresh this setting.</p>
                ) : null}
            </form>
        </article>
    );
}

export function DashboardCommandPrefixSettingsPanelLoading() {
    return (
        <article
            className='relative overflow-hidden rounded-[var(--dash-radius-panel)] border border-[rgba(56,189,248,0.24)] bg-[rgba(7,10,16,0.9)] p-4 shadow-[var(--dash-shadow-surface)] md:bg-[linear-gradient(135deg,rgba(56,189,248,0.08),rgba(167,139,250,0.06)_42%,rgba(7,10,16,0.9)_100%)] md:backdrop-blur-md'
            aria-busy='true'>
            <div className='pointer-events-none absolute inset-x-0 top-0 h-px bg-[linear-gradient(90deg,rgba(0,229,255,0.6),rgba(255,43,214,0.42),rgba(255,234,0,0.24))]' />
            <div className='flex flex-wrap items-start justify-between gap-3'>
                <div>
                    <h2 className='text-xl font-semibold text-[var(--dash-text)]'>Command prefix</h2>
                    <p className='mt-2 text-sm leading-6 text-[var(--dash-text-muted)]'>Loading current prefix.</p>
                </div>
                <span className='rounded-[var(--dash-radius-control)] border border-[var(--dash-border)] px-2 py-1 text-xs font-medium text-[var(--dash-text-muted)]'>
                    Loading
                </span>
            </div>
            <div className='mt-4 flex flex-col gap-3'>
                <label className='space-y-2 text-sm font-medium text-[var(--dash-text-muted)]'>
                    <span>New prefix</span>
                    <input
                        value=''
                        disabled
                        className='min-h-11 w-full rounded-[var(--dash-radius-control)] border border-[var(--dash-border)] bg-[rgba(2,6,23,0.72)] px-3 text-base text-[var(--dash-text-muted)] outline-none'
                        aria-label='New prefix'
                    />
                </label>
                <div className='h-4 w-52 animate-pulse rounded bg-[var(--dash-surface-raised)]' />
                <button
                    type='button'
                    disabled
                    className='inline-flex min-h-10 w-fit items-center rounded-[var(--dash-radius-control)] bg-[var(--dash-surface-raised)] px-4 text-sm font-semibold text-[var(--dash-text-disabled)]'>
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

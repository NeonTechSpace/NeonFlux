import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
    COMMAND_PREFIX_INVALID_MESSAGE,
    DEFAULT_COMMAND_PREFIX,
    normalizeCommandPrefix,
} from '@neonflux/core/command-prefix';
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';

import { getDashboardCommandSettingsQueryKey } from '../dashboard-query-keys.js';
import type { DashboardCommandSettings } from '../server/dashboard-command-settings.server.js';
import {
    readDashboardCommandSettingsRouteData,
    updateDashboardCommandPrefixRouteData,
} from '../server/dashboard-guild-route-data.js';
import { dashboardFastTransition, dashboardInlineVariants, dashboardTactile } from './dashboard-motion.js';
import {
    dashboardFieldClassName,
    dashboardPrimaryActionClassName,
    DashboardStatus,
    DashboardSurface,
    DashboardToolbar,
} from './dashboard-ui.js';

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
                  type: 'warning' as const,
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
        <DashboardSurface
            as='section'
            aria-label='Command prefix setting'
            aria-busy={commandSettingsQuery.isFetching || undefined}>
            <DashboardToolbar
                summary={
                    liveCommandSettings.prefix === DEFAULT_COMMAND_PREFIX ? (
                        <span className='rounded-[var(--dash-radius-control)] border border-[var(--dash-border)] px-2 py-1 font-semibold text-[var(--dash-text-muted)]'>
                            Default prefix
                        </span>
                    ) : undefined
                }>
                <div>
                    <p className='text-xs font-semibold tracking-wide text-[var(--dash-text-subtle)] uppercase'>
                        Current prefix
                    </p>
                    <AnimatePresence initial={false} mode='popLayout'>
                        <motion.code
                            key={liveCommandSettings.prefix}
                            className='mt-1 block text-2xl font-semibold text-[var(--dash-primary)]'
                            variants={dashboardInlineVariants}
                            initial='initial'
                            animate='enter'
                            exit='exit'
                            transition={dashboardFastTransition}>
                            {liveCommandSettings.prefix}
                        </motion.code>
                    </AnimatePresence>
                </div>
            </DashboardToolbar>

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
                        className={`${dashboardFieldClassName} text-base`}
                        maxLength={6}
                        inputMode='text'
                        autoComplete='off'
                        aria-describedby={
                            displayedFormMessage ? 'command-prefix-help command-prefix-message' : 'command-prefix-help'
                        }
                    />
                </label>
                <p id='command-prefix-help' className='text-xs leading-5 text-[var(--dash-text-muted)]'>
                    Start with an allowed symbol, then use up to two more letters, numbers, or symbols.
                </p>
                <div className='flex flex-wrap items-center gap-3'>
                    <motion.button
                        type='submit'
                        disabled={!canSubmit}
                        className={`${dashboardPrimaryActionClassName} inline-flex items-center`}
                        {...dashboardTactile}>
                        {mutation.isPending ? 'Saving...' : 'Save prefix'}
                    </motion.button>
                </div>
                {displayedFormMessage ? (
                    <motion.div
                        key={`${displayedFormMessage.type}:${displayedFormMessage.text}`}
                        id='command-prefix-message'
                        variants={dashboardInlineVariants}
                        initial='initial'
                        animate='enter'
                        transition={dashboardFastTransition}>
                        <DashboardStatus
                            tone={getPrefixMessageTone(displayedFormMessage.type)}
                            actions={
                                displayedFormMessage.type === 'warning' ? (
                                    <motion.button
                                        type='button'
                                        onClick={() =>
                                            setFormState({
                                                draftPrefix: liveCommandSettings.prefix,
                                                draftBasePrefix: liveCommandSettings.prefix,
                                            })
                                        }
                                        className='min-h-9 rounded-[var(--dash-radius-control)] border border-[var(--dash-warning)] px-3 text-xs font-semibold text-[var(--dash-text)] transition hover:bg-[var(--dash-warning-soft)] focus-visible:shadow-[var(--dash-shadow-focus)] focus-visible:outline-none'
                                        {...dashboardTactile}>
                                        Use current prefix
                                    </motion.button>
                                ) : undefined
                            }>
                            {displayedFormMessage.text}
                        </DashboardStatus>
                    </motion.div>
                ) : null}
                {commandSettingsQuery.isError ? (
                    <motion.div
                        key='refresh-error'
                        variants={dashboardInlineVariants}
                        initial='initial'
                        animate='enter'
                        transition={dashboardFastTransition}>
                        <DashboardStatus tone='danger'>
                            Could not refresh this setting. The last confirmed value is shown.
                        </DashboardStatus>
                    </motion.div>
                ) : null}
            </form>
        </DashboardSurface>
    );
}

function getPrefixMessageTone(type: 'error' | 'success' | 'warning'): 'danger' | 'success' | 'warning' {
    switch (type) {
        case 'error':
            return 'danger';
        case 'success':
            return 'success';
        case 'warning':
            return 'warning';
    }
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

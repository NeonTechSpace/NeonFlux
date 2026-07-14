import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'motion/react';
import { useState } from 'react';
import type { FormEvent } from 'react';

import { getDashboardPostingChannelsQueryKey, getDashboardPostingOperationsQueryKey } from '../dashboard-query-keys.js';
import {
    postDashboardMessageRouteData,
    readDashboardPostingChannelsRouteData,
    readDashboardPostingOperationsRouteData,
} from '../server/dashboard-guild-route-data.js';
import type { DashboardPostingChannel } from '../server/dashboard-posting.server.js';
import { DashboardChannelPicker, formatDashboardChannelLabel } from './dashboard-channel-picker.js';
import {
    canRetryDashboardGuildRead,
    DashboardGuildReadError,
    readDashboardGuildReadFailureType,
} from './dashboard-guild-read-error.js';
import {
    DashboardEmbedBuilder,
    createEmptyDashboardEmbedDraft,
    normalizeDashboardEmbedDraft,
    parseDashboardEmbedJson,
} from './dashboard-embed-builder.js';
import type {
    DashboardEmbedDraft,
    DashboardEmbedMode,
    ParsedDashboardEmbedsResult,
} from './dashboard-embed-builder.js';
import {
    dashboardConfirmationTransition,
    dashboardConfirmationVariants,
    dashboardInlineVariants,
    dashboardSelectionTransition,
    dashboardTactile,
    dashboardViewTransition,
} from './dashboard-motion.js';
import { DashboardPostingTemplateControls } from './dashboard-posting-template-controls.js';
import { DashboardPostingPreview } from './dashboard-posting-preview.js';
import {
    DashboardPostingOperationHistory,
    getDashboardPostingOperationConfirmationMessage,
} from './dashboard-posting-operation-status.js';
import {
    dashboardFieldClassName,
    dashboardPrimaryActionClassName,
    DashboardStatus,
    DashboardSurface,
} from './dashboard-ui.js';

type PostingFormMessage = {
    type: 'error' | 'success' | 'warning';
    text: string;
};

export function DashboardPostingPanel({ guildId }: { guildId: string }) {
    const queryClient = useQueryClient();
    const [selectedChannelId, setSelectedChannelId] = useState('');
    const [channelSearch, setChannelSearch] = useState('');
    const [channelPickerOpen, setChannelPickerOpen] = useState(false);
    const [content, setContent] = useState('');
    const [embedMode, setEmbedMode] = useState<DashboardEmbedMode>('builder');
    const [embedDraft, setEmbedDraft] = useState<DashboardEmbedDraft>(createEmptyDashboardEmbedDraft);
    const [embedJson, setEmbedJson] = useState('');
    const [formMessage, setFormMessage] = useState<PostingFormMessage>();
    const [activeOperationId, setActiveOperationId] = useState<string>();
    const [acknowledgedUnknownId, setAcknowledgedUnknownId] = useState<string>();
    const [retryRequestKey, setRetryRequestKey] = useState<string>();
    const [channelsRetrying, setChannelsRetrying] = useState(false);
    const [operationsRetrying, setOperationsRetrying] = useState(false);
    const previewEmbedsResult = getActiveEmbeds({
        mode: embedMode,
        draft: embedDraft,
        json: embedJson,
    });
    const previewEmbeds = previewEmbedsResult.valid ? previewEmbedsResult.embeds : [];

    const channelsQuery = useQuery({
        queryKey: getDashboardPostingChannelsQueryKey(guildId),
        queryFn: async () => {
            const result = await readDashboardPostingChannelsRouteData({
                data: {
                    guildId,
                },
            });

            if (result.type !== 'channels') {
                throw new DashboardGuildReadError(result.type);
            }

            return result.channels;
        },
        staleTime: 30_000,
        retry: false,
    });

    const operationsQuery = useQuery({
        queryKey: getDashboardPostingOperationsQueryKey(guildId),
        queryFn: async () => {
            const result = await readDashboardPostingOperationsRouteData({ data: { guildId } });
            if (result.type !== 'operations') throw new DashboardGuildReadError(result.type);
            return result.operations;
        },
        refetchInterval: (query) =>
            query.state.data?.some((operation) => operation.status === 'queued' || operation.status === 'running')
                ? 2_000
                : false,
        retry: false,
    });
    const channelsFailureType = channelsQuery.isError
        ? readDashboardGuildReadFailureType(channelsQuery.error)
        : undefined;
    const operationsFailureType = operationsQuery.isError
        ? readDashboardGuildReadFailureType(operationsQuery.error)
        : undefined;
    const requestedActiveOperation = operationsQuery.data?.find((operation) => operation.id === activeOperationId);
    const latestOperation = operationsQuery.data?.[0];
    const latestUnresolvedOperation =
        latestOperation?.status === 'queued' ||
        latestOperation?.status === 'running' ||
        latestOperation?.status === 'unknown'
            ? latestOperation
            : undefined;
    const activeOperation = requestedActiveOperation ?? latestUnresolvedOperation;
    const unknownRequiresCheck = activeOperation?.status === 'unknown' && acknowledgedUnknownId !== activeOperation.id;
    const operationMessage: PostingFormMessage | undefined = activeOperation
        ? {
              type:
                  activeOperation.status === 'sent'
                      ? 'success'
                      : activeOperation.status === 'permanent_failure'
                        ? 'error'
                        : 'warning',
              text: getDashboardPostingOperationConfirmationMessage(
                  activeOperation,
                  getPostingChannelLabel(channelsQuery.data ?? [], activeOperation.requestedChannelId)
              ),
          }
        : undefined;
    const displayedFormMessage = operationMessage ?? formMessage;

    const mutation = useMutation({
        mutationFn: (payload: {
            channelId: string;
            channelLabel: string;
            content?: string;
            embeds: unknown[];
            requestKey: string;
        }) =>
            postDashboardMessageRouteData({
                data: {
                    guildId,
                    channelId: payload.channelId,
                    ...(payload.content ? { content: payload.content } : {}),
                    embeds: payload.embeds,
                    requestKey: payload.requestKey,
                },
            }),
        onSuccess: async (result, payload) => {
            switch (result.type) {
                case 'operation':
                    setRetryRequestKey(undefined);
                    setActiveOperationId(result.operation.id);
                    setAcknowledgedUnknownId(undefined);
                    setFormMessage({
                        type: result.operation.status === 'sent' ? 'success' : 'warning',
                        text: getDashboardPostingOperationConfirmationMessage(result.operation, payload.channelLabel),
                    });
                    await queryClient.invalidateQueries({
                        queryKey: getDashboardPostingOperationsQueryKey(guildId),
                    });
                    return;

                case 'invalid-message':
                    setRetryRequestKey(undefined);
                    setFormMessage({ type: 'error', text: result.message });
                    return;

                case 'auth-required':
                    setRetryRequestKey(undefined);
                    setFormMessage({ type: 'error', text: 'Sign in again before posting.' });
                    return;

                case 'not-found':
                    setRetryRequestKey(undefined);
                    setFormMessage({ type: 'error', text: 'This server is not available for this account.' });
                    return;

                case 'request-conflict':
                    setRetryRequestKey(undefined);
                    setFormMessage({ type: 'error', text: 'This posting attempt conflicts with an existing request.' });
                    return;

                case 'database-error':
                    setFormMessage({
                        type: 'warning',
                        text: 'Queueing could not be confirmed. Retry uses the same attempt so it cannot create a second queue item.',
                    });
                    return;

                case 'deployment-config-not-found':
                case 'guild-lookup-failed':
                    setRetryRequestKey(undefined);
                    setFormMessage({ type: 'error', text: 'Could not post this message. Try again.' });
                    return;
            }
        },
        onError: () => {
            setFormMessage({
                type: 'warning',
                text: 'Queueing could not be confirmed. Retry uses the same attempt so it cannot create a second queue item.',
            });
        },
    });

    function submitMessage(event: FormEvent<HTMLFormElement>): void {
        event.preventDefault();

        const parsedEmbeds = getActiveEmbeds({
            mode: embedMode,
            draft: embedDraft,
            json: embedJson,
        });

        if (!parsedEmbeds.valid) {
            setFormMessage({ type: 'error', text: parsedEmbeds.message });
            return;
        }

        const trimmedChannelId = selectedChannelId.trim();
        const trimmedContent = content.trim();

        if (!trimmedChannelId) {
            setFormMessage({ type: 'error', text: 'Choose a channel before sending.' });
            return;
        }

        if (!trimmedContent && parsedEmbeds.embeds.length === 0) {
            setFormMessage({ type: 'error', text: 'Add message content or at least one embed.' });
            return;
        }

        const requestKey = retryRequestKey ?? crypto.randomUUID();
        setRetryRequestKey(requestKey);
        mutation.mutate({
            channelId: trimmedChannelId,
            channelLabel: getPostingChannelLabel(channelsQuery.data ?? [], trimmedChannelId),
            ...(trimmedContent ? { content: trimmedContent } : {}),
            embeds: parsedEmbeds.embeds,
            requestKey,
        });
    }

    return (
        <form
            className='grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(22rem,0.8fr)]'
            onSubmit={submitMessage}
            aria-busy={mutation.isPending}>
            <DashboardSurface as='section' tone='glass' className='space-y-5' aria-label='Message composer'>
                <DashboardChannelPicker
                    channels={channelsQuery.data ?? []}
                    hasError={channelsQuery.isError || channelsRetrying}
                    errorMessage={getChannelLoadErrorMessage(channelsFailureType ?? 'database-error')}
                    isLoading={channelsQuery.isPending && !channelsRetrying}
                    isRetrying={channelsRetrying}
                    isOpen={channelPickerOpen}
                    search={channelSearch}
                    selectedChannelId={selectedChannelId}
                    onBlur={() => setChannelPickerOpen(false)}
                    onFocus={() => setChannelPickerOpen(true)}
                    onRetry={
                        channelsRetrying || (channelsFailureType && canRetryDashboardGuildRead(channelsFailureType))
                            ? () => {
                                  if (channelsRetrying) return;
                                  setChannelsRetrying(true);
                                  void channelsQuery.refetch().finally(() => setChannelsRetrying(false));
                              }
                            : undefined
                    }
                    onSearchChange={(nextSearch) => {
                        setChannelSearch(nextSearch);
                        setSelectedChannelId('');
                        setChannelPickerOpen(true);
                        setFormMessage(undefined);
                    }}
                    onSelect={(channel) => {
                        setSelectedChannelId(channel.id);
                        setChannelSearch(formatDashboardChannelLabel(channel));
                        setChannelPickerOpen(false);
                        setFormMessage(undefined);
                    }}
                />

                <label className='space-y-2 text-sm font-medium text-[var(--dash-text)]'>
                    <span>Message content</span>
                    <textarea
                        value={content}
                        onChange={(event) => {
                            setContent(event.currentTarget.value);
                            setFormMessage(undefined);
                        }}
                        className={fieldClassName}
                        placeholder='Write the message NeonFlux should send.'
                    />
                </label>

                <fieldset className='space-y-3'>
                    <legend className='text-sm font-medium text-[var(--dash-text)]'>Embed editor</legend>
                    <div className='flex flex-wrap gap-2' role='radiogroup' aria-label='Embed editor'>
                        <EmbedModeOption
                            mode='builder'
                            currentMode={embedMode}
                            label='Visual builder'
                            onChange={(mode) => {
                                setEmbedMode(mode);
                                setFormMessage(undefined);
                            }}
                        />
                        <EmbedModeOption
                            mode='advanced-json'
                            currentMode={embedMode}
                            label='Advanced JSON'
                            onChange={(mode) => {
                                setEmbedMode(mode);
                                setFormMessage(undefined);
                            }}
                        />
                    </div>
                </fieldset>

                <AnimatePresence initial={false} mode='popLayout'>
                    {embedMode === 'builder' ? (
                        <motion.div
                            key='builder'
                            data-dashboard-motion='view-change'
                            variants={dashboardInlineVariants}
                            initial='initial'
                            animate='enter'
                            exit='exit'
                            transition={dashboardViewTransition}>
                            <DashboardEmbedBuilder
                                draft={embedDraft}
                                onDraftChange={(nextDraft) => {
                                    setEmbedDraft(nextDraft);
                                    setFormMessage(undefined);
                                }}
                            />
                        </motion.div>
                    ) : (
                        <motion.label
                            key='advanced-json'
                            data-dashboard-motion='view-change'
                            className='block space-y-2 text-sm font-medium text-[var(--dash-text)]'
                            variants={dashboardInlineVariants}
                            initial='initial'
                            animate='enter'
                            exit='exit'
                            transition={dashboardViewTransition}>
                            <span>Embed JSON</span>
                            <textarea
                                value={embedJson}
                                onChange={(event) => {
                                    setEmbedJson(event.currentTarget.value);
                                    setFormMessage(undefined);
                                }}
                                className={`${fieldClassName} min-h-48 font-mono text-sm`}
                                placeholder='[{"title":"NeonFlux","description":"Fluxer update"}]'
                                spellCheck={false}
                            />
                        </motion.label>
                    )}
                </AnimatePresence>

                <DashboardPostingTemplateControls
                    guildId={guildId}
                    content={content}
                    embeds={previewEmbeds}
                    payloadError={previewEmbedsResult.valid ? undefined : previewEmbedsResult.message}
                    onApplyTemplate={(template) => {
                        setContent(template.content ?? '');
                        setEmbedMode('advanced-json');
                        setEmbedDraft(createEmptyDashboardEmbedDraft());
                        setEmbedJson(template.embeds.length > 0 ? JSON.stringify(template.embeds, null, 2) : '');
                        setFormMessage({ type: 'success', text: `Template applied: ${template.name}.` });
                    }}
                    onMessage={setFormMessage}
                />
            </DashboardSurface>

            <aside className='min-w-0 space-y-4 xl:sticky xl:top-4 xl:self-start' aria-label='Preview and delivery'>
                <DashboardPostingPreview content={content} embeds={previewEmbeds} />
                <DashboardSurface as='section' tone='glass' padding='compact' aria-label='Message delivery'>
                    <div className='flex flex-wrap items-center gap-3'>
                        <motion.button
                            type='submit'
                            disabled={
                                mutation.isPending ||
                                activeOperation?.status === 'queued' ||
                                activeOperation?.status === 'running' ||
                                unknownRequiresCheck
                            }
                            className={primaryButtonClassName}
                            {...dashboardTactile}>
                            {mutation.isPending ? 'Queueing…' : 'Queue message'}
                        </motion.button>
                    </div>
                    <AnimatePresence initial={false} mode='popLayout'>
                        {displayedFormMessage ? (
                            <motion.div
                                key={`${displayedFormMessage.type}:${displayedFormMessage.text}`}
                                data-dashboard-motion='confirmation'
                                className='mt-3'
                                variants={dashboardConfirmationVariants}
                                initial='initial'
                                animate='enter'
                                transition={dashboardConfirmationTransition}>
                                <DashboardStatus tone={getFormMessageTone(displayedFormMessage.type)}>
                                    {displayedFormMessage.text}
                                </DashboardStatus>
                            </motion.div>
                        ) : (
                            <motion.p
                                key='delivery-help'
                                data-dashboard-motion='confirmation'
                                className='mt-3 text-xs leading-5 text-[var(--dash-text-subtle)]'
                                variants={dashboardConfirmationVariants}
                                initial='initial'
                                animate='enter'
                                transition={dashboardConfirmationTransition}>
                                Queueing is durable. You can leave this page while the connected bot delivers the
                                message.
                            </motion.p>
                        )}
                    </AnimatePresence>
                    {activeOperation?.status === 'unknown' ? (
                        <label className='mt-3 flex items-start gap-2 text-xs leading-5 text-[var(--dash-text-muted)]'>
                            <input
                                type='checkbox'
                                className='mt-1'
                                checked={acknowledgedUnknownId === activeOperation.id}
                                onChange={(event) => {
                                    setAcknowledgedUnknownId(
                                        event.currentTarget.checked ? activeOperation.id : undefined
                                    );
                                }}
                            />
                            <span>
                                I checked the channel and accept that another attempt could still create a duplicate.
                            </span>
                        </label>
                    ) : null}
                    <DashboardPostingOperationHistory
                        channels={channelsQuery.data ?? []}
                        operations={operationsQuery.data ?? []}
                        hasError={operationsQuery.isError || operationsRetrying}
                        errorMessage={getOperationLoadErrorMessage(operationsFailureType ?? 'database-error')}
                        isPending={operationsQuery.isPending && !operationsRetrying}
                        isRetrying={operationsRetrying}
                        onRetry={
                            operationsRetrying ||
                            (operationsFailureType && canRetryDashboardGuildRead(operationsFailureType))
                                ? () => {
                                      if (operationsRetrying) return;
                                      setOperationsRetrying(true);
                                      void operationsQuery.refetch().finally(() => setOperationsRetrying(false));
                                  }
                                : undefined
                        }
                    />
                </DashboardSurface>
            </aside>
        </form>
    );
}

function EmbedModeOption({
    mode,
    currentMode,
    label,
    onChange,
}: {
    mode: DashboardEmbedMode;
    currentMode: DashboardEmbedMode;
    label: string;
    onChange: (mode: DashboardEmbedMode) => void;
}) {
    return (
        <label
            data-dashboard-motion='selection-gel'
            className={
                currentMode === mode
                    ? 'relative inline-flex min-h-10 items-center overflow-hidden rounded-[var(--dash-radius-control)] border border-[var(--dash-primary)] px-3 text-sm font-semibold text-[var(--dash-text)]'
                    : 'relative inline-flex min-h-10 items-center overflow-hidden rounded-[var(--dash-radius-control)] border border-[var(--dash-border-interactive)] px-3 text-sm font-semibold text-[var(--dash-text-muted)] transition hover:border-[var(--dash-primary)] hover:text-[var(--dash-text)]'
            }>
            {currentMode === mode ? (
                <motion.span
                    layoutId='dashboard-posting-embed-mode-gel'
                    data-dashboard-motion='selection-gel'
                    className='absolute inset-0 bg-[var(--dash-primary-ring)]'
                    transition={dashboardSelectionTransition}
                    aria-hidden='true'
                />
            ) : null}
            <span className='relative'>{label}</span>
            <span className='sr-only'>
                <input
                    type='radio'
                    name='dashboard-posting-embed-mode'
                    value={mode}
                    checked={currentMode === mode}
                    onChange={() => onChange(mode)}
                />
            </span>
        </label>
    );
}

function getPostingChannelLabel(channels: DashboardPostingChannel[], channelId: string): string {
    const channel = channels.find((candidate) => candidate.id === channelId);

    return channel ? formatDashboardChannelLabel(channel) : 'the selected channel';
}

function getChannelLoadErrorMessage(type: string): string {
    switch (type) {
        case 'bot-token-missing':
            return 'Dashboard posting is not configured for this deployment.';

        case 'auth-required':
            return 'Sign in again before posting.';

        case 'not-found':
            return 'This server is not available for this account.';

        case 'deployment-config-not-found':
        case 'database-error':
        case 'guild-lookup-failed':
        default:
            return 'Could not load channels.';
    }
}

function getOperationLoadErrorMessage(type: string): string {
    switch (type) {
        case 'auth-required':
            return 'Sign in again to load recent delivery status.';
        case 'not-found':
            return 'Recent delivery status is unavailable because this server is no longer accessible.';
        case 'deployment-config-not-found':
            return 'Recent delivery status is unavailable because this deployment is not fully configured.';
        case 'database-error':
        case 'guild-lookup-failed':
            return 'Recent delivery status could not be loaded.';
        default:
            return 'Recent delivery status is unavailable.';
    }
}

function getActiveEmbeds({
    mode,
    draft,
    json,
}: {
    mode: DashboardEmbedMode;
    draft: DashboardEmbedDraft;
    json: string;
}): ParsedDashboardEmbedsResult {
    if (mode === 'advanced-json') {
        return parseDashboardEmbedJson(json);
    }

    const embedResult = normalizeDashboardEmbedDraft(draft);

    if (!embedResult.valid) {
        return embedResult;
    }

    return {
        valid: true,
        embeds: embedResult.embed ? [embedResult.embed] : [],
    };
}

function getFormMessageTone(type: PostingFormMessage['type']): 'danger' | 'success' | 'warning' {
    switch (type) {
        case 'success':
            return 'success';

        case 'warning':
            return 'warning';

        case 'error':
            return 'danger';
    }
}

const fieldClassName = `${dashboardFieldClassName} min-h-28 resize-y py-2 text-base`;
const primaryButtonClassName = `${dashboardPrimaryActionClassName} inline-flex items-center justify-center`;

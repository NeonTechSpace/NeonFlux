import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { DASHBOARD_MESSAGE_MENTION_POLICY } from '@neonflux/messaging';
import type { OutgoingEmbed } from '@neonflux/messaging';
import { AnimatePresence, motion } from 'motion/react';
import { useState } from 'react';
import type { FormEvent } from 'react';

import { getDashboardPostingChannelsQueryKey, getDashboardPostingOperationsQueryKey } from '../dashboard-query-keys.js';
import {
    postDashboardMessageRouteData,
    readDashboardPostingChannelsRouteData,
    readDashboardPostingOperationsRouteData,
    resolveDashboardPostingUnknownRouteData,
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
    toDashboardEmbedDraft,
} from './dashboard-embed-builder.js';
import type { DashboardEmbedDraft } from './dashboard-embed-builder.js';
import {
    dashboardConfirmationTransition,
    dashboardConfirmationVariants,
    dashboardTactile,
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
    dashboardSecondaryActionClassName,
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
    const [embedDraft, setEmbedDraft] = useState<DashboardEmbedDraft>(createEmptyDashboardEmbedDraft);
    const [formMessage, setFormMessage] = useState<PostingFormMessage>();
    const [activeOperationId, setActiveOperationId] = useState<string>();
    const [retryRequestKey, setRetryRequestKey] = useState<string>();
    const [channelsRetrying, setChannelsRetrying] = useState(false);
    const [operationsRetrying, setOperationsRetrying] = useState(false);
    const previewEmbedResult = normalizeDashboardEmbedDraft(embedDraft);
    const previewEmbeds = previewEmbedResult.valid && previewEmbedResult.embed ? [previewEmbedResult.embed] : [];

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
    const latestUnresolvedOperation = operationsQuery.data?.find(
        (operation) =>
            operation.status === 'queued' ||
            operation.status === 'running' ||
            (operation.status === 'unknown' && !operation.resolution)
    );
    const activeOperation = requestedActiveOperation ?? latestUnresolvedOperation;
    const unknownRequiresResolution = activeOperation?.status === 'unknown' && !activeOperation.resolution;
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
            embeds: OutgoingEmbed[];
            requestKey: string;
            retryOfOperationId?: string;
        }) =>
            postDashboardMessageRouteData({
                data: {
                    guildId,
                    channelId: payload.channelId,
                    ...(payload.content ? { content: payload.content } : {}),
                    embeds: payload.embeds,
                    requestKey: payload.requestKey,
                    ...(payload.retryOfOperationId ? { retryOfOperationId: payload.retryOfOperationId } : {}),
                },
            }),
        onSuccess: async (result, payload) => {
            switch (result.type) {
                case 'operation':
                    setRetryRequestKey(undefined);
                    setActiveOperationId(result.operation.id);
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
                        text: 'The send request could not be confirmed. Retry uses the same attempt so it cannot create a second queue item.',
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
                text: 'The send request could not be confirmed. Retry uses the same attempt so it cannot create a second queue item.',
            });
        },
    });

    const resolutionMutation = useMutation({
        mutationFn: (input: { operationId: string; resolution: 'reported_not_seen' | 'reported_seen' }) =>
            resolveDashboardPostingUnknownRouteData({ data: { guildId, ...input } }),
        onSuccess: async (result) => {
            if (result.type === 'resolved') {
                setFormMessage({
                    type: 'success',
                    text:
                        result.operation.resolution === 'reported_seen'
                            ? 'Recorded that you found the message.'
                            : 'Recorded that you did not find the message.',
                });
                setActiveOperationId(undefined);
                await queryClient.invalidateQueries({ queryKey: getDashboardPostingOperationsQueryKey(guildId) });
                return;
            }
            setFormMessage({
                type: result.type === 'resolution-conflict' ? 'warning' : 'error',
                text:
                    result.type === 'resolution-conflict'
                        ? 'This delivery was already resolved differently. Refresh recent delivery.'
                        : 'Could not record the delivery check. Try again.',
            });
        },
        onError: () => setFormMessage({ type: 'error', text: 'Could not record the delivery check. Try again.' }),
    });

    function submitMessage(event: FormEvent<HTMLFormElement>): void {
        event.preventDefault();
        sendMessage();
    }

    function sendMessage(retryOfOperationId?: string): void {
        const parsedEmbed = normalizeDashboardEmbedDraft(embedDraft);

        if (!parsedEmbed.valid) {
            setFormMessage({ type: 'error', text: parsedEmbed.message });
            return;
        }

        const trimmedChannelId = selectedChannelId.trim();
        const trimmedContent = content.trim();

        if (!trimmedChannelId) {
            setFormMessage({ type: 'error', text: 'Choose a channel before sending.' });
            return;
        }

        const embeds = parsedEmbed.embed ? [parsedEmbed.embed] : [];
        if (!trimmedContent && embeds.length === 0) {
            setFormMessage({ type: 'error', text: 'Add message content or at least one embed.' });
            return;
        }

        const requestKey = retryOfOperationId ? crypto.randomUUID() : (retryRequestKey ?? crypto.randomUUID());
        setRetryRequestKey(retryOfOperationId ? undefined : requestKey);
        mutation.mutate({
            channelId: trimmedChannelId,
            channelLabel: getPostingChannelLabel(channelsQuery.data ?? [], trimmedChannelId),
            ...(trimmedContent ? { content: trimmedContent } : {}),
            embeds,
            requestKey,
            ...(retryOfOperationId ? { retryOfOperationId } : {}),
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

                <div className='space-y-3'>
                    <h3 className='text-sm font-medium text-[var(--dash-text)]'>Embed editor</h3>
                    <DashboardEmbedBuilder
                        draft={embedDraft}
                        onDraftChange={(nextDraft) => {
                            setEmbedDraft(nextDraft);
                            setFormMessage(undefined);
                        }}
                    />
                </div>

                <DashboardPostingTemplateControls
                    guildId={guildId}
                    content={content}
                    embeds={previewEmbeds}
                    payloadError={previewEmbedResult.valid ? undefined : previewEmbedResult.message}
                    onApplyTemplate={(template) => {
                        setContent(template.content ?? '');
                        setEmbedDraft(toDashboardEmbedDraft(template.embeds[0]));
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
                                unknownRequiresResolution
                            }
                            className={primaryButtonClassName}
                            {...dashboardTactile}>
                            {mutation.isPending ? 'Sending…' : 'Send message'}
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
                                Sending is durable. You can leave this page while the connected bot delivers the
                                message.
                            </motion.p>
                        )}
                    </AnimatePresence>
                    <p className='mt-3 text-xs leading-5 text-[var(--dash-text-subtle)]'>{getMentionPolicyNotice()}</p>
                    {activeOperation?.status === 'unknown' && !activeOperation.resolution ? (
                        <div className='mt-3 space-y-2' aria-label='Resolve unknown delivery'>
                            <p className='text-xs leading-5 text-[var(--dash-text-muted)]'>
                                Record what you found after checking the channel. This reports your observation; it does
                                not rewrite the provider outcome.
                            </p>
                            <div className='flex flex-wrap gap-2'>
                                <button
                                    type='button'
                                    disabled={resolutionMutation.isPending || mutation.isPending}
                                    onClick={() =>
                                        resolutionMutation.mutate({
                                            operationId: activeOperation.id,
                                            resolution: 'reported_seen',
                                        })
                                    }
                                    className={dashboardSecondaryActionClassName}>
                                    I found the message
                                </button>
                                <button
                                    type='button'
                                    disabled={resolutionMutation.isPending || mutation.isPending}
                                    onClick={() =>
                                        resolutionMutation.mutate({
                                            operationId: activeOperation.id,
                                            resolution: 'reported_not_seen',
                                        })
                                    }
                                    className={dashboardSecondaryActionClassName}>
                                    I did not find it
                                </button>
                                <button
                                    type='button'
                                    disabled={resolutionMutation.isPending || mutation.isPending}
                                    onClick={() => sendMessage(activeOperation.id)}
                                    className={dashboardSecondaryActionClassName}>
                                    Send a new copy despite duplicate risk
                                </button>
                            </div>
                        </div>
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

function getMentionPolicyNotice(): string {
    return DASHBOARD_MESSAGE_MENTION_POLICY.notice;
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

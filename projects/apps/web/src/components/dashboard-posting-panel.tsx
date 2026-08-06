import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { DASHBOARD_MESSAGE_MENTION_POLICY, OUTGOING_MESSAGE_LIMITS } from '@neonflux/messaging';
import type { OutgoingEmbed } from '@neonflux/messaging';
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useId, useRef, useState } from 'react';
import type { FormEvent } from 'react';

import { getDashboardPostingCatalogQueryKey, getDashboardPostingOperationsQueryKey } from '../dashboard-query-keys.js';
import {
    postDashboardMessageRouteData,
    readDashboardPostingCatalogRouteData,
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
    dashboardPostingOperationRefetchInterval,
    isDashboardLiveHealthy,
    useDashboardLive,
} from './dashboard-live-provider.js';
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
    const { status: liveStatus } = useDashboardLive();
    const liveInvalidationHealthy = isDashboardLiveHealthy(liveStatus);
    const previousLiveInvalidationHealthyRef = useRef(liveInvalidationHealthy);
    const messageContentId = useId();
    const previewRef = useRef<HTMLElement>(null);
    const [selectedChannelId, setSelectedChannelId] = useState('');
    const [channelSearch, setChannelSearch] = useState('');
    const [channelPickerOpen, setChannelPickerOpen] = useState(false);
    const [content, setContent] = useState('');
    const [embedDraft, setEmbedDraft] = useState<DashboardEmbedDraft>(createEmptyDashboardEmbedDraft);
    const [embedEditorOpen, setEmbedEditorOpen] = useState(false);
    const [formMessage, setFormMessage] = useState<PostingFormMessage>();
    const [activeOperationId, setActiveOperationId] = useState<string>();
    const [retryRequestKey, setRetryRequestKey] = useState<string>();
    const [channelsRetrying, setChannelsRetrying] = useState(false);
    const [operationsRetrying, setOperationsRetrying] = useState(false);
    const previewEmbedResult = normalizeDashboardEmbedDraft(embedDraft);
    const previewEmbeds = previewEmbedResult.valid && previewEmbedResult.embed ? [previewEmbedResult.embed] : [];

    const postingCatalogQuery = useQuery({
        queryKey: getDashboardPostingCatalogQueryKey(guildId),
        queryFn: async () => {
            const result = await readDashboardPostingCatalogRouteData({
                data: {
                    guildId,
                },
            });

            if (result.type !== 'catalog') {
                throw new DashboardGuildReadError(result.type);
            }

            return result.catalog;
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
            dashboardPostingOperationRefetchInterval(
                liveStatus,
                Boolean(
                    query.state.data?.some(
                        (operation) => operation.status === 'queued' || operation.status === 'running'
                    )
                )
            ),
        retry: false,
    });
    useEffect(() => {
        const reconnected = liveInvalidationHealthy && previousLiveInvalidationHealthyRef.current === false;
        previousLiveInvalidationHealthyRef.current = liveInvalidationHealthy;
        if (reconnected) {
            void queryClient.invalidateQueries({ queryKey: getDashboardPostingOperationsQueryKey(guildId) });
        }
    }, [guildId, liveInvalidationHealthy, queryClient]);
    const channelsFailureType = postingCatalogQuery.isError
        ? readDashboardGuildReadFailureType(postingCatalogQuery.error)
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
    const selectedChannelLabel = selectedChannelId
        ? getPostingChannelLabel(postingCatalogQuery.data?.channels ?? [], selectedChannelId)
        : undefined;
    const embedConfigured = hasEmbedDraftContent(embedDraft);
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
                  getPostingChannelLabel(postingCatalogQuery.data?.channels ?? [], activeOperation.requestedChannelId)
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
                    setFormMessage({
                        type: 'error',
                        text: 'A send request with this ID already exists. Refresh recent delivery before trying again.',
                    });
                    return;

                case 'database-error':
                    setFormMessage({
                        type: 'warning',
                        text: 'NeonFlux could not confirm whether the send request was saved. Retrying is safe because it reuses the same request.',
                    });
                    return;

                case 'deployment-config-not-found':
                    setRetryRequestKey(undefined);
                    setFormMessage({
                        type: 'error',
                        text: 'NeonFlux deployment settings are missing. Run the deployment setup before sending messages.',
                    });
                    return;

                case 'guild-lookup-failed':
                    setRetryRequestKey(undefined);
                    setFormMessage({
                        type: 'error',
                        text: 'NeonFlux could not verify this server with Fluxer. Check the bot connection and permissions, then try again.',
                    });
                    return;
            }
        },
        onError: () => {
            setFormMessage({
                type: 'warning',
                text: 'The connection ended before NeonFlux could confirm the send request. Retrying is safe because it reuses the same request.',
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
                        : getResolutionErrorMessage(result.type),
            });
        },
        onError: () =>
            setFormMessage({
                type: 'error',
                text: 'The connection ended before NeonFlux could record your check. Try again.',
            }),
    });
    const sendDisabled =
        mutation.isPending ||
        activeOperation?.status === 'queued' ||
        activeOperation?.status === 'running' ||
        unknownRequiresResolution;

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
            channelLabel: getPostingChannelLabel(postingCatalogQuery.data?.channels ?? [], trimmedChannelId),
            ...(trimmedContent ? { content: trimmedContent } : {}),
            embeds,
            requestKey,
            ...(retryOfOperationId ? { retryOfOperationId } : {}),
        });
    }

    return (
        <form
            className='grid min-w-0 gap-4 pb-24 xl:grid-cols-[minmax(0,1.2fr)_minmax(22rem,0.8fr)] xl:pb-0'
            onSubmit={submitMessage}
            aria-busy={mutation.isPending}>
            <div
                className='fixed inset-x-3 bottom-3 z-50 flex items-center gap-2 rounded-[var(--dash-radius-panel)] border border-[var(--dash-border-interactive)] bg-[rgba(7,11,18,0.94)] p-2 shadow-[var(--dash-shadow-popover)] backdrop-blur xl:hidden'
                aria-label='Mobile message actions'>
                <button
                    type='button'
                    onClick={() => previewRef.current?.scrollIntoView({ block: 'start' })}
                    className={`${dashboardSecondaryActionClassName} flex-1`}>
                    Preview
                </button>
                <motion.button
                    type='submit'
                    aria-label='Send current message'
                    disabled={sendDisabled}
                    className={`${primaryButtonClassName} flex-1`}
                    {...dashboardTactile}>
                    {mutation.isPending ? 'Sending…' : 'Send'}
                </motion.button>
            </div>
            <DashboardSurface as='section' tone='glass' className='space-y-5' aria-label='Message composer'>
                <DashboardChannelPicker
                    channels={postingCatalogQuery.data?.channels ?? []}
                    hasError={postingCatalogQuery.isError || channelsRetrying}
                    errorMessage={getChannelLoadErrorMessage(channelsFailureType ?? 'database-error')}
                    isLoading={postingCatalogQuery.isPending && !channelsRetrying}
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
                                  void postingCatalogQuery.refetch().finally(() => setChannelsRetrying(false));
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

                <DashboardPostingTemplateControls
                    guildId={guildId}
                    content={content}
                    embeds={previewEmbeds}
                    payloadError={previewEmbedResult.valid ? undefined : previewEmbedResult.message}
                    onApplyTemplate={(template) => {
                        const nextEmbedDraft = toDashboardEmbedDraft(template.embeds[0]);
                        setContent(template.content ?? '');
                        setEmbedDraft(nextEmbedDraft);
                        setEmbedEditorOpen(hasEmbedDraftContent(nextEmbedDraft));
                        setFormMessage({ type: 'success', text: `Template applied: ${template.name}.` });
                    }}
                    onMessage={setFormMessage}
                />

                <div className='space-y-2 text-sm font-medium text-[var(--dash-text)]'>
                    <div className='flex items-center justify-between gap-3'>
                        <label htmlFor={messageContentId}>Message content</label>
                        <span
                            aria-hidden='true'
                            className='text-xs font-normal text-[var(--dash-text-subtle)] tabular-nums'>
                            {content.length.toLocaleString('en-US')} /{' '}
                            {OUTGOING_MESSAGE_LIMITS.content.toLocaleString('en-US')}
                        </span>
                    </div>
                    <textarea
                        id={messageContentId}
                        value={content}
                        onChange={(event) => {
                            setContent(event.currentTarget.value);
                            setFormMessage(undefined);
                        }}
                        maxLength={OUTGOING_MESSAGE_LIMITS.content}
                        className={fieldClassName}
                        placeholder='Write the message NeonFlux should send.'
                    />
                </div>

                <div className='space-y-3'>
                    <div className='flex flex-wrap items-center justify-between gap-3'>
                        <div>
                            <h3 className='text-sm font-semibold text-[var(--dash-text)]'>Embed</h3>
                            <p className='mt-1 text-xs text-[var(--dash-text-muted)]'>
                                Optional rich content for announcements, media, and structured details.
                            </p>
                        </div>
                        <motion.button
                            type='button'
                            aria-expanded={embedEditorOpen}
                            onClick={() => setEmbedEditorOpen((open) => !open)}
                            className={dashboardSecondaryActionClassName}
                            {...dashboardTactile}>
                            {embedEditorOpen ? 'Hide embed editor' : embedConfigured ? 'Edit embed' : 'Add embed'}
                        </motion.button>
                    </div>
                    {embedEditorOpen ? (
                        <div className='rounded-[var(--dash-radius-control)] border border-[var(--dash-border)] bg-[var(--dash-surface-muted)] p-3'>
                            <DashboardEmbedBuilder
                                draft={embedDraft}
                                onDraftChange={(nextDraft) => {
                                    setEmbedDraft(nextDraft);
                                    setFormMessage(undefined);
                                }}
                            />
                        </div>
                    ) : embedConfigured ? (
                        <p className='text-xs text-[var(--dash-text-muted)]'>An embed is configured and included.</p>
                    ) : null}
                    {!previewEmbedResult.valid ? (
                        <DashboardStatus tone='danger'>{previewEmbedResult.message}</DashboardStatus>
                    ) : null}
                </div>
            </DashboardSurface>

            <aside
                ref={previewRef}
                className='min-w-0 scroll-mt-4 space-y-4 xl:sticky xl:top-4 xl:self-start'
                aria-label='Preview and delivery'>
                <DashboardPostingPreview
                    content={content}
                    embeds={previewEmbeds}
                    emojis={postingCatalogQuery.data?.emojis ?? []}
                    channelLabel={selectedChannelLabel}
                    channels={postingCatalogQuery.data?.channels ?? []}
                    roles={postingCatalogQuery.data?.roles ?? []}
                />
                <DashboardSurface as='section' tone='glass' padding='compact' aria-label='Message delivery'>
                    <div className='hidden xl:flex xl:items-center xl:gap-2'>
                        <motion.button
                            type='submit'
                            disabled={sendDisabled}
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
                                Delivery continues through the connected bot if you leave this page.
                            </motion.p>
                        )}
                    </AnimatePresence>
                    <p className='mt-3 text-xs leading-5 text-[var(--dash-text-subtle)]'>{getMentionPolicyNotice()}</p>
                    {activeOperation?.status === 'unknown' && !activeOperation.resolution ? (
                        <div className='mt-3 space-y-2' aria-label='Resolve unknown delivery'>
                            <p className='text-xs leading-5 text-[var(--dash-text-muted)]'>
                                Check the channel and record what you find. NeonFlux cannot change the original delivery
                                result after Fluxer stops responding.
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
                        channels={postingCatalogQuery.data?.channels ?? []}
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

function hasEmbedDraftContent(draft: DashboardEmbedDraft): boolean {
    return (
        draft.includeTimestamp ||
        Object.entries(draft).some(
            ([key, value]) => key !== 'includeTimestamp' && typeof value === 'string' && value.trim()
        )
    );
}

function getChannelLoadErrorMessage(type: string): string {
    switch (type) {
        case 'bot-token-missing':
            return 'NeonFlux cannot authenticate with the bot service. Check the bot and web service key configuration.';

        case 'auth-required':
            return 'Sign in again before posting.';

        case 'not-found':
            return 'This server is not available for this account.';

        case 'deployment-config-not-found':
            return 'NeonFlux deployment settings are missing. Run the deployment setup before loading channels.';
        case 'database-error':
            return 'NeonFlux could not load channels from Convex. Check the deployment and retry.';
        case 'guild-lookup-failed':
            return 'NeonFlux could not load channels from Fluxer. Check the bot connection and permissions, then retry.';
        default:
            return 'NeonFlux could not load channels. Check your connection and retry.';
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
            return 'NeonFlux could not load recent delivery from Convex. Check the deployment and retry.';
        case 'guild-lookup-failed':
            return 'NeonFlux could not verify this server with Fluxer. Check the bot connection and permissions, then retry.';
        default:
            return 'Recent delivery status is unavailable.';
    }
}

function getResolutionErrorMessage(type: string): string {
    switch (type) {
        case 'auth-required':
            return 'Sign in again before recording the delivery check.';
        case 'not-found':
            return 'This delivery or server is no longer available. Refresh recent delivery.';
        case 'deployment-config-not-found':
            return 'NeonFlux deployment settings are missing. Run the deployment setup before recording the check.';
        case 'database-error':
            return 'NeonFlux could not save the delivery check to Convex. Check the deployment and try again.';
        case 'guild-lookup-failed':
            return 'NeonFlux could not verify this server with Fluxer. Check the bot connection and permissions, then try again.';
        default:
            return 'NeonFlux could not record the delivery check. Try again.';
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

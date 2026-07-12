import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'motion/react';
import { useState } from 'react';
import type { FormEvent } from 'react';

import { getDashboardAuditEventsBaseQueryKey, getDashboardPostingChannelsQueryKey } from '../dashboard-query-keys.js';
import {
    postDashboardMessageRouteData,
    readDashboardPostingChannelsRouteData,
} from '../server/dashboard-guild-route-data.js';
import type { DashboardPostingChannel } from '../server/dashboard-posting.server.js';
import { DashboardChannelPicker, formatDashboardChannelLabel } from './dashboard-channel-picker.js';
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
    const [deliveryUncertain, setDeliveryUncertain] = useState(false);
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
                throw new Error(getChannelLoadErrorMessage(result.type));
            }

            return result.channels;
        },
        staleTime: 30_000,
    });

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
                case 'sent':
                    setDeliveryUncertain(false);
                    setContent('');
                    setEmbedDraft(createEmptyDashboardEmbedDraft());
                    setEmbedJson('');
                    setFormMessage({ type: 'success', text: `Message sent to ${payload.channelLabel}.` });
                    await queryClient.invalidateQueries({
                        queryKey: getDashboardAuditEventsBaseQueryKey(guildId),
                    });
                    return;

                case 'delivery-unknown':
                    setDeliveryUncertain(true);
                    setFormMessage({
                        type: 'warning',
                        text: 'Delivery could not be confirmed. Check the channel before starting another attempt.',
                    });
                    return;

                case 'invalid-message':
                    setFormMessage({ type: 'error', text: result.message });
                    return;

                case 'auth-required':
                    setFormMessage({ type: 'error', text: 'Sign in again before posting.' });
                    return;

                case 'not-found':
                    setFormMessage({ type: 'error', text: 'This server is not available for this account.' });
                    return;

                case 'bot-token-missing':
                    setFormMessage({ type: 'error', text: 'Dashboard posting is not configured for this deployment.' });
                    return;

                case 'deployment-config-not-found':
                case 'database-error':
                case 'guild-lookup-failed':
                    setFormMessage({ type: 'error', text: 'Could not post this message. Try again.' });
                    return;
            }
        },
        onError: () => {
            setDeliveryUncertain(true);
            setFormMessage({
                type: 'warning',
                text: 'Delivery could not be confirmed. Check the channel before starting another attempt.',
            });
        },
    });

    function submitMessage(event: FormEvent<HTMLFormElement>): void {
        event.preventDefault();

        if (deliveryUncertain) {
            setFormMessage({
                type: 'warning',
                text: 'Check the channel, then explicitly start a new attempt if the message is absent.',
            });
            return;
        }

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

        mutation.mutate({
            channelId: trimmedChannelId,
            channelLabel: getPostingChannelLabel(channelsQuery.data ?? [], trimmedChannelId),
            ...(trimmedContent ? { content: trimmedContent } : {}),
            embeds: parsedEmbeds.embeds,
            requestKey: crypto.randomUUID(),
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
                    hasError={channelsQuery.isError}
                    isLoading={channelsQuery.isPending}
                    isOpen={channelPickerOpen}
                    search={channelSearch}
                    selectedChannelId={selectedChannelId}
                    onBlur={() => setChannelPickerOpen(false)}
                    onFocus={() => setChannelPickerOpen(true)}
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
                            disabled={mutation.isPending || deliveryUncertain}
                            className={primaryButtonClassName}
                            {...dashboardTactile}>
                            {mutation.isPending ? 'Sending…' : 'Send message'}
                        </motion.button>
                        {deliveryUncertain ? (
                            <motion.button
                                type='button'
                                onClick={() => {
                                    setDeliveryUncertain(false);
                                    setFormMessage({ type: 'warning', text: 'A new posting attempt is ready.' });
                                }}
                                className={warningButtonClassName}
                                {...dashboardTactile}>
                                Start new attempt
                            </motion.button>
                        ) : null}
                    </div>
                    <AnimatePresence initial={false} mode='popLayout'>
                        {formMessage ? (
                            <motion.div
                                key={`${formMessage.type}:${formMessage.text}`}
                                data-dashboard-motion='confirmation'
                                className='mt-3'
                                variants={dashboardConfirmationVariants}
                                initial='initial'
                                animate='enter'
                                transition={dashboardConfirmationTransition}>
                                <DashboardStatus tone={getFormMessageTone(formMessage.type)}>
                                    {formMessage.text}
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
                                Sending is immediate. If delivery cannot be confirmed, NeonFlux stops before another
                                attempt can begin.
                            </motion.p>
                        )}
                    </AnimatePresence>
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
const warningButtonClassName =
    'inline-flex min-h-11 items-center justify-center rounded-[var(--dash-radius-control)] border border-[var(--dash-warning)] px-4 text-sm font-semibold text-[var(--dash-text)] transition hover:bg-[var(--dash-warning-soft)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--dash-warning)]';

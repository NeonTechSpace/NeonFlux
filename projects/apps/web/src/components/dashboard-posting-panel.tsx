import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type { FormEvent } from 'react';

import { getDashboardAuditEventsQueryKey, getDashboardPostingChannelsQueryKey } from '../dashboard-query-keys.js';
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
import { DashboardPostingPreview } from './dashboard-posting-preview.js';

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
        mutationFn: (payload: { channelId: string; channelLabel: string; content?: string; embeds: unknown[] }) =>
            postDashboardMessageRouteData({
                data: {
                    guildId,
                    channelId: payload.channelId,
                    ...(payload.content ? { content: payload.content } : {}),
                    embeds: payload.embeds,
                },
            }),
        onSuccess: async (result, payload) => {
            switch (result.type) {
                case 'sent':
                    setContent('');
                    setEmbedDraft(createEmptyDashboardEmbedDraft());
                    setEmbedJson('');
                    setFormMessage({ type: 'success', text: `Message sent to ${payload.channelLabel}.` });
                    await queryClient.invalidateQueries({
                        queryKey: getDashboardAuditEventsQueryKey(guildId),
                    });
                    return;

                case 'sent-with-record-error':
                    setFormMessage({
                        type: 'warning',
                        text: 'Message sent, but NeonFlux could not record the posting audit trail.',
                    });
                    await queryClient.invalidateQueries({
                        queryKey: getDashboardAuditEventsQueryKey(guildId),
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

                case 'send-failed':
                    setFormMessage({ type: 'error', text: 'Fluxer could not send this message.' });
                    return;

                case 'deployment-config-not-found':
                case 'database-error':
                case 'guild-lookup-failed':
                    setFormMessage({ type: 'error', text: 'Could not post this message. Try again.' });
                    return;
            }
        },
        onError: () => {
            setFormMessage({ type: 'error', text: 'Could not post this message. Try again.' });
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

        mutation.mutate({
            channelId: trimmedChannelId,
            channelLabel: getPostingChannelLabel(channelsQuery.data ?? [], trimmedChannelId),
            ...(trimmedContent ? { content: trimmedContent } : {}),
            embeds: parsedEmbeds.embeds,
        });
    }

    return (
        <article className='rounded-lg border border-neutral-800 bg-neutral-900 p-4' aria-busy={mutation.isPending}>
            <div>
                <h2 className='text-lg font-semibold text-white'>Posting</h2>
                <p className='mt-2 text-sm leading-6 text-neutral-400'>
                    Send plain text or Fluxer embed payloads as NeonFlux.
                </p>
            </div>

            <form className='mt-4 flex flex-col gap-3' onSubmit={submitMessage}>
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

                <label className='space-y-2 text-sm font-medium text-neutral-200'>
                    <span>Message content</span>
                    <textarea
                        value={content}
                        onChange={(event) => {
                            setContent(event.currentTarget.value);
                            setFormMessage(undefined);
                        }}
                        className='min-h-28 w-full resize-y rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 text-base text-white transition outline-none placeholder:text-neutral-600 focus:border-sky-400 focus:ring-2 focus:ring-sky-400/40'
                    />
                </label>

                <fieldset className='space-y-3'>
                    <legend className='text-sm font-medium text-neutral-200'>Embed mode</legend>
                    <div className='flex flex-wrap gap-2' role='radiogroup' aria-label='Embed mode'>
                        <EmbedModeOption
                            mode='builder'
                            currentMode={embedMode}
                            label='Builder'
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

                {embedMode === 'builder' ? (
                    <DashboardEmbedBuilder
                        draft={embedDraft}
                        onDraftChange={(nextDraft) => {
                            setEmbedDraft(nextDraft);
                            setFormMessage(undefined);
                        }}
                    />
                ) : (
                    <label className='space-y-2 text-sm font-medium text-neutral-200'>
                        <span>Embed JSON</span>
                        <textarea
                            value={embedJson}
                            onChange={(event) => {
                                setEmbedJson(event.currentTarget.value);
                                setFormMessage(undefined);
                            }}
                            className='min-h-32 w-full resize-y rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 font-mono text-sm text-white transition outline-none placeholder:text-neutral-600 focus:border-sky-400 focus:ring-2 focus:ring-sky-400/40'
                            placeholder='[{"title":"NeonFlux","description":"Fluxer update"}]'
                            spellCheck={false}
                        />
                    </label>
                )}

                <DashboardPostingPreview content={content} embeds={previewEmbeds} />

                <div className='flex flex-wrap items-center gap-3'>
                    <button
                        type='submit'
                        disabled={mutation.isPending}
                        className='inline-flex min-h-10 items-center rounded-md bg-sky-500 px-4 text-sm font-semibold text-white transition hover:bg-sky-400 focus:ring-2 focus:ring-sky-300 focus:ring-offset-2 focus:ring-offset-neutral-950 focus:outline-none disabled:cursor-not-allowed disabled:bg-neutral-700 disabled:text-neutral-400'>
                        {mutation.isPending ? 'Sending...' : 'Send message'}
                    </button>
                    <span role='status' className={getFormMessageClassName(formMessage?.type)}>
                        {formMessage?.text}
                    </span>
                </div>
            </form>
        </article>
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
            className={
                currentMode === mode
                    ? 'inline-flex min-h-9 items-center rounded-md border border-sky-400 bg-sky-400/10 px-3 text-sm font-semibold text-sky-100'
                    : 'inline-flex min-h-9 items-center rounded-md border border-neutral-700 px-3 text-sm font-semibold text-neutral-200 transition hover:border-neutral-500'
            }>
            <span>{label}</span>
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

function getFormMessageClassName(type: PostingFormMessage['type'] | undefined): string {
    switch (type) {
        case 'success':
            return 'text-sm text-emerald-300';

        case 'warning':
            return 'text-sm text-amber-300';

        case 'error':
            return 'text-sm text-rose-300';

        case undefined:
            return 'text-sm text-neutral-400';
    }
}

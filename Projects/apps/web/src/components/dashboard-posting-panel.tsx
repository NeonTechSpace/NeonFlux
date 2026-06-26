import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type { FormEvent } from 'react';

import { getDashboardAuditEventsQueryKey, getDashboardPostingChannelsQueryKey } from '../dashboard-query-keys.js';
import {
    postDashboardMessageRouteData,
    readDashboardPostingChannelsRouteData,
} from '../server/dashboard-guild-route-data.js';
import type { DashboardPostingChannel } from '../server/dashboard-posting.server.js';

type PostingFormMessage = {
    type: 'error' | 'success' | 'warning';
    text: string;
};

type ParsedEmbedsResult = { valid: true; embeds: unknown[] } | { valid: false; message: string };

export function DashboardPostingPanel({ guildId }: { guildId: string }) {
    const queryClient = useQueryClient();
    const [selectedChannelId, setSelectedChannelId] = useState('');
    const [channelSearch, setChannelSearch] = useState('');
    const [channelPickerOpen, setChannelPickerOpen] = useState(false);
    const [content, setContent] = useState('');
    const [embedJson, setEmbedJson] = useState('');
    const [formMessage, setFormMessage] = useState<PostingFormMessage>();

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
        mutationFn: (payload: { channelId: string; content?: string; embeds: unknown[] }) =>
            postDashboardMessageRouteData({
                data: {
                    guildId,
                    channelId: payload.channelId,
                    ...(payload.content ? { content: payload.content } : {}),
                    embeds: payload.embeds,
                },
            }),
        onSuccess: async (result) => {
            switch (result.type) {
                case 'sent':
                    setContent('');
                    setEmbedJson('');
                    setFormMessage({ type: 'success', text: `Message sent to ${result.message.channelId}.` });
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

        const parsedEmbeds = parseEmbedJson(embedJson);

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
                <ChannelPicker
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
                        setChannelSearch(formatChannelLabel(channel));
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

function ChannelPicker({
    channels,
    hasError,
    isLoading,
    isOpen,
    search,
    selectedChannelId,
    onBlur,
    onFocus,
    onSearchChange,
    onSelect,
}: {
    channels: DashboardPostingChannel[];
    hasError: boolean;
    isLoading: boolean;
    isOpen: boolean;
    search: string;
    selectedChannelId: string;
    onBlur: () => void;
    onFocus: () => void;
    onSearchChange: (search: string) => void;
    onSelect: (channel: DashboardPostingChannel) => void;
}) {
    const matchedChannels = matchChannels(channels, search).slice(0, 8);

    return (
        <div className='space-y-2 text-sm font-medium text-neutral-200'>
            <label className='space-y-2'>
                <span>Channel</span>
                <input
                    value={search}
                    onBlur={onBlur}
                    onChange={(event) => onSearchChange(event.currentTarget.value)}
                    onFocus={onFocus}
                    className='min-h-10 w-full rounded-md border border-neutral-700 bg-neutral-950 px-3 text-base text-white transition outline-none placeholder:text-neutral-600 focus:border-sky-400 focus:ring-2 focus:ring-sky-400/40'
                    autoComplete='off'
                    role='combobox'
                    aria-autocomplete='list'
                    aria-controls='posting-channel-options'
                    aria-expanded={isOpen}
                    placeholder='Search channels'
                />
            </label>

            {isLoading ? <p className='text-xs leading-5 text-neutral-500'>Loading channels...</p> : null}
            {hasError ? <p className='text-xs leading-5 text-rose-300'>Could not load channels.</p> : null}

            {isOpen && !isLoading && !hasError ? (
                <ul
                    id='posting-channel-options'
                    className='max-h-56 overflow-y-auto rounded-md border border-neutral-800 bg-neutral-950'
                    role='listbox'>
                    {matchedChannels.length > 0 ? (
                        matchedChannels.map((channel) => (
                            <li key={channel.id} role='option' aria-selected={selectedChannelId === channel.id}>
                                <button
                                    type='button'
                                    onMouseDown={(event) => event.preventDefault()}
                                    onClick={() => onSelect(channel)}
                                    className='flex min-h-11 w-full items-center justify-between gap-3 px-3 text-left text-sm text-neutral-100 transition hover:bg-neutral-800 focus:bg-neutral-800 focus:outline-none'>
                                    <span className='min-w-0 truncate'>{formatChannelLabel(channel)}</span>
                                    <span className='shrink-0 text-xs text-neutral-500'>
                                        {channel.parentName ?? channel.id}
                                    </span>
                                </button>
                            </li>
                        ))
                    ) : (
                        <li className='px-3 py-3 text-sm text-neutral-500'>No matching channels.</li>
                    )}
                </ul>
            ) : null}
        </div>
    );
}

function parseEmbedJson(value: string): ParsedEmbedsResult {
    const trimmedValue = value.trim();

    if (!trimmedValue) {
        return { valid: true, embeds: [] };
    }

    try {
        const parsedValue: unknown = JSON.parse(trimmedValue);

        if (!Array.isArray(parsedValue) || !parsedValue.every(isEmbedObject)) {
            return {
                valid: false,
                message: 'Embed JSON must be an array of embed objects.',
            };
        }

        return { valid: true, embeds: parsedValue };
    } catch {
        return {
            valid: false,
            message: 'Embed JSON is not valid JSON.',
        };
    }
}

function matchChannels(channels: DashboardPostingChannel[], query: string): DashboardPostingChannel[] {
    const normalizedQuery = normalizeChannelSearchText(query);

    if (!normalizedQuery) {
        return channels;
    }

    return channels
        .map((channel, index) => ({
            channel,
            index,
            score: scoreChannelMatch(channel, normalizedQuery),
        }))
        .filter((match): match is { channel: DashboardPostingChannel; index: number; score: number } => match.score > 0)
        .sort((left, right) => right.score - left.score || left.index - right.index)
        .map((match) => match.channel);
}

function scoreChannelMatch(channel: DashboardPostingChannel, query: string): number {
    const tokens = query.split(/\s+/).filter(Boolean);
    const searchableValues = [channel.name, channel.parentName ?? '', channel.id, formatChannelLabel(channel)].map(
        normalizeChannelSearchText
    );
    let score = 0;

    for (const token of tokens) {
        const tokenScore = Math.max(...searchableValues.map((value) => scoreChannelToken(token, value)));

        if (tokenScore === 0) {
            return 0;
        }

        score += tokenScore;
    }

    return score;
}

function scoreChannelToken(token: string, value: string): number {
    if (!value) {
        return 0;
    }

    if (value === token) {
        return 100;
    }

    if (value.startsWith(token)) {
        return 80;
    }

    if (value.includes(token)) {
        return 60;
    }

    return isSubsequence(token, value) ? 30 : 0;
}

function isSubsequence(needle: string, haystack: string): boolean {
    let needleIndex = 0;

    for (const character of haystack) {
        if (character === needle[needleIndex]) {
            needleIndex += 1;
        }

        if (needleIndex === needle.length) {
            return true;
        }
    }

    return false;
}

function normalizeChannelSearchText(value: string): string {
    return value
        .trim()
        .toLowerCase()
        .replace(/^#/, '')
        .replace(/[^a-z0-9]+/g, ' ');
}

function formatChannelLabel(channel: DashboardPostingChannel): string {
    return `#${channel.name}`;
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

function isEmbedObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
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

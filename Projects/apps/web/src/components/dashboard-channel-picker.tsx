import type { DashboardPostingChannel } from '../server/dashboard-posting.server.js';

export function DashboardChannelPicker({
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
                                    <span className='min-w-0 truncate'>{formatDashboardChannelLabel(channel)}</span>
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

export function formatDashboardChannelLabel(channel: DashboardPostingChannel): string {
    return `#${channel.name}`;
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
    const searchableValues = [
        channel.name,
        channel.parentName ?? '',
        channel.id,
        formatDashboardChannelLabel(channel),
    ].map(normalizeChannelSearchText);
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

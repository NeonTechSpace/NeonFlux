import { useEffect, useMemo, useRef, useState } from 'react';

import { dashboardFieldClassName, dashboardSecondaryActionClassName } from './dashboard-ui.js';

export type DashboardPickerChannel = {
    id: string;
    name: string;
    parentName?: string;
};

export function DashboardChannelPicker({
    channels,
    hasError,
    errorMessage = 'Could not load channels.',
    isRetrying = false,
    isLoading,
    isOpen,
    label = 'Channel',
    listboxId = 'posting-channel-options',
    search,
    selectedChannelId,
    onBlur,
    onFocus,
    onRetry,
    onSearchChange,
    onSelect,
}: {
    channels: DashboardPickerChannel[];
    hasError: boolean;
    errorMessage?: string;
    isLoading: boolean;
    isRetrying?: boolean;
    isOpen: boolean;
    label?: string;
    listboxId?: string;
    search: string;
    selectedChannelId: string;
    onBlur: () => void;
    onFocus: () => void;
    onRetry?: () => void;
    onSearchChange: (search: string) => void;
    onSelect: (channel: DashboardPickerChannel) => void;
}) {
    const matchedChannels = useMemo(() => matchChannels(channels, search).slice(0, 8), [channels, search]);
    const inputRef = useRef<HTMLInputElement>(null);
    const [activeChannelId, setActiveChannelId] = useState<string>();
    const resolvedActiveChannelId = isOpen
        ? (matchedChannels.find((channel) => channel.id === activeChannelId)?.id ??
          matchedChannels.find((channel) => channel.id === selectedChannelId)?.id ??
          matchedChannels[0]?.id)
        : undefined;
    const activeIndex = matchedChannels.findIndex((channel) => channel.id === resolvedActiveChannelId);
    const activeOptionId = activeIndex >= 0 ? getChannelOptionId(listboxId, activeIndex) : undefined;

    useEffect(() => {
        if (!activeOptionId) {
            return;
        }

        const activeOption = document.getElementById(activeOptionId);
        const scrollIntoView: unknown = activeOption?.scrollIntoView;

        if (typeof scrollIntoView === 'function') {
            scrollIntoView.call(activeOption, { block: 'nearest' });
        }
    }, [activeOptionId]);

    const moveActiveOption = (offset: -1 | 1) => {
        if (matchedChannels.length === 0) {
            return;
        }

        const nextIndex = activeIndex < 0 ? (offset === 1 ? 0 : matchedChannels.length - 1) : activeIndex + offset;
        const wrappedIndex = (nextIndex + matchedChannels.length) % matchedChannels.length;
        setActiveChannelId(matchedChannels[wrappedIndex]?.id);
    };

    return (
        <div className='space-y-2'>
            <label className='block text-[0.9rem] font-semibold text-[var(--dash-text)]'>
                <span>{label}</span>
                <input
                    ref={inputRef}
                    value={search}
                    onBlur={onBlur}
                    onChange={(event) => {
                        setActiveChannelId(undefined);
                        onSearchChange(event.currentTarget.value);
                    }}
                    onFocus={onFocus}
                    onKeyDown={(event) => {
                        switch (event.key) {
                            case 'ArrowDown':
                                event.preventDefault();
                                if (!isOpen) {
                                    onFocus();
                                }
                                moveActiveOption(1);
                                break;
                            case 'ArrowUp':
                                event.preventDefault();
                                if (!isOpen) {
                                    onFocus();
                                }
                                moveActiveOption(-1);
                                break;
                            case 'Home':
                                if (isOpen && matchedChannels.length > 0) {
                                    event.preventDefault();
                                    setActiveChannelId(matchedChannels[0]?.id);
                                }
                                break;
                            case 'End':
                                if (isOpen && matchedChannels.length > 0) {
                                    event.preventDefault();
                                    setActiveChannelId(matchedChannels.at(-1)?.id);
                                }
                                break;
                            case 'Enter': {
                                const activeChannel = matchedChannels.find(
                                    (channel) => channel.id === resolvedActiveChannelId
                                );

                                if (isOpen && activeChannel) {
                                    event.preventDefault();
                                    onSelect(activeChannel);
                                }
                                break;
                            }
                            case 'Escape':
                                if (isOpen) {
                                    event.preventDefault();
                                    inputRef.current?.blur();
                                }
                                break;
                        }
                    }}
                    className={`${dashboardFieldClassName} mt-2`}
                    autoComplete='off'
                    role='combobox'
                    aria-autocomplete='list'
                    aria-controls={listboxId}
                    aria-expanded={isOpen}
                    aria-activedescendant={isOpen ? activeOptionId : undefined}
                    placeholder='Search channels'
                />
            </label>

            {isLoading ? <p className='text-xs leading-5 text-[var(--dash-text-muted)]'>Loading channels...</p> : null}
            {hasError ? (
                <div className='flex flex-wrap items-center gap-2'>
                    <p className='text-xs leading-5 text-[var(--dash-danger)]'>{errorMessage}</p>
                    {onRetry ? (
                        <button
                            type='button'
                            onClick={onRetry}
                            disabled={isRetrying}
                            aria-busy={isRetrying || undefined}
                            className={`${dashboardSecondaryActionClassName} min-h-8 text-xs`}>
                            {isRetrying ? 'Retrying…' : 'Retry channels'}
                        </button>
                    ) : null}
                </div>
            ) : null}

            {isOpen && !isLoading && !hasError ? (
                <ul
                    id={listboxId}
                    className='max-h-56 overflow-y-auto rounded-[var(--dash-radius-control)] border border-[var(--dash-border)] bg-[rgba(5,9,16,0.96)] p-1 shadow-[var(--dash-shadow-popover)]'
                    role='listbox'>
                    {matchedChannels.length > 0 ? (
                        matchedChannels.map((channel, index) => (
                            <li key={channel.id} role='none'>
                                <button
                                    id={getChannelOptionId(listboxId, index)}
                                    type='button'
                                    role='option'
                                    tabIndex={-1}
                                    aria-selected={selectedChannelId === channel.id}
                                    onMouseDown={(event) => event.preventDefault()}
                                    onMouseMove={() => setActiveChannelId(channel.id)}
                                    onClick={() => onSelect(channel)}
                                    className={`flex min-h-11 w-full items-center justify-between gap-3 rounded-[var(--dash-radius-control)] px-3 text-left text-sm text-[var(--dash-text)] transition focus:outline-none ${resolvedActiveChannelId === channel.id ? 'bg-[rgba(56,189,248,0.14)] shadow-[inset_0_0_0_1px_rgba(90,215,255,0.2)]' : 'hover:bg-[rgba(56,189,248,0.1)]'}`}>
                                    <span className='min-w-0 truncate'>{formatDashboardChannelLabel(channel)}</span>
                                    <span className='shrink-0 text-xs text-[var(--dash-text-muted)]'>
                                        {channel.parentName ?? channel.id}
                                    </span>
                                </button>
                            </li>
                        ))
                    ) : (
                        <li
                            role='option'
                            aria-selected='false'
                            aria-disabled='true'
                            className='px-3 py-3 text-sm text-[var(--dash-text-muted)]'>
                            No matching channels.
                        </li>
                    )}
                </ul>
            ) : null}
        </div>
    );
}

function getChannelOptionId(listboxId: string, index: number): string {
    return `${listboxId}-option-${index}`;
}

export function formatDashboardChannelLabel(channel: DashboardPickerChannel): string {
    return `#${channel.name}`;
}

function matchChannels(channels: DashboardPickerChannel[], query: string): DashboardPickerChannel[] {
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
        .filter((match): match is { channel: DashboardPickerChannel; index: number; score: number } => match.score > 0)
        .sort((left, right) => right.score - left.score || left.index - right.index)
        .map((match) => match.channel);
}

function scoreChannelMatch(channel: DashboardPickerChannel, query: string): number {
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

export type DashboardPickerChannel = {
    id: string;
    name: string;
    parentName?: string;
};

export function DashboardChannelPicker({
    channels,
    hasError,
    isLoading,
    isOpen,
    label = 'Channel',
    listboxId = 'posting-channel-options',
    search,
    selectedChannelId,
    onBlur,
    onFocus,
    onSearchChange,
    onSelect,
}: {
    channels: DashboardPickerChannel[];
    hasError: boolean;
    isLoading: boolean;
    isOpen: boolean;
    label?: string;
    listboxId?: string;
    search: string;
    selectedChannelId: string;
    onBlur: () => void;
    onFocus: () => void;
    onSearchChange: (search: string) => void;
    onSelect: (channel: DashboardPickerChannel) => void;
}) {
    const matchedChannels = matchChannels(channels, search).slice(0, 8);

    return (
        <div className='space-y-2'>
            <label className='dashboard-label'>
                <span>{label}</span>
                <input
                    value={search}
                    onBlur={onBlur}
                    onChange={(event) => onSearchChange(event.currentTarget.value)}
                    onFocus={onFocus}
                    className='dashboard-field mt-2'
                    autoComplete='off'
                    role='combobox'
                    aria-autocomplete='list'
                    aria-controls={listboxId}
                    aria-expanded={isOpen}
                    placeholder='Search channels'
                />
            </label>

            {isLoading ? <p className='text-xs leading-5 text-[var(--dash-text-muted)]'>Loading channels...</p> : null}
            {hasError ? <p className='text-xs leading-5 text-rose-300'>Could not load channels.</p> : null}

            {isOpen && !isLoading && !hasError ? (
                <ul
                    id={listboxId}
                    className='max-h-56 overflow-y-auto rounded-[var(--dash-radius-control)] border border-[var(--dash-border)] bg-[rgba(5,9,16,0.96)] p-1 shadow-[var(--dash-shadow-popover)]'
                    role='listbox'>
                    {matchedChannels.length > 0 ? (
                        matchedChannels.map((channel) => (
                            <li key={channel.id} role='option' aria-selected={selectedChannelId === channel.id}>
                                <button
                                    type='button'
                                    onMouseDown={(event) => event.preventDefault()}
                                    onClick={() => onSelect(channel)}
                                    className='flex min-h-11 w-full items-center justify-between gap-3 rounded-[var(--dash-radius-control)] px-3 text-left text-sm text-[var(--dash-text)] transition hover:bg-[rgba(56,189,248,0.14)] focus:bg-[rgba(56,189,248,0.14)] focus:outline-none'>
                                    <span className='min-w-0 truncate'>{formatDashboardChannelLabel(channel)}</span>
                                    <span className='shrink-0 text-xs text-[var(--dash-text-muted)]'>
                                        {channel.parentName ?? channel.id}
                                    </span>
                                </button>
                            </li>
                        ))
                    ) : (
                        <li className='px-3 py-3 text-sm text-[var(--dash-text-muted)]'>No matching channels.</li>
                    )}
                </ul>
            ) : null}
        </div>
    );
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

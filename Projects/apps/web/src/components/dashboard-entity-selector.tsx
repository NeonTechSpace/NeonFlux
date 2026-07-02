import { useMemo, useState } from 'react';

export type DashboardEntityKind = 'channel' | 'role' | 'user';

export type DashboardEntityOption = {
    id: string;
    name: string;
    detail?: string;
    color?: number;
};

type DashboardEntitySelectorProps = {
    label: string;
    kind: DashboardEntityKind;
    options: DashboardEntityOption[];
    selectedIds: string[];
    onSelectedIdsChange: (selectedIds: string[]) => void;
    description?: string;
    disabled?: boolean;
    emptyText?: string;
    listboxId?: string;
    maxSelected?: number;
    placeholder?: string;
    unavailableText?: string;
};

export function DashboardEntitySelector({
    label,
    kind,
    options,
    selectedIds,
    onSelectedIdsChange,
    description,
    disabled = false,
    emptyText,
    listboxId,
    maxSelected,
    placeholder,
    unavailableText,
}: DashboardEntitySelectorProps) {
    const [query, setQuery] = useState('');
    const [open, setOpen] = useState(false);
    const optionsById = useMemo(() => new Map(options.map((option) => [option.id, option])), [options]);
    const selectedOptions = selectedIds.map((id) => optionsById.get(id) ?? toUnknownOption(id, kind));
    const matchedOptions = useMemo(
        () =>
            matchEntityOptions(
                options.filter((option) => !selectedIds.includes(option.id)),
                query,
                kind
            ).slice(0, 10),
        [kind, options, query, selectedIds]
    );
    const canSelectMore = maxSelected === undefined || selectedIds.length < maxSelected;
    const isUnavailable = Boolean(unavailableText);
    const controlDisabled = disabled || isUnavailable || !canSelectMore;
    const fallbackEmptyText = emptyText ?? `No ${kind}s found.`;
    const resolvedPlaceholder = placeholder ?? `Search ${kind}s`;
    const resolvedListboxId = listboxId ?? `${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-options`;

    function addOption(option: DashboardEntityOption): void {
        if (maxSelected === 1) {
            onSelectedIdsChange([option.id]);
        } else if (!selectedIds.includes(option.id)) {
            onSelectedIdsChange([...selectedIds, option.id]);
        }

        setQuery('');
        setOpen(false);
    }

    function removeOption(optionId: string): void {
        onSelectedIdsChange(selectedIds.filter((selectedId) => selectedId !== optionId));
    }

    return (
        <div className='space-y-2'>
            <label className='dashboard-label'>
                <span>{label}</span>
                <input
                    value={query}
                    onBlur={() => setOpen(false)}
                    onChange={(event) => {
                        setQuery(event.currentTarget.value);
                        setOpen(true);
                    }}
                    onFocus={() => setOpen(true)}
                    className='dashboard-field mt-2 text-[0.95rem]'
                    autoComplete='off'
                    role='combobox'
                    aria-autocomplete='list'
                    aria-controls={resolvedListboxId}
                    aria-expanded={open && !controlDisabled}
                    disabled={controlDisabled}
                    placeholder={controlDisabled && !isUnavailable ? 'Selection limit reached' : resolvedPlaceholder}
                />
            </label>
            {description ? <p className='text-xs leading-5 text-[var(--dash-text-muted)]'>{description}</p> : null}
            {unavailableText ? <p className='text-xs leading-5 text-amber-200'>{unavailableText}</p> : null}

            {selectedOptions.length > 0 ? (
                <div className='flex flex-wrap gap-2'>
                    {selectedOptions.map((option) => (
                        <button
                            key={option.id}
                            type='button'
                            onClick={() => removeOption(option.id)}
                            className='inline-flex min-h-8 max-w-full items-center gap-2 rounded-[var(--dash-radius-control)] border border-[rgba(56,189,248,0.34)] bg-[rgba(56,189,248,0.12)] px-2.5 text-xs font-semibold text-[var(--dash-text)] transition hover:border-[var(--dash-danger)] hover:bg-[var(--dash-danger-soft)] focus-visible:border-[var(--dash-primary)] focus-visible:shadow-[var(--dash-shadow-focus)] focus-visible:outline-none'>
                            <EntityGlyph kind={kind} option={option} />
                            <span className='truncate'>{formatEntityName(kind, option)}</span>
                        </button>
                    ))}
                </div>
            ) : null}

            {open && !controlDisabled ? (
                <ul
                    id={resolvedListboxId}
                    className='max-h-56 overflow-y-auto rounded-[var(--dash-radius-control)] border border-[var(--dash-border)] bg-[rgba(5,9,16,0.96)] p-1 shadow-[var(--dash-shadow-popover)]'
                    role='listbox'>
                    {matchedOptions.length > 0 ? (
                        matchedOptions.map((option) => (
                            <li key={option.id} role='option' aria-selected={selectedIds.includes(option.id)}>
                                <button
                                    type='button'
                                    onMouseDown={(event) => event.preventDefault()}
                                    onClick={() => addOption(option)}
                                    className='flex min-h-11 w-full items-center gap-3 rounded-[var(--dash-radius-control)] px-3 text-left text-sm text-[var(--dash-text)] transition hover:bg-[rgba(56,189,248,0.14)] focus:bg-[rgba(56,189,248,0.14)] focus:outline-none'>
                                    <EntityGlyph kind={kind} option={option} />
                                    <span className='min-w-0 flex-1 truncate'>{formatEntityName(kind, option)}</span>
                                    {option.detail ? (
                                        <span className='min-w-0 max-w-44 truncate text-xs text-[var(--dash-text-muted)]'>
                                            {option.detail}
                                        </span>
                                    ) : null}
                                </button>
                            </li>
                        ))
                    ) : (
                        <li className='px-3 py-3 text-sm text-[var(--dash-text-muted)]'>{fallbackEmptyText}</li>
                    )}
                </ul>
            ) : null}
        </div>
    );
}

function EntityGlyph({ kind, option }: { kind: DashboardEntityKind; option: DashboardEntityOption }) {
    if (kind === 'role') {
        return (
            <span
                className='size-3 shrink-0 rounded-full border border-white/30'
                style={{ backgroundColor: option.color && option.color > 0 ? toHexColor(option.color) : '#38bdf8' }}
                aria-hidden='true'
            />
        );
    }

    return (
        <span className='grid size-6 shrink-0 place-items-center rounded-[var(--dash-radius-control)] border border-[rgba(56,189,248,0.24)] bg-[rgba(56,189,248,0.1)] text-[0.7rem] font-bold text-[var(--dash-primary)]'>
            {kind === 'channel' ? '#' : '@'}
        </span>
    );
}

function formatEntityName(kind: DashboardEntityKind, option: DashboardEntityOption): string {
    if (kind === 'channel') return `#${option.name}`;
    if (kind === 'role') return `@${option.name}`;
    return option.name.startsWith('@') ? option.name : `@${option.name}`;
}

function toUnknownOption(id: string, kind: DashboardEntityKind): DashboardEntityOption {
    return {
        id,
        name: kind === 'user' ? id : `Unknown ${kind}`,
        detail: id,
    };
}

function matchEntityOptions(
    options: DashboardEntityOption[],
    query: string,
    kind: DashboardEntityKind
): DashboardEntityOption[] {
    const normalizedQuery = normalizeEntitySearch(query);

    if (!normalizedQuery) return options;

    return options
        .map((option, index) => ({
            option,
            index,
            score: scoreEntityOption(option, normalizedQuery, kind),
        }))
        .filter((match): match is { option: DashboardEntityOption; index: number; score: number } => match.score > 0)
        .sort((left, right) => right.score - left.score || left.index - right.index)
        .map((match) => match.option);
}

function scoreEntityOption(option: DashboardEntityOption, query: string, kind: DashboardEntityKind): number {
    const tokens = query.split(/\s+/).filter(Boolean);
    const searchableValues = [
        option.name,
        option.id,
        option.detail ?? '',
        formatEntityName(kind, option),
    ].map(normalizeEntitySearch);
    let score = 0;

    for (const token of tokens) {
        const tokenScore = Math.max(...searchableValues.map((value) => scoreToken(token, value)));

        if (tokenScore === 0) return 0;

        score += tokenScore;
    }

    return score;
}

function scoreToken(token: string, value: string): number {
    if (!value) return 0;
    if (value === token) return 100;
    if (value.startsWith(token)) return 80;
    if (value.includes(token)) return 60;

    return isSubsequence(token, value) ? 30 : 0;
}

function isSubsequence(needle: string, haystack: string): boolean {
    let needleIndex = 0;

    for (const character of haystack) {
        if (character === needle[needleIndex]) {
            needleIndex += 1;
        }

        if (needleIndex === needle.length) return true;
    }

    return false;
}

function normalizeEntitySearch(value: string): string {
    return value
        .trim()
        .toLowerCase()
        .replace(/^[@#]/, '')
        .replace(/[^a-z0-9]+/g, ' ');
}

function toHexColor(value: number): string {
    return `#${value.toString(16).padStart(6, '0')}`;
}

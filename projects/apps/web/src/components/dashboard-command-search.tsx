import { Link } from '@tanstack/react-router';
import { Search, Server, X } from 'lucide-react';
import { createContext, use, useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from 'react';

import { dashboardNavigationEntries } from '../dashboard-categories.js';
import { createDashboardGuildPreview, withDashboardGuildPreview } from '../dashboard-guild-preview.js';
import type { DashboardGuildShellGuild } from '../server/dashboard-guild-page.server.js';
import { getDashboardGuildSwitchPath } from './dashboard-guild-selector.js';

type DashboardCommandSearchContextValue = {
    openSearch: (returnFocusTo?: HTMLElement) => void;
};

type DashboardCommandResult = {
    id: string;
    label: string;
    description: string;
    href: string;
    keywords: string;
    type: 'route' | 'server';
    guild?: DashboardGuildShellGuild;
};

const DashboardCommandSearchContext = createContext<DashboardCommandSearchContextValue | undefined>(undefined);

export function DashboardCommandSearch({
    guildId,
    guilds,
    pathname,
    children,
}: {
    guildId: string;
    guilds: DashboardGuildShellGuild[];
    pathname: string;
    children: ReactNode;
}) {
    const dialogRef = useRef<HTMLDialogElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);
    const returnFocusRef = useRef<HTMLElement | undefined>(undefined);
    const resultLinksRef = useRef(new Map<string, HTMLAnchorElement>());
    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState('');
    const [activeResultId, setActiveResultId] = useState<string>();
    const resultsId = `dashboard-command-results-${useId().replaceAll(':', '')}`;
    const results = useMemo(
        () => buildDashboardCommandResults({ guildId, guilds, pathname }),
        [guildId, guilds, pathname]
    );
    const filteredResults = useMemo(() => filterDashboardCommandResults(results, query), [query, results]);
    const groupedResults = useMemo(() => {
        const groups = [
            { id: 'tools', label: 'Tools', results: filteredResults.filter((result) => result.type === 'route') },
            { id: 'servers', label: 'Servers', results: filteredResults.filter((result) => result.type === 'server') },
        ];

        return query.trim()
            ? groups.sort(
                  (left, right) =>
                      getFirstResultIndex(filteredResults, left.results) -
                      getFirstResultIndex(filteredResults, right.results)
              )
            : groups;
    }, [filteredResults, query]);
    const orderedResults = useMemo(() => groupedResults.flatMap((group) => group.results), [groupedResults]);
    const resolvedActiveResultId =
        activeResultId && orderedResults.some((result) => result.id === activeResultId)
            ? activeResultId
            : orderedResults.at(0)?.id;
    const activeGuild = guilds.find((guild) => guild.id === guildId);

    const openSearch = useCallback((returnFocusTo?: HTMLElement) => {
        returnFocusRef.current = returnFocusTo;
        setQuery('');
        setActiveResultId(undefined);
        setOpen(true);
    }, []);

    const closeSearch = useCallback(() => {
        const dialog = dialogRef.current;

        if (dialog?.open) {
            if (typeof dialog.close === 'function') {
                dialog.close();
            } else {
                dialog.removeAttribute('open');
            }
        }

        setOpen(false);
        setQuery('');
        setActiveResultId(undefined);
        const returnFocusTo = returnFocusRef.current;
        returnFocusRef.current = undefined;
        queueMicrotask(() => returnFocusTo?.isConnected && returnFocusTo.focus());
    }, []);

    useEffect(() => {
        if (!open) {
            return;
        }

        const dialog = dialogRef.current;

        if (dialog && !dialog.open) {
            if (typeof dialog.showModal === 'function') {
                dialog.showModal();
            } else {
                dialog.setAttribute('open', '');
            }
        }

        queueMicrotask(() => inputRef.current?.focus());
    }, [open]);

    useEffect(() => {
        function handleShortcut(event: KeyboardEvent): void {
            const commandShortcut = event.key.toLocaleLowerCase() === 'k' && (event.metaKey || event.ctrlKey);

            if (commandShortcut && !event.altKey) {
                event.preventDefault();
                if (open) {
                    inputRef.current?.focus();
                } else {
                    openSearch(document.activeElement instanceof HTMLElement ? document.activeElement : undefined);
                }

                return;
            }

            if (open && event.key === 'Escape') {
                event.preventDefault();
                closeSearch();
            }
        }

        window.addEventListener('keydown', handleShortcut);

        return () => window.removeEventListener('keydown', handleShortcut);
    }, [closeSearch, open, openSearch]);

    function handleSearchKeyDown(event: ReactKeyboardEvent<HTMLInputElement>): void {
        if (orderedResults.length === 0 || event.nativeEvent.isComposing) {
            return;
        }

        const currentIndex = orderedResults.findIndex((result) => result.id === resolvedActiveResultId);
        let nextIndex: number | undefined;

        switch (event.key) {
            case 'ArrowDown':
                nextIndex = currentIndex < 0 ? 0 : (currentIndex + 1) % orderedResults.length;
                break;
            case 'ArrowUp':
                nextIndex = currentIndex < 0 ? orderedResults.length - 1 : mod(currentIndex - 1, orderedResults.length);
                break;
            case 'Home':
                nextIndex = 0;
                break;
            case 'End':
                nextIndex = orderedResults.length - 1;
                break;
            case 'Enter': {
                const activeResult = orderedResults.at(currentIndex < 0 ? 0 : currentIndex);

                if (activeResult) {
                    event.preventDefault();
                    resultLinksRef.current.get(activeResult.id)?.click();
                }
                return;
            }
            default:
                return;
        }

        event.preventDefault();
        const nextResult = orderedResults.at(nextIndex);

        if (!nextResult) {
            return;
        }

        setActiveResultId(nextResult.id);
        queueMicrotask(() => resultLinksRef.current.get(nextResult.id)?.scrollIntoView({ block: 'nearest' }));
    }

    return (
        <DashboardCommandSearchContext value={{ openSearch }}>
            {children}
            <dialog
                ref={dialogRef}
                aria-labelledby='dashboard-command-search-title'
                onCancel={(event) => {
                    event.preventDefault();
                    closeSearch();
                }}
                className='m-auto max-h-[min(42rem,calc(100dvh-2rem))] w-[min(38rem,calc(100vw-2rem))] overflow-hidden rounded-[var(--dash-radius-panel)] border border-[var(--dash-border-strong)] bg-[rgba(7,11,18,0.98)] p-0 text-[var(--dash-text)] shadow-[var(--dash-shadow-popover)] backdrop:bg-[rgba(2,5,10,0.78)] backdrop:backdrop-blur-sm'>
                <div className='flex max-h-[inherit] min-h-0 flex-col'>
                    <header className='flex items-center gap-3 border-b border-[var(--dash-border)] p-4'>
                        <div className='min-w-0 flex-1'>
                            <h2 id='dashboard-command-search-title' className='text-base font-semibold'>
                                Find a destination
                            </h2>
                            <p className='mt-0.5 text-xs text-[var(--dash-text-muted)]'>
                                Available tools and manageable servers
                            </p>
                        </div>
                        <button
                            type='button'
                            aria-label='Close search'
                            onClick={closeSearch}
                            className='grid size-11 shrink-0 place-items-center rounded-[var(--dash-radius-control)] text-[var(--dash-text-muted)] transition outline-none hover:bg-[var(--dash-surface-raised)] hover:text-[var(--dash-text)] focus-visible:shadow-[var(--dash-shadow-focus)]'>
                            <X className='size-5' aria-hidden='true' />
                        </button>
                    </header>
                    <label className='mx-4 mt-4 flex min-h-12 items-center gap-3 rounded-[var(--dash-radius-control)] border border-[var(--dash-border)] bg-[var(--dash-surface)] px-3 focus-within:border-[var(--dash-primary)] focus-within:shadow-[var(--dash-shadow-focus)]'>
                        <Search className='size-5 shrink-0 text-[var(--dash-text-muted)]' aria-hidden='true' />
                        <span className='sr-only'>Search dashboard</span>
                        <input
                            ref={inputRef}
                            type='search'
                            aria-label='Search dashboard'
                            aria-controls={resultsId}
                            aria-activedescendant={
                                resolvedActiveResultId
                                    ? getDashboardCommandResultElementId(resultsId, resolvedActiveResultId)
                                    : undefined
                            }
                            aria-autocomplete='list'
                            value={query}
                            onChange={(event) => {
                                setQuery(event.currentTarget.value);
                                setActiveResultId(undefined);
                            }}
                            onKeyDown={handleSearchKeyDown}
                            placeholder='Search tools or servers'
                            className='min-w-0 flex-1 bg-transparent text-sm text-[var(--dash-text)] outline-none placeholder:text-[var(--dash-text-subtle)]'
                        />
                        <kbd className='rounded border border-[var(--dash-border)] px-1.5 py-0.5 text-[0.68rem] text-[var(--dash-text-subtle)]'>
                            Esc
                        </kbd>
                    </label>
                    <div id={resultsId} className='min-h-0 overflow-y-auto p-4' aria-label='Search results'>
                        {filteredResults.length > 0 ? (
                            <div className='space-y-4'>
                                {groupedResults.map((group) =>
                                    group.results.length > 0 ? (
                                        <section key={group.id} aria-labelledby={`${resultsId}-${group.id}`}>
                                            <div className='mb-1 flex min-h-6 items-center justify-between gap-3 px-3'>
                                                <h3
                                                    id={`${resultsId}-${group.id}`}
                                                    className='text-[0.68rem] font-semibold tracking-[0.12em] text-[var(--dash-text-subtle)] uppercase'>
                                                    {group.label}
                                                </h3>
                                                <span className='text-[0.68rem] text-[var(--dash-text-subtle)] tabular-nums'>
                                                    {group.results.length}
                                                </span>
                                            </div>
                                            <ul className='space-y-1'>
                                                {group.results.map((result) => {
                                                    const active = result.id === resolvedActiveResultId;

                                                    return (
                                                        <li key={result.id}>
                                                            <Link
                                                                ref={(node) => {
                                                                    if (node) {
                                                                        resultLinksRef.current.set(result.id, node);
                                                                    } else {
                                                                        resultLinksRef.current.delete(result.id);
                                                                    }
                                                                }}
                                                                id={getDashboardCommandResultElementId(
                                                                    resultsId,
                                                                    result.id
                                                                )}
                                                                to={result.href}
                                                                preload='intent'
                                                                state={getDashboardCommandResultState(
                                                                    result,
                                                                    activeGuild
                                                                )}
                                                                data-active={active || undefined}
                                                                onPointerMove={() => setActiveResultId(result.id)}
                                                                onFocus={() => setActiveResultId(result.id)}
                                                                onClick={closeSearch}
                                                                className={getDashboardCommandResultClassName(active)}>
                                                                <span className='grid size-9 shrink-0 place-items-center rounded-[var(--dash-radius-control)] bg-[var(--dash-primary-soft)] text-[var(--dash-primary)]'>
                                                                    {result.type === 'server' ? (
                                                                        <Server className='size-4' aria-hidden='true' />
                                                                    ) : (
                                                                        <Search className='size-4' aria-hidden='true' />
                                                                    )}
                                                                </span>
                                                                <span className='min-w-0 flex-1'>
                                                                    <span className='block truncate text-sm font-semibold text-[var(--dash-text)]'>
                                                                        {result.label}
                                                                    </span>
                                                                    <span className='mt-0.5 block truncate text-xs'>
                                                                        {result.description}
                                                                    </span>
                                                                </span>
                                                                {active ? (
                                                                    <kbd className='hidden shrink-0 rounded border border-[var(--dash-border-interactive)] px-1.5 py-0.5 text-[0.65rem] text-[var(--dash-primary)] sm:block'>
                                                                        Enter
                                                                    </kbd>
                                                                ) : null}
                                                            </Link>
                                                        </li>
                                                    );
                                                })}
                                            </ul>
                                        </section>
                                    ) : null
                                )}
                            </div>
                        ) : (
                            <p className='py-8 text-center text-sm text-[var(--dash-text-muted)]'>
                                No available destinations match “{query.trim()}”.
                            </p>
                        )}
                    </div>
                </div>
            </dialog>
        </DashboardCommandSearchContext>
    );
}

export function DashboardCommandSearchTrigger({ compact = false }: { compact?: boolean }) {
    const context = use(DashboardCommandSearchContext);

    if (!context) {
        throw new Error('Dashboard command search trigger rendered outside its provider.');
    }

    return (
        <button
            type='button'
            aria-label='Search dashboard'
            title='Search dashboard (Ctrl or Command + K)'
            data-dashboard-command-trigger
            onClick={(event) => context.openSearch(event.currentTarget)}
            className={
                compact
                    ? 'grid size-11 shrink-0 place-items-center rounded-[var(--dash-radius-control)] border border-[var(--dash-border)] text-[var(--dash-text-muted)] transition outline-none hover:border-[var(--dash-border-interactive)] hover:bg-[var(--dash-surface-raised)] hover:text-[var(--dash-text)] focus-visible:border-[var(--dash-primary)] focus-visible:shadow-[var(--dash-shadow-focus)]'
                    : 'flex min-h-10 w-full items-center justify-center gap-2 rounded-xl bg-white/[0.025] px-2 text-sm font-medium text-[var(--dash-text-muted)] transition outline-none hover:bg-white/[0.05] hover:text-[var(--dash-text)] focus-visible:shadow-[var(--dash-shadow-focus)] lg:justify-start'
            }>
            <Search className='size-4 shrink-0' aria-hidden='true' />
            {compact ? null : (
                <>
                    <span className='hidden min-w-0 flex-1 truncate lg:block'>Search</span>
                    <kbd className='hidden rounded-md bg-white/[0.045] px-1.5 py-0.5 text-[0.65rem] font-medium text-[var(--dash-text-subtle)] lg:block'>
                        Ctrl K
                    </kbd>
                </>
            )}
        </button>
    );
}

function buildDashboardCommandResults({
    guildId,
    guilds,
    pathname,
}: {
    guildId: string;
    guilds: DashboardGuildShellGuild[];
    pathname: string;
}): DashboardCommandResult[] {
    const routeResults = dashboardNavigationEntries.flatMap((entry): DashboardCommandResult[] => {
        if (entry.type === 'group') {
            return entry.subNavigation.map((item) => ({
                id: `route:${entry.category.id}:${item.id}`,
                label: item.label,
                description: entry.category.label,
                href: item.to.replace('$guildId', guildId),
                keywords: `${entry.category.label} ${item.label} ${item.description}`.toLocaleLowerCase(),
                type: 'route',
            }));
        }

        const onlyCapability = entry.subNavigation.at(0);

        return [
            {
                id: `route:${entry.category.id}`,
                label: entry.category.label,
                description: onlyCapability?.label ?? entry.category.description,
                href: entry.linkTo.replace('$guildId', guildId),
                keywords:
                    `${entry.category.label} ${entry.category.description} ${onlyCapability?.label ?? ''} ${onlyCapability?.description ?? ''}`.toLocaleLowerCase(),
                type: 'route',
            },
        ];
    });
    const serverResults = guilds.map(
        (guild): DashboardCommandResult => ({
            id: `server:${guild.id}`,
            label: guild.name,
            description: guild.id === guildId ? 'Current server' : 'Switch server',
            href: getDashboardGuildSwitchPath(guildId, guild.id, pathname),
            keywords: guild.name.toLocaleLowerCase(),
            type: 'server',
            guild,
        })
    );

    return [...routeResults, ...serverResults];
}

function getDashboardCommandResultState(
    result: DashboardCommandResult,
    sourceGuild: DashboardGuildShellGuild | undefined
) {
    if (result.type !== 'server' || !result.guild || result.guild.id === sourceGuild?.id) {
        return undefined;
    }

    const targetPreview = createDashboardGuildPreview({
        id: result.guild.id,
        name: result.guild.name,
        ...(result.guild.iconUrl ? { iconUrl: result.guild.iconUrl } : {}),
        mode: 'multi',
    });
    const sourcePreview = sourceGuild
        ? createDashboardGuildPreview({
              id: sourceGuild.id,
              name: sourceGuild.name,
              ...(sourceGuild.iconUrl ? { iconUrl: sourceGuild.iconUrl } : {}),
              mode: 'multi',
          })
        : undefined;

    return withDashboardGuildPreview(targetPreview, sourcePreview);
}

function filterDashboardCommandResults(
    results: readonly DashboardCommandResult[],
    query: string
): DashboardCommandResult[] {
    const normalizedQuery = query.trim().toLocaleLowerCase();

    if (!normalizedQuery) {
        return [...results];
    }

    return results
        .map((result, index) => ({ result, index, score: getDashboardCommandResultScore(result, normalizedQuery) }))
        .filter(
            (candidate): candidate is { result: DashboardCommandResult; index: number; score: number } =>
                candidate.score !== undefined
        )
        .sort((left, right) => left.score - right.score || left.index - right.index)
        .map(({ result }) => result);
}

function getDashboardCommandResultScore(result: DashboardCommandResult, normalizedQuery: string): number | undefined {
    const label = result.label.toLocaleLowerCase();

    if (label === normalizedQuery) {
        return 0;
    }

    if (label.startsWith(normalizedQuery)) {
        return 1;
    }

    if (label.split(/\s+/u).some((word) => word.startsWith(normalizedQuery))) {
        return 2;
    }

    if (label.includes(normalizedQuery)) {
        return 3;
    }

    if (result.keywords.includes(normalizedQuery)) {
        return 4;
    }

    const tokens = normalizedQuery.split(/\s+/u).filter(Boolean);

    return tokens.every((token) => result.keywords.includes(token)) ? 5 : undefined;
}

function getDashboardCommandResultClassName(active: boolean): string {
    const base =
        'flex min-h-14 items-center gap-3 rounded-[var(--dash-radius-control)] border px-3 text-[var(--dash-text-muted)] transition outline-none hover:border-[var(--dash-border)] hover:bg-[var(--dash-surface-raised)] hover:text-[var(--dash-text)] focus-visible:border-[var(--dash-primary)] focus-visible:bg-[var(--dash-surface-raised)] focus-visible:shadow-[var(--dash-shadow-focus)]';

    return active
        ? `${base} border-[var(--dash-border-interactive)] bg-[var(--dash-surface-raised)] text-[var(--dash-text)]`
        : `${base} border-transparent`;
}

function getDashboardCommandResultElementId(resultsId: string, resultId: string): string {
    return `${resultsId}-${resultId.replaceAll(':', '-')}`;
}

function mod(value: number, divisor: number): number {
    return ((value % divisor) + divisor) % divisor;
}

function getFirstResultIndex(
    orderedResults: readonly DashboardCommandResult[],
    groupResults: readonly DashboardCommandResult[]
): number {
    const firstIndex = orderedResults.findIndex((result) =>
        groupResults.some((candidate) => candidate.id === result.id)
    );

    return firstIndex < 0 ? Number.POSITIVE_INFINITY : firstIndex;
}

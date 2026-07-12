import { Link } from '@tanstack/react-router';
import { Search, Server, X } from 'lucide-react';
import { createContext, use, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';

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
    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState('');
    const results = useMemo(
        () => buildDashboardCommandResults({ guildId, guilds, pathname }),
        [guildId, guilds, pathname]
    );
    const filteredResults = useMemo(() => filterDashboardCommandResults(results, query), [query, results]);
    const activeGuild = guilds.find((guild) => guild.id === guildId);

    const openSearch = useCallback((returnFocusTo?: HTMLElement) => {
        returnFocusRef.current = returnFocusTo;
        setQuery('');
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
                            value={query}
                            onChange={(event) => setQuery(event.currentTarget.value)}
                            placeholder='Search tools or servers'
                            className='min-w-0 flex-1 bg-transparent text-sm text-[var(--dash-text)] outline-none placeholder:text-[var(--dash-text-subtle)]'
                        />
                        <kbd className='rounded border border-[var(--dash-border)] px-1.5 py-0.5 text-[0.68rem] text-[var(--dash-text-subtle)]'>
                            Esc
                        </kbd>
                    </label>
                    <div className='min-h-0 overflow-y-auto p-4'>
                        {filteredResults.length > 0 ? (
                            <ul className='space-y-1' aria-label='Search results'>
                                {filteredResults.map((result) => (
                                    <li key={result.id}>
                                        <Link
                                            to={result.href}
                                            preload='intent'
                                            state={getDashboardCommandResultState(result, activeGuild)}
                                            onClick={closeSearch}
                                            className='flex min-h-14 items-center gap-3 rounded-[var(--dash-radius-control)] border border-transparent px-3 text-[var(--dash-text-muted)] transition outline-none hover:border-[var(--dash-border)] hover:bg-[var(--dash-surface-raised)] hover:text-[var(--dash-text)] focus-visible:border-[var(--dash-primary)] focus-visible:bg-[var(--dash-surface-raised)] focus-visible:shadow-[var(--dash-shadow-focus)]'>
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
                                        </Link>
                                    </li>
                                ))}
                            </ul>
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
                    : 'flex min-h-11 w-full items-center justify-center gap-2 rounded-[var(--dash-radius-control)] border border-[var(--dash-border)] px-2 text-sm font-semibold text-[var(--dash-text-muted)] transition outline-none hover:border-[var(--dash-border-interactive)] hover:bg-[var(--dash-surface-raised)] hover:text-[var(--dash-text)] focus-visible:border-[var(--dash-primary)] focus-visible:shadow-[var(--dash-shadow-focus)] xl:justify-start'
            }>
            <Search className='size-4 shrink-0' aria-hidden='true' />
            {compact ? null : (
                <>
                    <span className='hidden min-w-0 flex-1 truncate xl:block'>Search</span>
                    <kbd className='hidden rounded border border-[var(--dash-border)] px-1.5 py-0.5 text-[0.65rem] font-medium text-[var(--dash-text-subtle)] xl:block'>
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

    return results.filter((result) => result.keywords.includes(normalizedQuery));
}

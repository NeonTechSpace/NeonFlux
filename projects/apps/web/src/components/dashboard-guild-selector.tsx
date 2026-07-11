import { ArrowDownAZ, Check, ChevronDown, Plus, Search, Server } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useMemo, useRef, useState } from 'react';

import type { DashboardGuildShellGuild } from '../server/dashboard-guild-page.server.js';
import { useDashboardDisplayPreferences } from './dashboard-display-preferences-store.js';

type DashboardGuildSelectorProps = {
    guilds: DashboardGuildShellGuild[];
    activeGuildId: string;
    pathname: string;
    botInviteUrl?: string;
    variant?: 'sidebar' | 'sheet';
};

export function DashboardGuildSelector({
    guilds,
    activeGuildId,
    pathname,
    botInviteUrl,
    variant = 'sidebar',
}: DashboardGuildSelectorProps) {
    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState('');
    const selectorRef = useRef<HTMLElement>(null);
    const triggerRef = useRef<HTMLButtonElement>(null);
    const sortByName = useDashboardDisplayPreferences((state) => state.guildSelectorSortByName);
    const setSortByName = useDashboardDisplayPreferences((state) => state.setGuildSelectorSortByName);
    const activeGuild = guilds.find((guild) => guild.id === activeGuildId) ?? {
        id: activeGuildId,
        name: 'Select server',
    };
    const selectableGuilds = useMemo(() => {
        const normalizedQuery = query.trim().toLocaleLowerCase();
        const availableGuilds = guilds.filter((guild) => {
            if (guild.id === activeGuildId) {
                return false;
            }

            return normalizedQuery.length === 0 || guild.name.toLocaleLowerCase().includes(normalizedQuery);
        });

        return sortByName
            ? [...availableGuilds].sort((left, right) => left.name.localeCompare(right.name))
            : availableGuilds;
    }, [activeGuildId, guilds, query, sortByName]);

    useEffect(() => {
        if (!open) {
            return;
        }

        function handlePointerDown(event: PointerEvent): void {
            if (event.target instanceof Node && !selectorRef.current?.contains(event.target)) {
                setOpen(false);
                setQuery('');
            }
        }

        function handleEscape(event: KeyboardEvent): void {
            if (event.key === 'Escape') {
                setOpen(false);
                setQuery('');
                triggerRef.current?.focus();
            }
        }

        window.addEventListener('pointerdown', handlePointerDown);
        window.addEventListener('keydown', handleEscape);

        return () => {
            window.removeEventListener('pointerdown', handlePointerDown);
            window.removeEventListener('keydown', handleEscape);
        };
    }, [open]);

    function closeSelector(): void {
        setOpen(false);
        setQuery('');
    }

    return (
        <nav ref={selectorRef} className='relative min-w-0' aria-label='Servers'>
            <button
                ref={triggerRef}
                type='button'
                aria-label={open ? 'Hide server picker' : 'Show server picker'}
                aria-expanded={open}
                onClick={() => setOpen((current) => !current)}
                className='flex min-h-12 w-full items-center gap-3 rounded-[var(--dash-radius-control)] border border-[var(--dash-border)] bg-[rgba(9,14,23,0.88)] px-2.5 text-left text-[var(--dash-text)] shadow-[var(--dash-shadow-surface)] transition outline-none hover:border-[var(--dash-border-interactive)] hover:bg-[var(--dash-surface-raised)] focus-visible:border-[var(--dash-primary)] focus-visible:shadow-[var(--dash-shadow-focus)]'>
                <span
                    className='grid size-9 shrink-0 place-items-center overflow-hidden rounded-full border border-[var(--dash-border)] bg-[var(--dash-surface-raised)]'
                    aria-hidden='true'>
                    <DashboardGuildSelectorAvatar guild={activeGuild} />
                </span>
                <span className={variant === 'sheet' ? 'min-w-0 flex-1' : 'hidden min-w-0 flex-1 xl:block'}>
                    <span className='block text-[0.68rem] font-semibold tracking-[0.12em] text-[var(--dash-text-subtle)] uppercase'>
                        Server
                    </span>
                    <span className='block truncate text-sm font-semibold'>{activeGuild.name}</span>
                </span>
                <ChevronDown
                    className={
                        variant === 'sheet'
                            ? `size-4 shrink-0 text-[var(--dash-text-muted)] transition ${open ? 'rotate-180' : ''}`
                            : `hidden size-4 shrink-0 text-[var(--dash-text-muted)] transition xl:block ${open ? 'rotate-180' : ''}`
                    }
                    aria-hidden='true'
                />
            </button>
            <AnimatePresence initial={false}>
                {open ? (
                    <motion.div
                        initial={{ opacity: 0, y: -4, scale: 0.98 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: -4, scale: 0.98 }}
                        transition={{ duration: 0.16, ease: 'easeOut' }}
                        className={getSelectorPopoverClassName(variant)}>
                        <div className='flex items-center gap-2 border-b border-[var(--dash-border)] p-2'>
                            <label className='flex min-h-10 min-w-0 flex-1 items-center gap-2 rounded-[var(--dash-radius-control)] border border-[var(--dash-border)] bg-[rgba(5,9,15,0.62)] px-3 focus-within:border-[var(--dash-primary)] focus-within:shadow-[var(--dash-shadow-focus)]'>
                                <Search className='size-4 shrink-0 text-[var(--dash-text-muted)]' aria-hidden='true' />
                                <span className='sr-only'>Search servers</span>
                                <input
                                    type='search'
                                    value={query}
                                    onChange={(event) => setQuery(event.currentTarget.value)}
                                    placeholder='Find a server'
                                    className='min-w-0 flex-1 bg-transparent text-sm text-[var(--dash-text)] outline-none placeholder:text-[var(--dash-text-subtle)]'
                                />
                            </label>
                            <button
                                type='button'
                                aria-label={sortByName ? 'Use recent server order' : 'Sort servers by name'}
                                aria-pressed={sortByName}
                                title={sortByName ? 'Use recent server order' : 'Sort servers by name'}
                                onClick={() => setSortByName(!sortByName)}
                                className={getSortButtonClassName(sortByName)}>
                                <ArrowDownAZ className='size-4' aria-hidden='true' />
                            </button>
                        </div>
                        <ul className='max-h-[min(22rem,52dvh)] space-y-1 overflow-y-auto p-2'>
                            <li>
                                <span className='flex min-h-11 items-center gap-3 rounded-[var(--dash-radius-control)] bg-[var(--dash-surface-selected)] px-2.5 text-[var(--dash-text)]'>
                                    <span
                                        className='grid size-8 shrink-0 place-items-center overflow-hidden rounded-full border border-[var(--dash-border-interactive)] bg-[var(--dash-surface-raised)]'
                                        aria-hidden='true'>
                                        <DashboardGuildSelectorAvatar guild={activeGuild} />
                                    </span>
                                    <span className='min-w-0 flex-1 truncate text-sm font-semibold'>
                                        {activeGuild.name}
                                    </span>
                                    <Check
                                        className='size-4 shrink-0 text-[var(--dash-primary)]'
                                        aria-label='Current server'
                                    />
                                </span>
                            </li>
                            {selectableGuilds.map((guild) => (
                                <li key={guild.id}>
                                    <a
                                        href={getDashboardGuildSwitchPath(activeGuildId, guild.id, pathname)}
                                        onClick={closeSelector}
                                        className='flex min-h-11 items-center gap-3 rounded-[var(--dash-radius-control)] border border-transparent px-2.5 text-[var(--dash-text-muted)] transition outline-none hover:border-[var(--dash-border)] hover:bg-[var(--dash-surface-raised)] hover:text-[var(--dash-text)] focus-visible:border-[var(--dash-primary)] focus-visible:shadow-[var(--dash-shadow-focus)]'>
                                        <span
                                            className='grid size-8 shrink-0 place-items-center overflow-hidden rounded-full border border-[var(--dash-border)] bg-[var(--dash-surface-raised)]'
                                            aria-hidden='true'>
                                            <DashboardGuildSelectorAvatar guild={guild} />
                                        </span>
                                        <span className='min-w-0 flex-1 truncate text-sm font-semibold'>
                                            {guild.name}
                                        </span>
                                    </a>
                                </li>
                            ))}
                            {selectableGuilds.length === 0 && query.trim().length > 0 ? (
                                <li className='px-3 py-4 text-center text-sm text-[var(--dash-text-muted)]'>
                                    No matching servers
                                </li>
                            ) : null}
                            {botInviteUrl ? (
                                <li className='border-t border-[var(--dash-border)] pt-2'>
                                    <a
                                        href={botInviteUrl}
                                        onClick={closeSelector}
                                        className='flex min-h-11 items-center gap-3 rounded-[var(--dash-radius-control)] border border-transparent px-2.5 text-[var(--dash-primary)] transition outline-none hover:border-[var(--dash-border-interactive)] hover:bg-[var(--dash-primary-soft)] focus-visible:border-[var(--dash-primary)] focus-visible:shadow-[var(--dash-shadow-focus)]'>
                                        <span className='grid size-8 shrink-0 place-items-center rounded-full border border-[var(--dash-border-interactive)] bg-[var(--dash-primary-soft)]'>
                                            <Plus className='size-4' aria-hidden='true' />
                                        </span>
                                        <span className='text-sm font-semibold'>Invite bot</span>
                                    </a>
                                </li>
                            ) : null}
                        </ul>
                    </motion.div>
                ) : null}
            </AnimatePresence>
        </nav>
    );
}

function getSelectorPopoverClassName(variant: 'sidebar' | 'sheet'): string {
    const base =
        'z-50 overflow-hidden rounded-[var(--dash-radius-panel)] border border-[var(--dash-border)] bg-[rgba(8,13,21,0.98)] shadow-[var(--dash-shadow-popover)] backdrop-blur-xl';

    return variant === 'sheet'
        ? `${base} relative mt-2 w-full`
        : `${base} absolute top-0 left-[calc(100%+0.75rem)] w-[min(20rem,calc(100vw-6rem))] xl:top-[calc(100%+0.5rem)] xl:left-0 xl:w-full`;
}

function getSortButtonClassName(active: boolean): string {
    const base =
        'grid size-10 shrink-0 place-items-center rounded-[var(--dash-radius-control)] border outline-none transition focus-visible:border-[var(--dash-primary)] focus-visible:shadow-[var(--dash-shadow-focus)]';

    return active
        ? `${base} border-[var(--dash-border-interactive)] bg-[var(--dash-primary-soft)] text-[var(--dash-primary)]`
        : `${base} border-[var(--dash-border)] text-[var(--dash-text-muted)] hover:bg-[var(--dash-surface-raised)] hover:text-[var(--dash-text)]`;
}

function DashboardGuildSelectorAvatar({ guild }: { guild: DashboardGuildShellGuild }) {
    if (guild.iconUrl) {
        return (
            <img
                src={guild.iconUrl}
                alt=''
                className='size-full object-cover'
                loading='lazy'
                referrerPolicy='no-referrer'
            />
        );
    }

    return guild.name ? (
        <span className='text-xs font-bold text-[var(--dash-text)]'>{getGuildFallbackLabel(guild.name)}</span>
    ) : (
        <Server className='size-4 text-[var(--dash-text-muted)]' aria-hidden='true' />
    );
}

export function getDashboardGuildSwitchPath(currentGuildId: string, nextGuildId: string, pathname: string): string {
    const currentGuildPath = `/dashboard/${currentGuildId}`;

    if (nextGuildId === currentGuildId && pathname.startsWith(currentGuildPath)) {
        return pathname;
    }

    if (pathname === currentGuildPath || pathname.startsWith(`${currentGuildPath}/`)) {
        return `/dashboard/${nextGuildId}${pathname.slice(currentGuildPath.length)}`;
    }

    return `/dashboard/${nextGuildId}`;
}

function getGuildFallbackLabel(name: string): string {
    const letters = name
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2)
        .map((part) => part.at(0)?.toUpperCase())
        .join('');

    return letters || '?';
}

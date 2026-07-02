import { ArrowDownAZ, ChevronRight, Menu, Plus, Server, X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { RefObject } from 'react';

import type { DashboardGuildShellGuild } from '../server/dashboard-guild-page.server.js';
import { useDashboardDisplayPreferences } from './dashboard-display-preferences-store.js';

type DashboardGuildSelectorProps = {
    guilds: DashboardGuildShellGuild[];
    activeGuildId: string;
    pathname: string;
    botInviteUrl?: string;
};

export function DashboardGuildSelector({ guilds, activeGuildId, pathname, botInviteUrl }: DashboardGuildSelectorProps) {
    const [mobileOpen, setMobileOpen] = useState(false);
    const desktopContainerRef = useRef<HTMLDivElement>(null);
    const desktopAvailableWidth = useElementWidth(desktopContainerRef);
    const desktopOpen = useDashboardDisplayPreferences((state) => state.desktopGuildSelectorOpen);
    const sortByName = useDashboardDisplayPreferences((state) => state.guildSelectorSortByName);
    const setDesktopOpen = useDashboardDisplayPreferences((state) => state.setDesktopGuildSelectorOpen);
    const setSortByName = useDashboardDisplayPreferences((state) => state.setGuildSelectorSortByName);
    const activeGuild = guilds.find((guild) => guild.id === activeGuildId) ?? {
        id: activeGuildId,
        name: 'Select server',
    };
    const displayedGuilds = useMemo(() => {
        if (!sortByName) {
            return guilds;
        }

        return [...guilds].sort((left, right) => left.name.localeCompare(right.name));
    }, [guilds, sortByName]);
    const selectableGuilds = displayedGuilds.filter((guild) => guild.id !== activeGuildId);
    const desktopUsedItems = selectableGuilds.length + (botInviteUrl ? 1 : 0);
    const desktopCapacity = getDesktopSelectorCapacity(desktopAvailableWidth);
    const desktopPlaceholderCount =
        desktopCapacity > desktopUsedItems ? Math.min(12, desktopCapacity - desktopUsedItems) : 0;
    const desktopVisibleSlots =
        desktopCapacity > 0 ? Math.min(desktopCapacity, desktopUsedItems + desktopPlaceholderCount) : desktopUsedItems;
    const desktopAllowScroll = desktopCapacity > 0 && desktopUsedItems > desktopCapacity;
    const desktopSelectorWidth =
        desktopVisibleSlots > 0
            ? Math.min(desktopAvailableWidth || Number.POSITIVE_INFINITY, getDesktopSelectorWidth(desktopVisibleSlots))
            : undefined;

    return (
        <>
            <nav className='lg:hidden' aria-label='Servers'>
                <button
                    type='button'
                    aria-label={mobileOpen ? 'Collapse servers' : 'Expand servers'}
                    aria-expanded={mobileOpen}
                    onClick={() => setMobileOpen((current) => !current)}
                    className='flex min-h-14 w-full items-center gap-3 rounded-[var(--dash-radius-panel)] border border-[var(--dash-border)] bg-[rgba(10,13,18,0.82)] px-3 text-left text-[var(--dash-text)] shadow-[var(--dash-shadow-surface)] backdrop-blur transition outline-none hover:border-[var(--dash-border-interactive)] hover:bg-[rgba(19,24,35,0.74)] focus-visible:border-[var(--dash-primary)] focus-visible:shadow-[var(--dash-shadow-focus)]'>
                    <span className='grid size-10 shrink-0 place-items-center overflow-hidden rounded-full border border-[var(--dash-border)] bg-[var(--dash-surface-raised)]'>
                        <DashboardGuildSelectorAvatar guild={activeGuild} />
                    </span>
                    <span className='min-w-0 flex-1'>
                        <span className='block text-xs font-semibold tracking-wide text-[var(--dash-text-subtle)] uppercase'>
                            Server
                        </span>
                        <span className='block truncate text-sm font-semibold'>{activeGuild.name}</span>
                    </span>
                    {mobileOpen ? (
                        <X className='size-4 shrink-0 text-[var(--dash-text-muted)]' aria-hidden='true' />
                    ) : (
                        <Menu className='size-4 shrink-0 text-[var(--dash-text-muted)]' aria-hidden='true' />
                    )}
                </button>
                <AnimatePresence initial={false}>
                    {mobileOpen ? (
                        <motion.div
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: 'auto', opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            transition={{ duration: 0.18, ease: 'easeOut' }}
                            className='overflow-hidden'>
                            <div className='mt-2 rounded-[var(--dash-radius-panel)] border border-[var(--dash-border)] bg-[rgba(10,13,18,0.92)] p-2 shadow-[var(--dash-shadow-popover)] backdrop-blur'>
                                <DashboardGuildSelectorControls
                                    sortByName={sortByName}
                                    onSortByNameChange={setSortByName}
                                    variant='mobile'
                                />
                                <DashboardGuildSelectorItems
                                    guilds={selectableGuilds}
                                    activeGuildId={activeGuildId}
                                    pathname={pathname}
                                    botInviteUrl={botInviteUrl}
                                    variant='mobile'
                                />
                            </div>
                        </motion.div>
                    ) : null}
                </AnimatePresence>
            </nav>
            <nav className='relative hidden h-[78px] min-w-0 flex-1 items-center gap-2 lg:flex' aria-label='Servers'>
                <button
                    type='button'
                    aria-label={desktopOpen ? 'Hide server picker' : 'Show server picker'}
                    aria-expanded={desktopOpen}
                    onClick={() => setDesktopOpen(!desktopOpen)}
                    className='grid size-9 shrink-0 place-items-center rounded-[var(--dash-radius-control)] border border-[var(--dash-border)] bg-[rgba(10,13,18,0.72)] text-[var(--dash-text-muted)] shadow-[var(--dash-shadow-surface)] backdrop-blur transition hover:border-[var(--dash-border-interactive)] hover:bg-[var(--dash-surface-raised)] hover:text-[var(--dash-text)] focus-visible:border-[var(--dash-primary)] focus-visible:shadow-[var(--dash-shadow-focus)] focus-visible:outline-none'>
                    <motion.span animate={{ rotate: desktopOpen ? 180 : 0 }} transition={{ duration: 0.18 }}>
                        <ChevronRight className='size-4' aria-hidden='true' />
                    </motion.span>
                </button>
                <div ref={desktopContainerRef} className='flex h-[78px] min-w-0 flex-1 items-center'>
                    <AnimatePresence initial={false}>
                        {desktopOpen ? (
                            <motion.div
                                key='desktop-server-picker'
                                initial={{ opacity: 0, scaleX: 0.96 }}
                                animate={{ opacity: 1, scaleX: 1 }}
                                exit={{ opacity: 0, scaleX: 0.96 }}
                                transition={{ duration: 0.18, ease: 'easeOut' }}
                                style={desktopSelectorWidth ? { width: desktopSelectorWidth } : undefined}
                                className='box-border flex h-[78px] max-w-full origin-left items-center gap-2 overflow-hidden rounded-[var(--dash-radius-panel)] border border-[rgba(34,41,56,0.78)] bg-[rgba(10,13,18,0.84)] p-[8px] shadow-[var(--dash-shadow-surface)] backdrop-blur-xl'>
                                <DashboardGuildSelectorControls
                                    sortByName={sortByName}
                                    onSortByNameChange={setSortByName}
                                    variant='desktop'
                                />
                                <DashboardGuildSelectorItems
                                    guilds={selectableGuilds}
                                    activeGuildId={activeGuildId}
                                    pathname={pathname}
                                    botInviteUrl={botInviteUrl}
                                    variant='desktop'
                                    allowScroll={desktopAllowScroll}
                                    placeholderCount={desktopPlaceholderCount}
                                />
                            </motion.div>
                        ) : null}
                    </AnimatePresence>
                </div>
            </nav>
        </>
    );
}

function DashboardGuildSelectorControls({
    sortByName,
    onSortByNameChange,
    variant,
}: {
    sortByName: boolean;
    onSortByNameChange: (sortByName: boolean) => void;
    variant: 'desktop' | 'mobile';
}) {
    return (
        <div
            className={
                variant === 'mobile'
                    ? 'mb-2 flex items-center justify-between gap-2 border-b border-[var(--dash-border)] pb-2'
                    : 'flex h-[60px] w-12 shrink-0 items-center justify-center border-r border-[var(--dash-border)] pr-2'
            }>
            {variant === 'mobile' ? (
                <span className='text-xs font-semibold tracking-wide text-[var(--dash-text-subtle)] uppercase'>
                    Servers
                </span>
            ) : null}
            <button
                type='button'
                aria-label={sortByName ? 'Use recent server order' : 'Sort servers by name'}
                aria-pressed={sortByName}
                onClick={() => onSortByNameChange(!sortByName)}
                className={
                    sortByName
                        ? 'grid size-8 place-items-center rounded-[var(--dash-radius-control)] border border-transparent bg-[var(--dash-primary-soft)] text-[var(--dash-primary)] shadow-[var(--dash-shadow-focus)] transition focus-visible:outline-none'
                        : 'grid size-8 place-items-center rounded-[var(--dash-radius-control)] border border-transparent text-[var(--dash-text-muted)] transition hover:bg-[var(--dash-primary-soft)] hover:text-[var(--dash-text)] focus-visible:border-[var(--dash-primary)] focus-visible:shadow-[var(--dash-shadow-focus)] focus-visible:outline-none'
                }>
                <ArrowDownAZ className='size-4' aria-hidden='true' />
            </button>
        </div>
    );
}

function DashboardGuildSelectorItems({
    guilds,
    activeGuildId,
    pathname,
    botInviteUrl,
    variant,
    allowScroll = true,
    placeholderCount = 0,
}: DashboardGuildSelectorProps & { variant: 'desktop' | 'mobile'; allowScroll?: boolean; placeholderCount?: number }) {
    const listClassName =
        variant === 'mobile'
            ? 'flex max-h-[62dvh] flex-col gap-1 overflow-y-auto'
            : allowScroll
              ? 'grid h-[60px] min-w-0 flex-1 grid-flow-col auto-cols-[120px] items-stretch gap-2 overflow-x-auto overflow-y-hidden'
              : 'grid h-[60px] min-w-0 flex-1 grid-flow-col auto-cols-[120px] items-stretch gap-2 overflow-hidden';
    const itemClassName = variant === 'mobile' ? 'shrink-0' : 'h-full min-w-0';

    return (
        <ul className={listClassName}>
            {botInviteUrl ? (
                <li className={itemClassName}>
                    <a
                        href={botInviteUrl}
                        className={getGuildSelectorItemClassName({ active: false, variant, tone: 'invite' })}>
                        <span className={getGuildSelectorAvatarFrameClassName(variant, true)}>
                            <Plus className='size-5' aria-hidden='true' />
                        </span>
                        <span className={getGuildSelectorLabelClassName(variant)}>Invite bot</span>
                    </a>
                </li>
            ) : null}
            {guilds.map((guild) => {
                const active = guild.id === activeGuildId;
                const href = getDashboardGuildSwitchPath(activeGuildId, guild.id, pathname);

                return (
                    <li key={guild.id} className={itemClassName}>
                        <a
                            href={href}
                            aria-current={active ? 'page' : undefined}
                            className={getGuildSelectorItemClassName({ active, variant, tone: 'guild' })}>
                            <span className={getGuildSelectorAvatarFrameClassName(variant, false)} aria-hidden='true'>
                                {active ? (
                                    <motion.span
                                        layoutId={`dashboard-guild-selector-active-${variant}`}
                                        className='absolute inset-0 bg-[var(--dash-primary-soft)]'
                                        transition={{ duration: 0.16, ease: 'easeOut' }}
                                    />
                                ) : null}
                                <DashboardGuildSelectorAvatar guild={guild} />
                            </span>
                            <span className={getGuildSelectorLabelClassName(variant)}>{guild.name}</span>
                        </a>
                    </li>
                );
            })}
            {Array.from({ length: placeholderCount }, (_, index) => (
                <li key={`placeholder-${String(index)}`} className={itemClassName} aria-hidden='true'>
                    <span className='relative flex h-full w-full flex-col items-center justify-center gap-1 rounded-[var(--dash-radius-control)] border border-dashed border-[rgba(107,125,152,0.22)] bg-[rgba(56,189,248,0.04)] px-2 py-1 opacity-70'>
                        <span className='size-9 rounded-full border border-[rgba(107,125,152,0.2)] bg-[rgba(12,18,30,0.58)]' />
                        <span className='h-2 w-14 rounded-full bg-[rgba(107,125,152,0.18)]' />
                    </span>
                </li>
            ))}
        </ul>
    );
}

function DashboardGuildSelectorAvatar({ guild }: { guild: DashboardGuildShellGuild }) {
    if (guild.iconUrl) {
        return (
            <img
                src={guild.iconUrl}
                alt=''
                className='relative size-full object-cover'
                loading='lazy'
                referrerPolicy='no-referrer'
            />
        );
    }

    return guild.name ? (
        <span className='relative text-sm font-bold text-[var(--dash-text)]'>{getGuildFallbackLabel(guild.name)}</span>
    ) : (
        <Server className='relative size-4 text-[var(--dash-text-muted)]' aria-hidden='true' />
    );
}

function getGuildSelectorItemClassName({
    active,
    variant,
    tone,
}: {
    active: boolean;
    variant: 'desktop' | 'mobile';
    tone: 'guild' | 'invite';
}) {
    const sizing = 'w-full';
    const base =
        variant === 'mobile'
            ? 'relative flex min-h-13 items-center gap-3 rounded-[var(--dash-radius-control)] border px-3 py-2 text-[var(--dash-text-muted)] outline-none transition'
            : 'relative flex h-full min-h-0 flex-col items-center justify-center gap-1 rounded-[var(--dash-radius-control)] border px-2 py-1 text-[var(--dash-text-muted)] outline-none transition';

    if (active) {
        return `${base} ${sizing} border-transparent bg-[var(--dash-primary-soft)] text-[var(--dash-text)] shadow-[var(--dash-shadow-focus)]`;
    }

    if (tone === 'invite') {
        return `${base} ${sizing} border-[var(--dash-border)] bg-[var(--dash-surface)] text-[var(--dash-primary)] hover:border-[var(--dash-primary)] hover:bg-[var(--dash-primary-soft)] focus-visible:border-[var(--dash-primary)] focus-visible:shadow-[var(--dash-shadow-focus)]`;
    }

    return `${base} ${sizing} border-transparent hover:border-[var(--dash-border)] hover:bg-[var(--dash-surface-raised)] hover:text-[var(--dash-text)] focus-visible:border-[var(--dash-primary)] focus-visible:bg-[var(--dash-surface-raised)] focus-visible:text-[var(--dash-text)] focus-visible:shadow-[var(--dash-shadow-focus)]`;
}

function getGuildSelectorAvatarFrameClassName(variant: 'desktop' | 'mobile', invite: boolean): string {
    const size = variant === 'desktop' ? 'size-8' : 'size-10';
    const tone = invite
        ? 'border-[var(--dash-border-interactive)] bg-[var(--dash-primary-soft)] text-[var(--dash-primary)]'
        : 'border-[var(--dash-border)] bg-[var(--dash-surface-raised)]';

    return `relative grid ${size} shrink-0 place-items-center overflow-hidden rounded-full border ${tone}`;
}

function getGuildSelectorLabelClassName(variant: 'desktop' | 'mobile'): string {
    return variant === 'desktop'
        ? 'block w-full truncate text-center text-[0.72rem] leading-tight font-semibold'
        : 'block min-w-0 flex-1 truncate text-sm font-semibold';
}

function useElementWidth(ref: RefObject<HTMLElement | null>): number {
    const [width, setWidth] = useState(0);

    useEffect(() => {
        const element = ref.current;

        if (!element || typeof ResizeObserver === 'undefined') {
            return;
        }

        const observer = new ResizeObserver(([entry]) => {
            setWidth(entry.contentRect.width);
        });

        observer.observe(element);

        return () => observer.disconnect();
    }, [ref]);

    return width;
}

const desktopSelectorItemWidth = 120;
const desktopSelectorItemGap = 8;
const desktopSelectorChromeWidth = 72;
const desktopSelectorTrailingRoom = 0;

function getDesktopSelectorCapacity(availableWidth: number): number {
    if (availableWidth <= desktopSelectorChromeWidth + desktopSelectorTrailingRoom) {
        return 0;
    }

    return Math.max(
        1,
        Math.floor(
            (availableWidth - desktopSelectorChromeWidth - desktopSelectorTrailingRoom + desktopSelectorItemGap) /
                (desktopSelectorItemWidth + desktopSelectorItemGap)
        )
    );
}

function getDesktopSelectorWidth(visibleSlots: number): number {
    return (
        desktopSelectorChromeWidth +
        visibleSlots * desktopSelectorItemWidth +
        Math.max(0, visibleSlots - 1) * desktopSelectorItemGap +
        desktopSelectorTrailingRoom
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

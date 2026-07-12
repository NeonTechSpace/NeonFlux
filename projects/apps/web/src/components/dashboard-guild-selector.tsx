import { Link } from '@tanstack/react-router';
import { ArrowDownAZ, Check, ChevronsUpDown, Search, X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent } from 'react';
import { createPortal } from 'react-dom';

import { createDashboardGuildPreview, withDashboardGuildPreview } from '../dashboard-guild-preview.js';
import type { DashboardGuildShellGuild } from '../server/dashboard-guild-page.server.js';
import { useDashboardDisplayPreferences } from './dashboard-display-preferences-store.js';
import {
    DashboardGuildSelectorAvatar,
    DashboardServerDockActionTile as DashboardActionTile,
    DashboardServerDockAvatar as DashboardDockAvatar,
    dashboardServerDockSpring as dockSpring,
    getDashboardServerDockClassName as getDockClassName,
    getDashboardServerDockSortButtonClassName as getSortButtonClassName,
    getDashboardServerDockTileClassName as getDockTileClassName,
    getDashboardServerTriggerClassName as getTriggerClassName,
} from './dashboard-server-dock-ui.js';

type DashboardGuildSelectorProps = {
    guilds: DashboardGuildShellGuild[];
    activeGuildId: string;
    pathname: string;
    botInviteUrl?: string;
    pendingGuildId?: string;
    variant?: 'sidebar' | 'mobile-header';
    activeLabel?: string;
};

const serverToolsThreshold = 7;

export function DashboardGuildSelector({
    guilds,
    activeGuildId,
    pathname,
    botInviteUrl,
    pendingGuildId: routePendingGuildId,
    variant = 'sidebar',
    activeLabel,
}: DashboardGuildSelectorProps) {
    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState('');
    const [localPendingGuildId, setLocalPendingGuildId] = useState<string>();
    const [desktopDockPosition, setDesktopDockPosition] = useState<{ left: number; top: number }>();
    const selectorRef = useRef<HTMLElement>(null);
    const triggerRef = useRef<HTMLButtonElement>(null);
    const dockRef = useRef<HTMLElement>(null);
    const dockCloseRef = useRef<HTMLButtonElement>(null);
    const searchInputRef = useRef<HTMLInputElement>(null);
    const dockId = `dashboard-server-dock-${useId().replaceAll(':', '')}`;
    const sortByName = useDashboardDisplayPreferences((state) => state.guildSelectorSortByName);
    const setSortByName = useDashboardDisplayPreferences((state) => state.setGuildSelectorSortByName);
    const activeGuild = guilds.find((guild) => guild.id === activeGuildId) ?? {
        id: activeGuildId,
        name: 'Current server',
    };
    const showTools = guilds.length >= serverToolsThreshold;
    const selectableGuilds = useMemo(() => {
        const normalizedQuery = query.trim().toLocaleLowerCase();
        const availableGuilds = guilds.filter((guild) => {
            if (guild.id === activeGuildId) {
                return false;
            }

            return normalizedQuery.length === 0 || guild.name.toLocaleLowerCase().includes(normalizedQuery);
        });

        return showTools && sortByName
            ? [...availableGuilds].sort((left, right) => left.name.localeCompare(right.name))
            : availableGuilds;
    }, [activeGuildId, guilds, query, showTools, sortByName]);
    const pendingGuildId = localPendingGuildId ?? routePendingGuildId;

    useEffect(() => {
        if (!open) {
            return;
        }

        function handlePointerDown(event: PointerEvent): void {
            if (
                event.target instanceof Node &&
                !selectorRef.current?.contains(event.target) &&
                !dockRef.current?.contains(event.target)
            ) {
                closeSelector({ restoreFocus: variant === 'mobile-header' });
            }
        }

        function handleEscape(event: KeyboardEvent): void {
            if (event.key === 'Escape') {
                event.preventDefault();
                closeSelector();
            }
        }

        function handleDesktopBreakpoint(event: MediaQueryListEvent): void {
            if (event.matches) {
                closeSelector({ restoreFocus: false });
            }
        }

        function handleDesktopViewportChange(event: Event): void {
            if (variant === 'sidebar') {
                if (
                    event.type === 'scroll' &&
                    event.target instanceof Node &&
                    dockRef.current?.contains(event.target)
                ) {
                    return;
                }

                closeSelector({ restoreFocus: false });
            }
        }

        const desktopMedia =
            variant === 'mobile-header' && typeof window.matchMedia === 'function'
                ? window.matchMedia('(min-width: 768px)')
                : undefined;

        window.addEventListener('pointerdown', handlePointerDown);
        window.addEventListener('keydown', handleEscape);
        window.addEventListener('resize', handleDesktopViewportChange);
        window.addEventListener('scroll', handleDesktopViewportChange, true);
        desktopMedia?.addEventListener('change', handleDesktopBreakpoint);

        queueMicrotask(() => dockCloseRef.current?.focus());

        return () => {
            window.removeEventListener('pointerdown', handlePointerDown);
            window.removeEventListener('keydown', handleEscape);
            window.removeEventListener('resize', handleDesktopViewportChange);
            window.removeEventListener('scroll', handleDesktopViewportChange, true);
            desktopMedia?.removeEventListener('change', handleDesktopBreakpoint);
        };
    }, [open, variant]);

    function closeSelector({ restoreFocus = true }: { restoreFocus?: boolean } = {}): void {
        setOpen(false);
        setQuery('');
        setLocalPendingGuildId(undefined);
        setDesktopDockPosition(undefined);

        if (restoreFocus) {
            queueMicrotask(() => triggerRef.current?.focus());
        }
    }

    function openSelector(): void {
        if (variant === 'sidebar') {
            const selectorBounds = selectorRef.current?.getBoundingClientRect();

            if (selectorBounds) {
                setDesktopDockPosition({
                    left: selectorBounds.right + 12,
                    top: Math.max(8, selectorBounds.top),
                });
            }
        }

        setOpen(true);
    }

    function handleDockKeyDown(event: ReactKeyboardEvent<HTMLElement>): void {
        if (event.key !== 'Tab') {
            return;
        }

        const focusable = dockRef.current?.querySelectorAll<HTMLElement>(
            'a[href], button:not([disabled]), input:not([disabled])'
        );

        if (!focusable || focusable.length === 0) {
            return;
        }

        const first = focusable.item(0);
        const last = focusable.item(focusable.length - 1);

        if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
        }
    }

    function handleServerNavigate(event: ReactMouseEvent<HTMLAnchorElement>, guildId: string): void {
        if (event.button === 0 && !event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey) {
            setLocalPendingGuildId(guildId);
        }
    }

    const triggerLabel = open ? 'Close server dock' : `Switch server, currently ${activeGuild.name}`;

    return (
        <nav ref={selectorRef} className='relative min-w-0' aria-label='Servers'>
            <button
                ref={triggerRef}
                type='button'
                aria-label={triggerLabel}
                title={`Switch server — ${activeGuild.name}`}
                aria-expanded={open}
                aria-controls={dockId}
                onClick={() => (open ? closeSelector() : openSelector())}
                className={getTriggerClassName(variant)}>
                <span className='relative grid size-9 shrink-0 place-items-center overflow-visible rounded-full border border-[var(--dash-border)] bg-[var(--dash-surface-raised)]'>
                    <span className='grid size-full place-items-center overflow-hidden rounded-full' aria-hidden='true'>
                        <DashboardGuildSelectorAvatar guild={activeGuild} />
                    </span>
                    <span className='absolute -right-1 -bottom-1 grid size-[1.15rem] place-items-center rounded-full border border-[var(--dash-border-interactive)] bg-[var(--dash-navigation)] text-[var(--dash-primary)] shadow-[0_0_12px_rgba(90,215,255,0.34)]'>
                        <ChevronsUpDown className='size-2.5' aria-hidden='true' />
                    </span>
                </span>
                <span
                    className={variant === 'mobile-header' ? 'min-w-0 flex-1' : 'hidden min-w-0 flex-1 lg:block'}
                    title={activeGuild.name}>
                    {variant === 'mobile-header' ? (
                        <>
                            <span className='block truncate text-sm font-semibold'>{activeGuild.name}</span>
                            <span className='block truncate text-xs text-[var(--dash-text-muted)]'>
                                {activeLabel ?? 'Switch server'}
                            </span>
                        </>
                    ) : (
                        <>
                            <span className='line-clamp-2 block text-sm leading-4 font-semibold'>
                                {activeGuild.name}
                            </span>
                        </>
                    )}
                </span>
                <ChevronsUpDown
                    className={
                        variant === 'mobile-header'
                            ? 'size-4 shrink-0 text-[var(--dash-primary)]'
                            : 'hidden size-4 shrink-0 text-[var(--dash-primary)] lg:block'
                    }
                    aria-hidden='true'
                />
            </button>

            <AnimatePresence initial={false}>
                {open ? (
                    <DashboardServerDock
                        id={dockId}
                        variant={variant}
                        dockRef={dockRef}
                        closeRef={dockCloseRef}
                        searchInputRef={searchInputRef}
                        activeGuild={activeGuild}
                        activeGuildId={activeGuildId}
                        selectableGuilds={selectableGuilds}
                        pathname={pathname}
                        botInviteUrl={botInviteUrl}
                        pendingGuildId={pendingGuildId}
                        navigationDisabledGuildId={routePendingGuildId}
                        portalHost={selectorRef.current?.closest<HTMLElement>('.dashboard-theme')}
                        desktopPosition={desktopDockPosition}
                        query={query}
                        showTools={showTools}
                        sortByName={sortByName}
                        onClose={() => closeSelector()}
                        onDockKeyDown={handleDockKeyDown}
                        onQueryChange={setQuery}
                        onServerNavigate={handleServerNavigate}
                        onSortByNameChange={setSortByName}
                    />
                ) : null}
            </AnimatePresence>
        </nav>
    );
}

function DashboardServerDock({
    id,
    variant,
    dockRef,
    closeRef,
    searchInputRef,
    activeGuild,
    activeGuildId,
    selectableGuilds,
    pathname,
    botInviteUrl,
    pendingGuildId,
    navigationDisabledGuildId,
    portalHost,
    desktopPosition,
    query,
    showTools,
    sortByName,
    onClose,
    onDockKeyDown,
    onQueryChange,
    onServerNavigate,
    onSortByNameChange,
}: {
    id: string;
    variant: 'sidebar' | 'mobile-header';
    dockRef: React.RefObject<HTMLElement | null>;
    closeRef: React.RefObject<HTMLButtonElement | null>;
    searchInputRef: React.RefObject<HTMLInputElement | null>;
    activeGuild: DashboardGuildShellGuild;
    activeGuildId: string;
    selectableGuilds: DashboardGuildShellGuild[];
    pathname: string;
    botInviteUrl?: string;
    pendingGuildId?: string;
    navigationDisabledGuildId?: string;
    portalHost?: HTMLElement | null;
    desktopPosition?: { left: number; top: number };
    query: string;
    showTools: boolean;
    sortByName: boolean;
    onClose: () => void;
    onDockKeyDown: (event: ReactKeyboardEvent<HTMLElement>) => void;
    onQueryChange: (query: string) => void;
    onServerNavigate: (event: ReactMouseEvent<HTMLAnchorElement>, guildId: string) => void;
    onSortByNameChange: (sortByName: boolean) => void;
}) {
    const dock = (
        <motion.section
            ref={dockRef}
            id={id}
            role='dialog'
            aria-modal={variant === 'mobile-header' ? true : undefined}
            aria-label='Switch server'
            initial={
                variant === 'mobile-header' ? { opacity: 0, y: 32, scale: 0.98 } : { opacity: 0, x: -18, scale: 0.97 }
            }
            animate={{ opacity: 1, x: 0, y: 0, scale: 1 }}
            exit={
                variant === 'mobile-header' ? { opacity: 0, y: 24, scale: 0.98 } : { opacity: 0, x: -12, scale: 0.98 }
            }
            transition={dockSpring}
            onKeyDown={onDockKeyDown}
            style={variant === 'sidebar' ? desktopPosition : undefined}
            className={getDockClassName(variant)}>
            <div className='flex shrink-0 items-center gap-3 border-b border-[var(--dash-border)] px-3 py-3 sm:px-4'>
                <h2 className='min-w-0 flex-1 truncate text-base font-semibold text-[var(--dash-text)]'>
                    Switch server
                </h2>
                <button
                    ref={closeRef}
                    type='button'
                    aria-label='Close server dock'
                    onClick={onClose}
                    className='grid size-11 shrink-0 place-items-center rounded-[var(--dash-radius-control)] border border-transparent text-[var(--dash-text-muted)] transition outline-none hover:border-[var(--dash-border)] hover:bg-[var(--dash-surface-raised)] hover:text-[var(--dash-text)] focus-visible:border-[var(--dash-primary)] focus-visible:shadow-[var(--dash-shadow-focus)]'>
                    <X className='size-4' aria-hidden='true' />
                </button>
            </div>

            {showTools ? (
                <div className='flex shrink-0 items-center gap-2 border-b border-[var(--dash-border)] p-3 sm:px-4'>
                    <label className='flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded-[var(--dash-radius-control)] border border-[var(--dash-border)] bg-[rgba(5,9,15,0.62)] px-3 focus-within:border-[var(--dash-primary)] focus-within:shadow-[var(--dash-shadow-focus)]'>
                        <Search className='size-4 shrink-0 text-[var(--dash-text-muted)]' aria-hidden='true' />
                        <span className='sr-only'>Search servers</span>
                        <input
                            ref={searchInputRef}
                            type='search'
                            value={query}
                            onChange={(event) => onQueryChange(event.currentTarget.value)}
                            placeholder='Find a server'
                            className='min-w-0 flex-1 bg-transparent text-sm text-[var(--dash-text)] outline-none placeholder:text-[var(--dash-text-subtle)]'
                        />
                    </label>
                    <button
                        type='button'
                        aria-label={sortByName ? 'Use default server order' : 'Sort servers by name'}
                        aria-pressed={sortByName}
                        title={sortByName ? 'Use default server order' : 'Sort servers by name'}
                        onClick={() => onSortByNameChange(!sortByName)}
                        className={getSortButtonClassName(sortByName)}>
                        <ArrowDownAZ className='size-4' aria-hidden='true' />
                    </button>
                </div>
            ) : null}

            <div className='min-h-0 flex-1 overflow-y-auto p-3 sm:p-4'>
                <ul className='grid grid-cols-[repeat(auto-fit,minmax(6.6rem,1fr))] gap-2'>
                    <DashboardCurrentGuildTile guild={activeGuild} layoutId={`${id}-current`} />
                    {selectableGuilds.map((guild) => (
                        <DashboardGuildLinkTile
                            key={guild.id}
                            guild={guild}
                            sourceGuild={activeGuild}
                            href={getDashboardGuildSwitchPath(activeGuildId, guild.id, pathname)}
                            pending={pendingGuildId === guild.id}
                            navigationDisabled={navigationDisabledGuildId === guild.id}
                            onNavigate={onServerNavigate}
                        />
                    ))}
                    <DashboardActionTile href='/dashboard' label='All servers' icon='all' onClick={onClose} />
                    {botInviteUrl ? (
                        <DashboardActionTile href={botInviteUrl} label='Invite bot' icon='invite' onClick={onClose} />
                    ) : null}
                </ul>
                {selectableGuilds.length === 0 && query.trim().length > 0 ? (
                    <p className='mt-3 rounded-[var(--dash-radius-control)] border border-dashed border-[var(--dash-border)] px-3 py-4 text-center text-sm text-[var(--dash-text-muted)]'>
                        No other matching servers
                    </p>
                ) : null}
            </div>
        </motion.section>
    );

    if (variant === 'mobile-header') {
        return createPortal(
            <motion.div
                className='fixed inset-0 z-[70] bg-[rgba(2,5,10,0.66)] p-2 backdrop-blur-sm'
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.18 }}>
                <button type='button' tabIndex={-1} aria-hidden='true' onClick={onClose} className='absolute inset-0' />
                {dock}
            </motion.div>,
            portalHost ?? document.body
        );
    }

    return createPortal(dock, portalHost ?? document.body);
}

function DashboardCurrentGuildTile({ guild, layoutId }: { guild: DashboardGuildShellGuild; layoutId: string }) {
    return (
        <motion.li layout className='min-w-0' transition={dockSpring}>
            <span
                aria-current='page'
                aria-label={`${guild.name}, current server`}
                title={guild.name}
                className={`${getDockTileClassName('current')} cursor-default`}>
                <motion.span
                    layoutId={layoutId}
                    className='absolute inset-0 rounded-[var(--dash-radius-control)] bg-[linear-gradient(145deg,rgba(90,215,255,0.2),rgba(157,140,255,0.14)_58%,rgba(255,113,138,0.1))] shadow-[inset_0_1px_0_rgba(255,255,255,0.08),0_0_22px_rgba(90,215,255,0.1)]'
                    transition={dockSpring}
                />
                <DashboardDockAvatar guild={guild} active />
                <span className='relative line-clamp-2 block min-h-8 w-full text-center text-xs leading-4 font-semibold'>
                    {guild.name}
                </span>
                <span className='relative inline-flex items-center gap-1 text-[0.65rem] font-semibold text-[var(--dash-primary)]'>
                    <Check className='size-3' aria-hidden='true' /> Current
                </span>
            </span>
        </motion.li>
    );
}

function DashboardGuildLinkTile({
    guild,
    sourceGuild,
    href,
    pending,
    navigationDisabled,
    onNavigate,
}: {
    guild: DashboardGuildShellGuild;
    sourceGuild: DashboardGuildShellGuild;
    href: string;
    pending: boolean;
    navigationDisabled: boolean;
    onNavigate: (event: ReactMouseEvent<HTMLAnchorElement>, guildId: string) => void;
}) {
    const preview = createDashboardGuildPreview({
        id: guild.id,
        name: guild.name,
        ...(guild.iconUrl ? { iconUrl: guild.iconUrl } : {}),
        mode: 'multi',
    });
    const sourcePreview = createDashboardGuildPreview({
        id: sourceGuild.id,
        name: sourceGuild.name,
        ...(sourceGuild.iconUrl ? { iconUrl: sourceGuild.iconUrl } : {}),
        mode: 'multi',
    });

    const content = (
        <>
            <DashboardDockAvatar guild={guild} />
            <span className='relative line-clamp-2 block min-h-8 w-full text-center text-xs leading-4 font-semibold'>
                {guild.name}
            </span>
            {pending ? (
                <span className='relative text-[0.65rem] font-semibold text-[var(--dash-primary)]'>Opening…</span>
            ) : null}
        </>
    );

    return (
        <motion.li
            layout
            className='min-w-0'
            whileHover={navigationDisabled ? undefined : { y: -2 }}
            transition={dockSpring}>
            {navigationDisabled ? (
                <span
                    aria-label={`${guild.name}, opening`}
                    aria-busy='true'
                    title={guild.name}
                    className={getDockTileClassName('pending')}>
                    {content}
                </span>
            ) : (
                <Link
                    to={href}
                    preload='intent'
                    state={withDashboardGuildPreview(preview, sourcePreview)}
                    aria-label={pending ? `${guild.name}, opening` : guild.name}
                    aria-busy={pending}
                    title={guild.name}
                    onClick={(event) => onNavigate(event, guild.id)}
                    className={getDockTileClassName(pending ? 'pending' : 'default')}>
                    {content}
                </Link>
            )}
        </motion.li>
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

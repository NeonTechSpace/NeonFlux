import { Link, useLocation } from '@tanstack/react-router';
import { ChevronRight, Menu, X } from 'lucide-react';
import { motion } from 'motion/react';
import { useEffect, useRef, useState } from 'react';

import { dashboardCategories, dashboardNavigationEntries } from '../dashboard-categories.js';
import type {
    DashboardCategoryId,
    DashboardNavigationEntry,
    DashboardNavigationJobId,
    DashboardSubNavigationTo,
} from '../dashboard-categories.js';
import type { DashboardGuildShellGuild } from '../server/dashboard-guild-page.server.js';
import { DashboardCommandSearch, DashboardCommandSearchTrigger } from './dashboard-command-search.js';
import { DashboardGuildSelector } from './dashboard-guild-selector.js';
import {
    DashboardGuildAvatar,
    DashboardGuildIdentity,
    DashboardNavigationFooter,
    NavigationLoadingIndicator,
} from './dashboard-navigation-chrome.js';
import { DashboardRailNavigationList } from './dashboard-rail-navigation.js';

type DashboardCategoryNavigationProps = {
    guild: DashboardGuildShellGuild;
    guilds: DashboardGuildShellGuild[];
    guildId: string;
    activeCategoryId: DashboardCategoryId;
    mode: 'single' | 'multi';
    botInviteUrl?: string;
    pendingGuildId?: string;
    pathnameOverride?: string;
    isLoading?: boolean;
};

export function DashboardCategoryNavigation({
    guild,
    guilds,
    guildId,
    activeCategoryId,
    mode,
    botInviteUrl,
    pendingGuildId,
    pathnameOverride,
    isLoading = false,
}: DashboardCategoryNavigationProps) {
    const routePathname = useLocation({ select: (location) => location.pathname });
    const pathname = pathnameOverride ?? routePathname;
    const mobileDialogRef = useRef<HTMLDialogElement>(null);
    const mobileCloseRef = useRef<HTMLButtonElement>(null);
    const mobileTriggerRef = useRef<HTMLButtonElement>(null);
    const [mobileOpen, setMobileOpen] = useState(false);
    const [openOverrides, setOpenOverrides] = useState<Partial<Record<DashboardNavigationJobId, boolean>>>({});
    const activeNavigationEntry = dashboardNavigationEntries.find((entry) =>
        isNavigationEntryActive(entry, activeCategoryId, guildId, pathname)
    );
    const activeLabel =
        activeNavigationEntry?.category.label ??
        dashboardCategories.find((category) => category.id === activeCategoryId)?.label ??
        'Dashboard';
    const canSwitchServers = mode === 'multi';

    useEffect(() => {
        if (!mobileOpen) {
            return;
        }

        const dialog = mobileDialogRef.current;

        if (dialog && !dialog.open) {
            if (typeof dialog.showModal === 'function') {
                dialog.showModal();
            } else {
                dialog.setAttribute('open', '');
            }
        }
        queueMicrotask(() => mobileCloseRef.current?.focus());

        const desktopMedia = window.matchMedia('(min-width: 768px)');

        function handleDesktopBreakpoint(event: MediaQueryListEvent): void {
            if (!event.matches) {
                return;
            }

            const openDialog = mobileDialogRef.current;
            if (openDialog?.open) {
                if (typeof openDialog.close === 'function') {
                    openDialog.close();
                } else {
                    openDialog.removeAttribute('open');
                }
            }
            setMobileOpen(false);
            queueMicrotask(() => mobileTriggerRef.current?.focus());
        }

        desktopMedia.addEventListener('change', handleDesktopBreakpoint);

        return () => desktopMedia.removeEventListener('change', handleDesktopBreakpoint);
    }, [mobileOpen]);

    function closeMobileNavigation(): void {
        const dialog = mobileDialogRef.current;

        if (dialog?.open) {
            if (typeof dialog.close === 'function') {
                dialog.close();
            } else {
                dialog.removeAttribute('open');
            }
        }

        setMobileOpen(false);
        queueMicrotask(() => mobileTriggerRef.current?.focus());
    }

    function toggleCategory(jobId: DashboardNavigationJobId): void {
        const active = activeNavigationEntry?.category.id === jobId;
        const open = openOverrides[jobId] ?? active;

        setOpenOverrides((currentOverrides) => ({
            ...currentOverrides,
            [jobId]: !open,
        }));
    }

    const serverControl = canSwitchServers ? (
        <DashboardGuildSelector
            guilds={guilds}
            activeGuildId={guildId}
            pathname={pathname}
            botInviteUrl={botInviteUrl}
            pendingGuildId={pendingGuildId}
        />
    ) : (
        <DashboardGuildIdentity guild={guild} />
    );

    return (
        <DashboardCommandSearch guildId={guildId} guilds={guilds} pathname={pathname}>
            <header className='relative z-40 flex min-h-14 items-center gap-2 rounded-[var(--dash-radius-panel)] border border-[var(--dash-border)] bg-[rgba(8,13,21,0.92)] p-2 shadow-[var(--dash-shadow-surface)] backdrop-blur md:hidden'>
                {canSwitchServers ? (
                    <div className='min-w-0 flex-1'>
                        <DashboardGuildSelector
                            guilds={guilds}
                            activeGuildId={guildId}
                            pathname={pathname}
                            botInviteUrl={botInviteUrl}
                            pendingGuildId={pendingGuildId}
                            variant='mobile-header'
                            activeLabel={activeLabel}
                        />
                    </div>
                ) : (
                    <>
                        <DashboardGuildAvatar guild={guild} className='size-9' />
                        <div className='min-w-0 flex-1'>
                            <p className='truncate text-sm font-semibold text-[var(--dash-text)]'>{guild.name}</p>
                            <p className='truncate text-xs text-[var(--dash-text-muted)]'>{activeLabel}</p>
                        </div>
                    </>
                )}
                {isLoading ? <NavigationLoadingIndicator compact /> : null}
                <DashboardCommandSearchTrigger compact />
                <button
                    ref={mobileTriggerRef}
                    type='button'
                    aria-label={mobileOpen ? 'Close dashboard menu' : 'Open dashboard menu'}
                    aria-expanded={mobileOpen}
                    aria-controls='dashboard-mobile-navigation'
                    onClick={() => (mobileOpen ? closeMobileNavigation() : setMobileOpen(true))}
                    className='grid size-11 shrink-0 place-items-center rounded-[var(--dash-radius-control)] border border-[var(--dash-border)] text-[var(--dash-text-muted)] transition outline-none hover:border-[var(--dash-border-interactive)] hover:bg-[var(--dash-surface-raised)] hover:text-[var(--dash-text)] focus-visible:border-[var(--dash-primary)] focus-visible:shadow-[var(--dash-shadow-focus)]'>
                    {mobileOpen ? (
                        <X className='size-5' aria-hidden='true' />
                    ) : (
                        <Menu className='size-5' aria-hidden='true' />
                    )}
                </button>
            </header>

            <dialog
                ref={mobileDialogRef}
                id='dashboard-mobile-navigation'
                aria-label='Dashboard menu'
                onCancel={(event) => {
                    event.preventDefault();
                    closeMobileNavigation();
                }}
                onClose={() => setMobileOpen(false)}
                className='fixed inset-0 z-50 m-0 h-dvh max-h-none w-screen max-w-none overflow-hidden bg-transparent p-0 text-[var(--dash-text)] backdrop:bg-[rgba(2,5,10,0.76)] backdrop:backdrop-blur-sm md:hidden'>
                <button
                    type='button'
                    tabIndex={-1}
                    aria-hidden='true'
                    onClick={closeMobileNavigation}
                    className='absolute inset-0'
                />
                <motion.aside
                    initial={{ x: '-100%' }}
                    animate={{ x: 0 }}
                    transition={{ duration: 0.2, ease: 'easeOut' }}
                    className='absolute inset-y-0 left-0 flex w-[min(23rem,calc(100vw-2rem))] min-w-0 flex-col border-r border-[var(--dash-border)] bg-[rgba(7,11,18,0.98)] p-3 shadow-[var(--dash-shadow-popover)]'>
                    <div className='flex items-center gap-3 border-b border-[var(--dash-border)] pb-3'>
                        <div className='min-w-0 flex-1'>
                            <p className='text-xs font-semibold tracking-[0.12em] text-[var(--dash-primary)] uppercase'>
                                NeonFlux
                            </p>
                            <p className='mt-0.5 truncate text-base font-semibold text-[var(--dash-text)]'>
                                {guild.name}
                            </p>
                        </div>
                        <button
                            ref={mobileCloseRef}
                            type='button'
                            aria-label='Close dashboard menu'
                            onClick={closeMobileNavigation}
                            className='grid size-11 place-items-center rounded-[var(--dash-radius-control)] text-[var(--dash-text-muted)] transition outline-none hover:bg-[var(--dash-surface-raised)] hover:text-[var(--dash-text)] focus-visible:shadow-[var(--dash-shadow-focus)]'>
                            <X className='size-5' aria-hidden='true' />
                        </button>
                    </div>
                    <nav className='min-h-0 flex-1 overflow-y-auto py-3' aria-label='Dashboard categories'>
                        <DashboardExpandedNavigationList
                            activeCategoryId={activeCategoryId}
                            guildId={guildId}
                            openOverrides={openOverrides}
                            pathname={pathname}
                            variant='mobile'
                            onNavigate={closeMobileNavigation}
                            onToggleCategory={toggleCategory}
                        />
                    </nav>
                    <DashboardNavigationFooter compact={false} />
                </motion.aside>
            </dialog>

            <aside className='dashboard-navigation-sidebar relative z-30 hidden h-full min-h-0 w-[4.5rem] shrink-0 flex-col rounded-[var(--dash-radius-panel)] border border-[var(--dash-border)] bg-[rgba(7,11,18,0.9)] p-2 shadow-[var(--dash-shadow-surface)] backdrop-blur md:flex lg:w-64 lg:p-3'>
                <div className='shrink-0 border-b border-[var(--dash-border)] pb-3'>{serverControl}</div>
                <div className='dashboard-navigation-tools shrink-0 pt-3'>
                    <DashboardCommandSearchTrigger />
                </div>
                <nav
                    className='dashboard-navigation-scroll min-h-0 flex-1 overflow-y-auto py-3'
                    aria-label='Dashboard categories'>
                    <div className='lg:hidden'>
                        <DashboardRailNavigationList
                            activeCategoryId={activeCategoryId}
                            guildId={guildId}
                            pathname={pathname}
                        />
                    </div>
                    <div className='hidden lg:block'>
                        <DashboardExpandedNavigationList
                            activeCategoryId={activeCategoryId}
                            guildId={guildId}
                            openOverrides={openOverrides}
                            pathname={pathname}
                            variant='desktop'
                            onToggleCategory={toggleCategory}
                        />
                    </div>
                </nav>
                {isLoading ? <NavigationLoadingIndicator /> : null}
                <DashboardNavigationFooter compact />
            </aside>
        </DashboardCommandSearch>
    );
}

function DashboardExpandedNavigationList({
    activeCategoryId,
    guildId,
    openOverrides,
    pathname,
    variant,
    onNavigate,
    onToggleCategory,
}: {
    activeCategoryId: DashboardCategoryId;
    guildId: string;
    openOverrides: Partial<Record<DashboardNavigationJobId, boolean>>;
    pathname: string;
    variant: 'desktop' | 'mobile';
    onNavigate?: () => void;
    onToggleCategory: (jobId: DashboardNavigationJobId) => void;
}) {
    return (
        <ul className='space-y-1'>
            {dashboardNavigationEntries.map((entry) => {
                const { category, subNavigation } = entry;
                const Icon = category.icon;
                const active = isNavigationEntryActive(entry, activeCategoryId, guildId, pathname);
                const grouped = entry.type === 'group';
                const open = openOverrides[category.id] ?? active;

                return (
                    <li key={category.id}>
                        <div className='flex items-center gap-1'>
                            <Link
                                to={entry.linkTo}
                                params={{ guildId }}
                                activeOptions={{ exact: subNavigation.length === 0 }}
                                aria-current={active ? 'page' : undefined}
                                onClick={onNavigate}
                                className={`${getCategoryLinkClassName(active)} min-w-0 flex-1`}>
                                {active ? (
                                    <motion.span
                                        layoutId={`dashboard-category-active-${variant}`}
                                        className='absolute inset-0 rounded-[var(--dash-radius-control)] bg-[var(--dash-surface-selected)]'
                                        transition={{ duration: 0.16, ease: 'easeOut' }}
                                    />
                                ) : null}
                                <Icon
                                    className={
                                        active
                                            ? 'relative size-[1.1rem] shrink-0 text-[var(--dash-primary)]'
                                            : 'relative size-[1.1rem] shrink-0 text-[var(--dash-text-muted)]'
                                    }
                                    aria-hidden='true'
                                />
                                <span className='relative min-w-0 flex-1 truncate'>{category.label}</span>
                            </Link>
                            {grouped ? (
                                <button
                                    type='button'
                                    data-dashboard-disclosure
                                    aria-label={open ? `Collapse ${category.label}` : `Expand ${category.label}`}
                                    aria-expanded={open}
                                    onClick={() => onToggleCategory(category.id)}
                                    className={getCategoryDisclosureButtonClassName(active || open)}>
                                    <ChevronRight
                                        className={`size-4 transition ${open ? 'rotate-90' : ''}`}
                                        aria-hidden='true'
                                    />
                                </button>
                            ) : null}
                        </div>
                        {grouped ? (
                            <motion.ul
                                initial={false}
                                animate={open ? { height: 'auto', opacity: 1 } : { height: 0, opacity: 0 }}
                                transition={{ duration: 0.18, ease: 'easeOut' }}
                                aria-hidden={!open}
                                className={
                                    open
                                        ? 'relative mt-1 ml-5 overflow-hidden border-l border-[var(--dash-border-strong)] pl-3'
                                        : 'pointer-events-none relative mt-1 ml-5 overflow-hidden border-l border-[var(--dash-border-strong)] pl-3'
                                }>
                                {subNavigation.map((item) => (
                                    <DashboardSubNavigationListItem
                                        key={item.id}
                                        item={item}
                                        guildId={guildId}
                                        pathname={pathname}
                                        open={open}
                                        onNavigate={onNavigate}
                                    />
                                ))}
                            </motion.ul>
                        ) : null}
                    </li>
                );
            })}
        </ul>
    );
}

function DashboardSubNavigationListItem({
    item,
    guildId,
    pathname,
    open,
    onNavigate,
}: {
    item: (typeof dashboardNavigationEntries)[number]['subNavigation'][number];
    guildId: string;
    pathname: string;
    open: boolean;
    onNavigate?: () => void;
}) {
    const ItemIcon = item.icon;
    const targetPath = getDashboardSubNavigationPath(item.to, guildId);
    const active = pathname === targetPath || pathname.startsWith(`${targetPath}/`);

    return (
        <li>
            <Link
                to={item.to}
                params={{ guildId }}
                activeOptions={{ exact: true }}
                aria-current={active ? 'page' : undefined}
                tabIndex={open ? undefined : -1}
                onClick={onNavigate}
                className={getSubNavigationLinkClassName(active)}>
                <ItemIcon
                    className={
                        active
                            ? 'relative size-4 shrink-0 text-[var(--dash-primary)]'
                            : 'relative size-4 shrink-0 text-[var(--dash-text-muted)]'
                    }
                    aria-hidden='true'
                />
                <span className='relative min-w-0 truncate'>{item.label}</span>
            </Link>
        </li>
    );
}

function getCategoryDisclosureButtonClassName(active: boolean): string {
    const base =
        'grid size-11 shrink-0 place-items-center rounded-[var(--dash-radius-control)] border text-[var(--dash-text-muted)] outline-none transition';

    return active
        ? `${base} border-[var(--dash-border-interactive)] bg-[var(--dash-primary-soft)] text-[var(--dash-primary)] focus-visible:shadow-[var(--dash-shadow-focus)]`
        : `${base} border-transparent hover:border-[var(--dash-border)] hover:bg-[var(--dash-surface-raised)] hover:text-[var(--dash-text)] focus-visible:border-[var(--dash-primary)] focus-visible:shadow-[var(--dash-shadow-focus)]`;
}

function getCategoryLinkClassName(active: boolean): string {
    const base =
        'relative flex min-h-11 items-center gap-3 overflow-hidden rounded-[var(--dash-radius-control)] border px-3 text-[0.93rem] font-semibold outline-none transition';

    return active
        ? `${base} border-[var(--dash-border-interactive)] text-[var(--dash-text)]`
        : `${base} border-transparent text-[var(--dash-text-muted)] hover:border-[var(--dash-border)] hover:bg-[var(--dash-surface-raised)] hover:text-[var(--dash-text)] focus-visible:border-[var(--dash-primary)] focus-visible:shadow-[var(--dash-shadow-focus)]`;
}

function getSubNavigationLinkClassName(active: boolean): string {
    const base =
        'relative flex min-h-11 items-center gap-2 overflow-hidden rounded-[var(--dash-radius-control)] border px-3 text-[0.88rem] font-semibold outline-none transition';

    return active
        ? `${base} border-[var(--dash-border-interactive)] bg-[var(--dash-primary-soft)] text-[var(--dash-text)]`
        : `${base} border-transparent text-[var(--dash-text-muted)] hover:border-[var(--dash-border)] hover:bg-[var(--dash-surface-raised)] hover:text-[var(--dash-text)] focus-visible:border-[var(--dash-primary)] focus-visible:shadow-[var(--dash-shadow-focus)]`;
}

function getDashboardSubNavigationPath(to: DashboardSubNavigationTo, guildId: string): string {
    return to.replace('$guildId', guildId);
}

function isNavigationEntryActive(
    entry: DashboardNavigationEntry,
    activeCategoryId: DashboardCategoryId,
    guildId: string,
    pathname: string
): boolean {
    if (entry.subNavigation.length === 0) {
        return entry.category.routeCategoryIds.some((categoryId) => categoryId === activeCategoryId);
    }

    return entry.subNavigation.some((item) => {
        const targetPath = getDashboardSubNavigationPath(item.to, guildId);

        return pathname === targetPath || pathname.startsWith(`${targetPath}/`);
    });
}

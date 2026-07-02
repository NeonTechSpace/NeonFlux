import { Link, useLocation } from '@tanstack/react-router';
import {
    BarChart3,
    BellDot,
    Bot,
    ChevronRight,
    GitBranch,
    History,
    Menu,
    MessageSquareText,
    Settings2,
    ShieldCheck,
    TicketCheck,
    UsersRound,
    X,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useState } from 'react';

import { dashboardCategories } from '../dashboard-categories.js';
import type { DashboardCategoryId } from '../dashboard-categories.js';
import { dashboardAccessTools } from './dashboard-access-workbench.js';
import { dashboardCommunityTools } from './dashboard-community-workbench.js';

type DashboardSubNavigationTo =
    | (typeof dashboardAccessTools)[number]['to']
    | (typeof dashboardCommunityTools)[number]['to'];

type DashboardSubNavigationItem = {
    id: string;
    label: string;
    to: DashboardSubNavigationTo;
    icon: LucideIcon;
};

const dashboardCategoryIcons = {
    overview: BarChart3,
    general: Settings2,
    messaging: MessageSquareText,
    invites: TicketCheck,
    access: ShieldCheck,
    moderation: Bot,
    logging: BellDot,
    community: UsersRound,
    structure: GitBranch,
    audit: History,
} satisfies Record<DashboardCategoryId, LucideIcon>;

export function DashboardCategoryNavigation({
    guildId,
    activeCategoryId,
}: {
    guildId: string;
    activeCategoryId: DashboardCategoryId;
}) {
    const pathname = useLocation({ select: (location) => location.pathname });
    const [mobileOpen, setMobileOpen] = useState(false);
    const [openOverrides, setOpenOverrides] = useState<Partial<Record<DashboardCategoryId, boolean>>>({});

    function toggleCategory(categoryId: DashboardCategoryId): void {
        const active = activeCategoryId === categoryId;
        const open = openOverrides[categoryId] ?? active;

        setOpenOverrides((currentOverrides) => ({
            ...currentOverrides,
            [categoryId]: !open,
        }));
    }

    return (
        <nav
            className='min-h-0 min-w-0 shrink-0 xl:h-full xl:border-r xl:border-[var(--dash-border)] xl:pr-4'
            aria-label='Dashboard categories'>
            <div className='xl:hidden'>
                <button
                    type='button'
                    aria-expanded={mobileOpen}
                    onClick={() => setMobileOpen((current) => !current)}
                    className='dashboard-glass-panel flex min-h-12 w-full items-center gap-3 px-3 text-left text-[0.98rem] font-semibold text-[var(--dash-text)] transition hover:border-[var(--dash-border-interactive)] focus-visible:border-[var(--dash-primary)] focus-visible:shadow-[var(--dash-shadow-focus)] focus-visible:outline-none'>
                    {mobileOpen ? (
                        <X className='size-4 text-[var(--dash-primary)]' aria-hidden='true' />
                    ) : (
                        <Menu className='size-4 text-[var(--dash-primary)]' aria-hidden='true' />
                    )}
                    <span className='min-w-0 flex-1 truncate'>
                        {dashboardCategories.find((category) => category.id === activeCategoryId)?.label ?? 'Dashboard'}
                    </span>
                    <ChevronRight
                        className={
                            mobileOpen
                                ? 'size-4 rotate-90 text-[var(--dash-text-muted)] transition'
                                : 'size-4 text-[var(--dash-text-muted)] transition'
                        }
                        aria-hidden='true'
                    />
                </button>
                <AnimatePresence initial={false}>
                    {mobileOpen ? (
                        <motion.div
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: 'auto', opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            transition={{ duration: 0.18, ease: 'easeOut' }}
                            className='overflow-hidden'>
                            <div className='dashboard-glass-panel mt-2 max-h-[min(30rem,calc(100dvh-14rem))] overflow-y-auto p-2'>
                                <DashboardCategoryNavigationList
                                    activeCategoryId={activeCategoryId}
                                    guildId={guildId}
                                    openOverrides={openOverrides}
                                    pathname={pathname}
                                    variant='mobile'
                                    onNavigate={() => setMobileOpen(false)}
                                    onToggleCategory={toggleCategory}
                                />
                            </div>
                        </motion.div>
                    ) : null}
                </AnimatePresence>
            </div>
            <div className='hidden h-full min-h-0 flex-col xl:flex'>
                <div className='px-2 pt-1 pb-3'>
                    <p className='text-xs font-semibold tracking-wide text-[var(--dash-primary)] uppercase'>
                        Dashboard
                    </p>
                </div>
                <div className='min-h-0 overflow-y-auto pr-2'>
                    <DashboardCategoryNavigationList
                        activeCategoryId={activeCategoryId}
                        guildId={guildId}
                        openOverrides={openOverrides}
                        pathname={pathname}
                        variant='desktop'
                        onToggleCategory={toggleCategory}
                    />
                </div>
            </div>
        </nav>
    );
}

function DashboardCategoryNavigationList({
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
    openOverrides: Partial<Record<DashboardCategoryId, boolean>>;
    pathname: string;
    variant: 'desktop' | 'mobile';
    onNavigate?: () => void;
    onToggleCategory: (categoryId: DashboardCategoryId) => void;
}) {
    return (
        <ul className={variant === 'desktop' ? 'space-y-1' : 'space-y-1'}>
            {dashboardCategories.map((category) => {
                const Icon = dashboardCategoryIcons[category.id];
                const active = activeCategoryId === category.id;
                const subNavigation = getDashboardCategorySubNavigation(category.id);
                const hasSubNavigation = subNavigation.length > 0;
                const open = openOverrides[category.id] ?? active;

                return (
                    <li key={category.id}>
                        {hasSubNavigation ? (
                            <button
                                type='button'
                                aria-label={open ? `Collapse ${category.label}` : `Expand ${category.label}`}
                                aria-expanded={open}
                                onClick={() => onToggleCategory(category.id)}
                                className={getCategoryButtonClassName(active || open)}>
                                {active ? (
                                    <motion.span
                                        layoutId={`dashboard-category-disclosure-active-${variant}`}
                                        className='absolute left-0 h-5 w-px rounded-full bg-[var(--dash-primary)] shadow-[0_0_18px_rgba(56,189,248,0.55)]'
                                        transition={{ duration: 0.18, ease: 'easeOut' }}
                                    />
                                ) : null}
                                <Icon
                                    className={
                                        active
                                            ? 'size-4 shrink-0 text-[var(--dash-primary)]'
                                            : 'size-4 shrink-0 text-[var(--dash-text-muted)] group-hover:text-[var(--dash-text)]'
                                    }
                                    aria-hidden='true'
                                />
                                <span className='min-w-0 flex-1 truncate'>{category.label}</span>
                                <motion.span
                                    animate={{ rotate: open ? 90 : 0 }}
                                    transition={{ duration: 0.16, ease: 'easeOut' }}
                                    className='grid size-6 shrink-0 place-items-center text-[var(--dash-text-muted)] group-hover:text-[var(--dash-text)]'>
                                    <ChevronRight className='size-4' aria-hidden='true' />
                                </motion.span>
                            </button>
                        ) : (
                            <Link
                                to={category.to}
                                params={{ guildId }}
                                activeOptions={{ exact: true }}
                                aria-current={active ? 'page' : undefined}
                                onClick={onNavigate}
                                className={getCategoryLinkClassName(active)}>
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
                                            ? 'relative size-4 shrink-0 text-[var(--dash-primary)]'
                                            : 'relative size-4 shrink-0 text-[var(--dash-text-muted)]'
                                    }
                                    aria-hidden='true'
                                />
                                <span className='relative min-w-0 flex-1 truncate'>{category.label}</span>
                                {isPlannedDashboardCategory(category) ? (
                                    <span
                                        className='relative rounded-full border border-[var(--dash-border)] px-2 py-0.5 text-[0.65rem] font-semibold text-[var(--dash-text-subtle)]'
                                        aria-hidden='true'>
                                        Soon
                                    </span>
                                ) : null}
                            </Link>
                        )}
                        {hasSubNavigation ? (
                            <motion.ul
                                initial={false}
                                animate={open ? { height: 'auto', opacity: 1 } : { height: 0, opacity: 0 }}
                                transition={{ duration: 0.18, ease: 'easeOut' }}
                                aria-hidden={!open}
                                className={
                                    open
                                        ? 'relative mt-1 ml-5 overflow-hidden border-l border-[var(--dash-border-strong)] pl-4'
                                        : 'pointer-events-none relative mt-1 ml-5 overflow-hidden border-l border-[var(--dash-border-strong)] pl-4'
                                }>
                                {subNavigation.map((item) => {
                                    const ItemIcon = item.icon;
                                    const targetPath = getDashboardSubNavigationPath(item.to, guildId);
                                    const subActive = pathname === targetPath || pathname.startsWith(`${targetPath}/`);

                                    return (
                                        <li key={item.id}>
                                            <Link
                                                to={item.to}
                                                params={{ guildId }}
                                                activeOptions={{ exact: true }}
                                                aria-current={subActive ? 'page' : undefined}
                                                tabIndex={open ? undefined : -1}
                                                onClick={onNavigate}
                                                className={getSubNavigationLinkClassName(subActive)}>
                                                {subActive ? (
                                                    <motion.span
                                                        layoutId={`dashboard-sub-navigation-active-${variant}`}
                                                        className='absolute inset-0 rounded-[var(--dash-radius-control)] bg-[linear-gradient(90deg,rgba(56,189,248,0.18),rgba(236,72,153,0.08))]'
                                                        transition={{ duration: 0.16, ease: 'easeOut' }}
                                                    />
                                                ) : null}
                                                <ItemIcon
                                                    className={
                                                        subActive
                                                            ? 'relative size-4 shrink-0 text-[var(--dash-primary)]'
                                                            : 'relative size-4 shrink-0 text-[var(--dash-text-muted)]'
                                                    }
                                                    aria-hidden='true'
                                                />
                                                <span className='relative min-w-0 truncate'>{item.label}</span>
                                            </Link>
                                        </li>
                                    );
                                })}
                            </motion.ul>
                        ) : null}
                    </li>
                );
            })}
        </ul>
    );
}

function getCategoryButtonClassName(active: boolean): string {
    const base =
        'group relative flex min-h-11 w-full items-center gap-3 rounded-[var(--dash-radius-control)] border px-3 py-2 text-left text-[0.98rem] font-semibold transition outline-none';

    return active
        ? `${base} border-[rgba(56,189,248,0.38)] bg-[rgba(16,32,51,0.72)] text-[var(--dash-text)] shadow-[var(--dash-shadow-focus)] hover:bg-[rgba(19,38,61,0.78)] focus-visible:border-[var(--dash-primary)] focus-visible:bg-[var(--dash-surface-raised)] focus-visible:shadow-[var(--dash-shadow-focus)]`
        : `${base} border-transparent text-[var(--dash-text-muted)] hover:border-[rgba(107,125,152,0.52)] hover:bg-[rgba(19,24,35,0.68)] hover:text-[var(--dash-text)] focus-visible:border-[var(--dash-primary)] focus-visible:bg-[var(--dash-surface-raised)] focus-visible:text-[var(--dash-text)] focus-visible:shadow-[var(--dash-shadow-focus)]`;
}

function getCategoryLinkClassName(active: boolean): string {
    const base =
        'relative flex min-h-11 items-center gap-3 overflow-hidden rounded-[var(--dash-radius-control)] border px-3 text-[0.98rem] font-semibold outline-none transition';

    return active
        ? `${base} border-[rgba(56,189,248,0.42)] text-[var(--dash-text)] shadow-[var(--dash-shadow-focus)]`
        : `${base} border-transparent text-[var(--dash-text-muted)] hover:border-[rgba(107,125,152,0.52)] hover:bg-[rgba(19,24,35,0.68)] hover:text-[var(--dash-text)] focus-visible:border-[var(--dash-primary)] focus-visible:bg-[var(--dash-surface-raised)] focus-visible:text-[var(--dash-text)] focus-visible:shadow-[var(--dash-shadow-focus)]`;
}

function getSubNavigationLinkClassName(active: boolean): string {
    const base =
        'relative flex min-h-10 items-center gap-2 overflow-hidden rounded-[var(--dash-radius-control)] border px-3 text-[0.93rem] font-semibold outline-none transition';

    return active
        ? `${base} border-[rgba(56,189,248,0.28)] text-[var(--dash-text)]`
        : `${base} border-transparent text-[var(--dash-text-muted)] hover:border-[rgba(107,125,152,0.42)] hover:bg-[rgba(19,24,35,0.64)] hover:text-[var(--dash-text)] focus-visible:border-[var(--dash-primary)] focus-visible:bg-[var(--dash-surface-raised)] focus-visible:text-[var(--dash-text)] focus-visible:shadow-[var(--dash-shadow-focus)]`;
}

function isPlannedDashboardCategory(category: { status: 'active' | 'planned' }): boolean {
    return category.status === 'planned';
}

function getDashboardCategorySubNavigation(categoryId: DashboardCategoryId): readonly DashboardSubNavigationItem[] {
    if (categoryId === 'access') {
        return dashboardAccessTools.map((tool) => ({
            id: tool.id,
            label: tool.label,
            to: tool.to,
            icon: tool.icon,
        }));
    }

    if (categoryId === 'community') {
        return dashboardCommunityTools.map((tool) => ({
            id: tool.id,
            label: tool.label,
            to: tool.to,
            icon: tool.icon,
        }));
    }

    return [];
}

function getDashboardSubNavigationPath(to: DashboardSubNavigationTo, guildId: string): string {
    return to.replace('$guildId', guildId);
}

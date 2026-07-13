import { Link } from '@tanstack/react-router';
import { Grid2X2, Plus, Server } from 'lucide-react';
import { motion } from 'motion/react';

import type { DashboardGuildShellGuild } from '../server/dashboard-guild-page.server.js';

export const dashboardServerDockSpring = {
    type: 'spring',
    stiffness: 430,
    damping: 34,
    mass: 0.78,
} as const;

export function DashboardServerDockActionTile({
    href,
    label,
    icon,
    onClick,
}: {
    href: string;
    label: string;
    icon: 'all' | 'invite';
    onClick: () => void;
}) {
    const Icon = icon === 'all' ? Grid2X2 : Plus;
    const content = (
        <>
            <span className='grid size-8 shrink-0 place-items-center rounded-[var(--dash-radius-control)] bg-[var(--dash-primary-soft)] text-[var(--dash-primary)]'>
                <Icon className='size-4' aria-hidden='true' />
            </span>
            <span className='min-w-0 flex-1 truncate text-sm font-semibold'>{label}</span>
        </>
    );

    return (
        <motion.li layout className='min-w-0' transition={dashboardServerDockSpring}>
            {icon === 'all' ? (
                <Link
                    to={href}
                    aria-label={label}
                    onClick={onClick}
                    className={getDashboardServerDockTileClassName('action')}>
                    {content}
                </Link>
            ) : (
                <a
                    href={href}
                    aria-label={label}
                    onClick={onClick}
                    className={getDashboardServerDockTileClassName('action')}>
                    {content}
                </a>
            )}
        </motion.li>
    );
}

export function DashboardServerDockAvatar({
    guild,
    active = false,
}: {
    guild: DashboardGuildShellGuild;
    active?: boolean;
}) {
    return (
        <span
            className={
                active
                    ? 'relative grid size-9 shrink-0 place-items-center overflow-hidden rounded-full border border-[var(--dash-primary)] bg-[var(--dash-surface-raised)] shadow-[0_0_16px_rgba(90,215,255,0.2)]'
                    : 'relative grid size-9 shrink-0 place-items-center overflow-hidden rounded-full border border-[var(--dash-border)] bg-[var(--dash-surface-raised)]'
            }
            aria-hidden='true'>
            <DashboardGuildSelectorAvatar guild={guild} />
        </span>
    );
}

export function DashboardGuildSelectorAvatar({ guild }: { guild: DashboardGuildShellGuild }) {
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

export function getDashboardServerTriggerClassName(variant: 'sidebar' | 'mobile-header'): string {
    const base =
        'group/server-trigger flex w-full min-w-0 items-center gap-3 rounded-[var(--dash-radius-control)] text-left text-[var(--dash-text)] transition outline-none focus-visible:border-[var(--dash-primary)] focus-visible:shadow-[var(--dash-shadow-focus)]';

    return variant === 'mobile-header'
        ? `${base} h-[3.25rem] border border-transparent px-1 hover:bg-[var(--dash-surface-raised)]`
        : `${base} h-12 justify-center border border-transparent px-1.5 hover:bg-white/[0.045] lg:justify-start lg:px-2`;
}

export function getDashboardServerDockClassName(variant: 'sidebar' | 'mobile-header'): string {
    const surface =
        'flex flex-col overflow-hidden rounded-[var(--dash-radius-panel)] border border-[var(--dash-border-interactive)] bg-[rgba(7,12,20,0.96)] text-[var(--dash-text)] shadow-[var(--dash-shadow-popover)] backdrop-blur-2xl';

    return variant === 'mobile-header'
        ? `${surface} absolute inset-x-2 bottom-2 max-h-[min(42rem,calc(100dvh-1rem))]`
        : `${surface} fixed z-50 w-[min(24rem,calc(100vw-6.5rem))] origin-left`;
}

export function getDashboardServerDockTileClassName(tone: 'action' | 'current' | 'default' | 'pending'): string {
    const base =
        'relative flex min-h-14 w-full min-w-0 items-center gap-3 overflow-hidden rounded-[var(--dash-radius-control)] border px-3 py-2 text-left text-[var(--dash-text)] outline-none transition-[border-color,background-color,color,box-shadow,transform] duration-[160ms] focus-visible:border-[var(--dash-primary)] focus-visible:shadow-[var(--dash-shadow-focus)]';

    switch (tone) {
        case 'current':
            return `${base} border-[var(--dash-border-interactive)] bg-[var(--dash-primary-soft)]`;
        case 'pending':
            return `${base} border-[var(--dash-primary)] bg-[var(--dash-primary-soft)] shadow-[0_0_18px_rgba(90,215,255,0.14)] active:scale-[0.98]`;
        case 'action':
            return `${base} min-h-12 border-transparent text-[var(--dash-text-muted)] hover:border-[var(--dash-border)] hover:bg-[var(--dash-surface-raised)] hover:text-[var(--dash-text)] active:scale-[0.99]`;
        case 'default':
            return `${base} border-transparent text-[var(--dash-text-muted)] hover:border-[var(--dash-border)] hover:bg-[var(--dash-surface-raised)] hover:text-[var(--dash-text)] active:scale-[0.99]`;
    }
}

export function getDashboardServerDockSortButtonClassName(active: boolean): string {
    const base =
        'grid size-11 shrink-0 place-items-center rounded-[var(--dash-radius-control)] border outline-none transition focus-visible:border-[var(--dash-primary)] focus-visible:shadow-[var(--dash-shadow-focus)]';

    return active
        ? `${base} border-[var(--dash-border-interactive)] bg-[var(--dash-primary-soft)] text-[var(--dash-primary)]`
        : `${base} border-[var(--dash-border)] text-[var(--dash-text-muted)] hover:bg-[var(--dash-surface-raised)] hover:text-[var(--dash-text)]`;
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

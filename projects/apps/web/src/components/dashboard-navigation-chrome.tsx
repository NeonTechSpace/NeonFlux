import { SlidersHorizontal, UserRound } from 'lucide-react';

import type { DashboardGuildShellGuild } from '../server/dashboard-guild-page.server.js';
import { DashboardDisplayControls } from './dashboard-display-controls.js';

export function DashboardNavigationFooter({ compact }: { compact: boolean }) {
    return (
        <div className='shrink-0 space-y-2 border-t border-[var(--dash-border)] pt-3'>
            {compact ? (
                <>
                    <div className='group/appearance relative flex justify-center xl:hidden'>
                        <button
                            type='button'
                            aria-label='Appearance controls'
                            className='grid size-10 place-items-center rounded-[var(--dash-radius-control)] border border-transparent text-[var(--dash-text-muted)] transition outline-none hover:border-[var(--dash-border)] hover:bg-[var(--dash-surface-raised)] hover:text-[var(--dash-text)] focus-visible:border-[var(--dash-primary)] focus-visible:shadow-[var(--dash-shadow-focus)]'>
                            <SlidersHorizontal className='size-4' aria-hidden='true' />
                        </button>
                        <div className='invisible absolute bottom-0 left-[calc(100%+0.75rem)] z-50 translate-x-[-0.25rem] opacity-0 transition group-focus-within/appearance:visible group-focus-within/appearance:translate-x-0 group-focus-within/appearance:opacity-100 group-hover/appearance:visible group-hover/appearance:translate-x-0 group-hover/appearance:opacity-100'>
                            <DashboardDisplayControls variant='inline' />
                        </div>
                    </div>
                    <div className='hidden xl:block'>
                        <DashboardDisplayControls variant='inline' />
                    </div>
                </>
            ) : (
                <DashboardDisplayControls variant='inline' />
            )}
            <a
                href='/auth/fluxer/login'
                className='flex min-h-10 items-center justify-center gap-2 rounded-[var(--dash-radius-control)] border border-transparent px-2 text-sm font-semibold text-[var(--dash-text-muted)] transition outline-none hover:border-[var(--dash-border)] hover:bg-[var(--dash-surface-raised)] hover:text-[var(--dash-text)] focus-visible:border-[var(--dash-primary)] focus-visible:shadow-[var(--dash-shadow-focus)] xl:justify-start'>
                <UserRound className='size-4 shrink-0' aria-hidden='true' />
                <span className={compact ? 'hidden xl:inline' : ''}>Switch account</span>
            </a>
        </div>
    );
}

export function DashboardGuildIdentity({ guild }: { guild: DashboardGuildShellGuild }) {
    return (
        <div className='flex min-h-12 items-center justify-center gap-3 rounded-[var(--dash-radius-control)] px-1 xl:justify-start xl:px-2'>
            <DashboardGuildAvatar guild={guild} className='size-9' />
            <div className='hidden min-w-0 flex-1 xl:block'>
                <p className='text-[0.68rem] font-semibold tracking-[0.12em] text-[var(--dash-text-subtle)] uppercase'>
                    Server
                </p>
                <p className='truncate text-sm font-semibold text-[var(--dash-text)]'>{guild.name}</p>
            </div>
        </div>
    );
}

export function DashboardGuildAvatar({ guild, className }: { guild: DashboardGuildShellGuild; className: string }) {
    if (guild.iconUrl) {
        return (
            <img
                src={guild.iconUrl}
                alt=''
                className={`${className} shrink-0 rounded-full border border-[var(--dash-border)] bg-[var(--dash-surface-raised)] object-cover`}
                loading='lazy'
                referrerPolicy='no-referrer'
            />
        );
    }

    return (
        <span
            className={`${className} grid shrink-0 place-items-center rounded-full border border-[var(--dash-border)] bg-[var(--dash-surface-raised)] text-xs font-bold text-[var(--dash-text)]`}
            aria-hidden='true'>
            {getGuildFallbackLabel(guild.name)}
        </span>
    );
}

export function NavigationLoadingIndicator({ compact = false }: { compact?: boolean }) {
    return (
        <span
            role='status'
            className={
                compact
                    ? 'size-2 shrink-0 animate-pulse rounded-full bg-[var(--dash-primary)]'
                    : 'mb-2 hidden min-h-8 items-center justify-center rounded-[var(--dash-radius-control)] border border-[var(--dash-border)] px-2 text-xs font-semibold text-[var(--dash-text-muted)] xl:flex'
            }>
            {compact ? <span className='sr-only'>Loading server settings</span> : 'Loading settings'}
        </span>
    );
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

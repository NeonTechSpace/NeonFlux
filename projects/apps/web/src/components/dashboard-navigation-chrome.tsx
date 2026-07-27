import { LogOut, SlidersHorizontal } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import type { DashboardGuildShellGuild } from '../server/dashboard-guild-page.server.js';
import { DashboardDisplayControls } from './dashboard-display-controls.js';

export function DashboardNavigationFooter({ compact }: { compact: boolean }) {
    return (
        <div className='dashboard-navigation-footer shrink-0 space-y-1 border-t border-white/[0.06] pt-2'>
            {compact ? (
                <>
                    <DashboardCompactAppearanceControls />
                    <div className='hidden justify-center lg:flex'>
                        <DashboardDisplayControls variant='navigation' />
                    </div>
                </>
            ) : (
                <div className='flex justify-center'>
                    <DashboardDisplayControls variant='inline' />
                </div>
            )}
            <form method='post' action='/auth/logout' aria-label='Sign out'>
                <button
                    type='submit'
                    aria-label='Sign out'
                    className='flex min-h-10 w-full items-center justify-center gap-2 rounded-xl px-2 text-sm font-medium text-[var(--dash-text-muted)] transition outline-none hover:bg-white/[0.04] hover:text-[var(--dash-text)] focus-visible:shadow-[var(--dash-shadow-focus)]'>
                    <LogOut className='size-4 shrink-0' aria-hidden='true' />
                    <span className={compact ? 'hidden lg:inline' : ''}>Sign out</span>
                </button>
            </form>
        </div>
    );
}

function DashboardCompactAppearanceControls() {
    const [open, setOpen] = useState(false);
    const [position, setPosition] = useState<{ left: number; top: number }>();
    const [portalHost, setPortalHost] = useState<HTMLElement>();
    const triggerRef = useRef<HTMLButtonElement>(null);
    const popoverRef = useRef<HTMLDivElement>(null);
    const popoverId = `dashboard-appearance-${useId().replaceAll(':', '')}`;

    useEffect(() => {
        if (!open) return;

        function close({ restoreFocus = true }: { restoreFocus?: boolean } = {}): void {
            setOpen(false);
            setPosition(undefined);
            setPortalHost(undefined);
            if (restoreFocus) queueMicrotask(() => triggerRef.current?.focus());
        }

        function handlePointerDown(event: PointerEvent): void {
            if (
                event.target instanceof Node &&
                !triggerRef.current?.contains(event.target) &&
                !popoverRef.current?.contains(event.target)
            ) {
                close({ restoreFocus: false });
            }
        }

        function handleKeyDown(event: KeyboardEvent): void {
            if (event.key === 'Escape') {
                event.preventDefault();
                close();
                return;
            }

            if (event.key !== 'Tab') return;

            const buttons = popoverRef.current?.querySelectorAll<HTMLButtonElement>('button:not([disabled])');
            if (!buttons || buttons.length === 0) return;

            const first = buttons.item(0);
            const last = buttons.item(buttons.length - 1);

            if (event.shiftKey && document.activeElement === first) {
                event.preventDefault();
                last.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault();
                first.focus();
            }
        }

        function handleViewportChange(): void {
            close({ restoreFocus: false });
        }

        window.addEventListener('pointerdown', handlePointerDown);
        window.addEventListener('keydown', handleKeyDown);
        window.addEventListener('resize', handleViewportChange);
        window.addEventListener('scroll', handleViewportChange, true);
        queueMicrotask(() => popoverRef.current?.querySelector<HTMLButtonElement>('button')?.focus());

        return () => {
            window.removeEventListener('pointerdown', handlePointerDown);
            window.removeEventListener('keydown', handleKeyDown);
            window.removeEventListener('resize', handleViewportChange);
            window.removeEventListener('scroll', handleViewportChange, true);
        };
    }, [open]);

    function openControls(): void {
        const bounds = triggerRef.current?.getBoundingClientRect();

        if (bounds) {
            setPosition({
                left: bounds.right + 12,
                top: Math.max(8, Math.min(bounds.bottom - 52, window.innerHeight - 60)),
            });
        }

        setPortalHost(triggerRef.current?.closest<HTMLElement>('.dashboard-theme') ?? document.body);

        setOpen(true);
    }

    return (
        <div className='flex justify-center lg:hidden'>
            <button
                ref={triggerRef}
                type='button'
                aria-label='Appearance controls'
                aria-expanded={open}
                aria-controls={popoverId}
                onClick={() => {
                    if (open) {
                        setOpen(false);
                        setPosition(undefined);
                        setPortalHost(undefined);
                    } else {
                        openControls();
                    }
                }}
                className='grid size-10 place-items-center rounded-xl text-[var(--dash-text-muted)] transition outline-none hover:bg-white/[0.045] hover:text-[var(--dash-text)] focus-visible:shadow-[var(--dash-shadow-focus)]'>
                <SlidersHorizontal className='size-4' aria-hidden='true' />
            </button>
            {open && portalHost
                ? createPortal(
                      <div
                          ref={popoverRef}
                          id={popoverId}
                          role='dialog'
                          aria-label='Appearance controls'
                          className='fixed z-[80]'
                          style={position}>
                          <DashboardDisplayControls variant='inline' />
                      </div>,
                      portalHost
                  )
                : null}
        </div>
    );
}

export function DashboardGuildIdentity({ guild }: { guild: DashboardGuildShellGuild }) {
    return (
        <div className='flex min-h-12 items-center justify-center gap-3 rounded-xl px-1 lg:justify-start lg:px-2'>
            <DashboardGuildAvatar guild={guild} className='size-9' />
            <div className='hidden min-w-0 flex-1 lg:block'>
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
            data-dashboard-loading={compact ? 'pulse' : undefined}
            className={
                compact
                    ? 'size-2 shrink-0 animate-pulse rounded-full bg-[var(--dash-primary)]'
                    : 'mb-2 hidden min-h-8 items-center justify-center rounded-[var(--dash-radius-control)] border border-[var(--dash-border)] px-2 text-xs font-semibold text-[var(--dash-text-muted)] lg:flex'
            }>
            {compact ? <span className='sr-only'>Loading page</span> : 'Loading page'}
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

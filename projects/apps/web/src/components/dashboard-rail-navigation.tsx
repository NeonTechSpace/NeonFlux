import { Link } from '@tanstack/react-router';
import { X } from 'lucide-react';
import { motion } from 'motion/react';
import { useEffect, useId, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent } from 'react';
import { createPortal } from 'react-dom';

import { dashboardNavigationEntries } from '../dashboard-categories.js';
import type { DashboardCategoryId, DashboardNavigationEntry } from '../dashboard-categories.js';

type OpenRailGroup = {
    entry: Extract<DashboardNavigationEntry, { type: 'group' }>;
    left: number;
    portalHost: HTMLElement;
    top: number;
};

export function DashboardRailNavigationList({
    activeCategoryId,
    guildId,
    pathname,
}: {
    activeCategoryId: DashboardCategoryId;
    guildId: string;
    pathname: string;
}) {
    const triggerRef = useRef<HTMLButtonElement>(null);
    const panelRef = useRef<HTMLElement>(null);
    const [openGroup, setOpenGroup] = useState<OpenRailGroup>();
    const disclosureId = `dashboard-rail-disclosure-${useId().replaceAll(':', '')}`;

    function closeDisclosure({ restoreFocus = false }: { restoreFocus?: boolean } = {}): void {
        setOpenGroup(undefined);

        if (restoreFocus) {
            queueMicrotask(() => triggerRef.current?.isConnected && triggerRef.current.focus());
        }
    }

    useEffect(() => {
        if (!openGroup) {
            return;
        }

        function handlePointerDown(event: PointerEvent): void {
            if (
                event.target instanceof Node &&
                !panelRef.current?.contains(event.target) &&
                !triggerRef.current?.contains(event.target)
            ) {
                closeDisclosure();
            }
        }

        function handleEscape(event: KeyboardEvent): void {
            if (event.key === 'Escape') {
                event.preventDefault();
                closeDisclosure({ restoreFocus: true });
            }
        }

        function handleViewportChange(): void {
            closeDisclosure();
        }

        function handleScroll(event: Event): void {
            if (event.target instanceof Node && panelRef.current?.contains(event.target)) {
                return;
            }

            closeDisclosure();
        }

        window.addEventListener('pointerdown', handlePointerDown);
        window.addEventListener('keydown', handleEscape);
        window.addEventListener('resize', handleViewportChange);
        window.addEventListener('scroll', handleScroll, true);
        queueMicrotask(() => panelRef.current?.querySelector<HTMLAnchorElement>('a[href]')?.focus());

        return () => {
            window.removeEventListener('pointerdown', handlePointerDown);
            window.removeEventListener('keydown', handleEscape);
            window.removeEventListener('resize', handleViewportChange);
            window.removeEventListener('scroll', handleScroll, true);
        };
    }, [openGroup]);

    function toggleDisclosure(
        event: ReactMouseEvent<HTMLButtonElement>,
        entry: Extract<DashboardNavigationEntry, { type: 'group' }>
    ): void {
        if (openGroup?.entry.category.id === entry.category.id) {
            closeDisclosure({ restoreFocus: true });
            return;
        }

        const rect = event.currentTarget.getBoundingClientRect();
        const top = Math.max(12, Math.min(rect.top, window.innerHeight - 256));
        triggerRef.current = event.currentTarget;
        setOpenGroup({
            entry,
            left: rect.right + 12,
            portalHost: event.currentTarget.closest<HTMLElement>('.dashboard-theme') ?? document.body,
            top,
        });
    }

    function handlePanelKeyDown(event: ReactKeyboardEvent<HTMLElement>): void {
        if (event.key !== 'Tab') {
            return;
        }

        const focusable = panelRef.current?.querySelectorAll<HTMLElement>('a[href], button:not([disabled])');

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

    return (
        <>
            <ul className='space-y-0.5'>
                {dashboardNavigationEntries.map((entry) => {
                    const Icon = entry.category.icon;
                    const active = isNavigationEntryActive(entry, activeCategoryId, guildId, pathname);
                    const disclosureOpen = openGroup?.entry.category.id === entry.category.id;

                    return (
                        <li key={entry.category.id}>
                            {entry.type === 'group' ? (
                                <button
                                    type='button'
                                    aria-label={`Open ${entry.category.label} destinations`}
                                    aria-haspopup='dialog'
                                    aria-expanded={disclosureOpen}
                                    aria-controls={disclosureOpen ? disclosureId : undefined}
                                    title={entry.category.label}
                                    onClick={(event) => toggleDisclosure(event, entry)}
                                    className={getRailControlClassName(active || disclosureOpen)}>
                                    {active ? <ActiveRailIndicator /> : null}
                                    <Icon
                                        className={getRailIconClassName(active || disclosureOpen)}
                                        aria-hidden='true'
                                    />
                                </button>
                            ) : (
                                <Link
                                    to={entry.linkTo}
                                    params={{ guildId }}
                                    aria-label={entry.category.label}
                                    title={entry.category.label}
                                    aria-current={active ? 'page' : undefined}
                                    className={getRailControlClassName(active)}>
                                    {active ? <ActiveRailIndicator /> : null}
                                    <Icon className={getRailIconClassName(active)} aria-hidden='true' />
                                </Link>
                            )}
                        </li>
                    );
                })}
            </ul>

            {openGroup
                ? createPortal(
                      <motion.section
                          ref={panelRef}
                          id={disclosureId}
                          role='dialog'
                          aria-modal='false'
                          aria-labelledby={`${disclosureId}-title`}
                          initial={{ opacity: 0, x: -8, scale: 0.98 }}
                          animate={{ opacity: 1, x: 0, scale: 1 }}
                          transition={{ duration: 0.16, ease: 'easeOut' }}
                          onKeyDown={handlePanelKeyDown}
                          style={{
                              left: openGroup.left,
                              top: openGroup.top,
                              maxHeight: `calc(100dvh - ${openGroup.top + 12}px)`,
                          }}
                          className='fixed z-[65] flex w-64 min-w-0 flex-col overflow-hidden rounded-2xl bg-[rgba(7,12,20,0.96)] text-[var(--dash-text)] shadow-[var(--dash-shadow-popover)] ring-1 ring-white/[0.07] backdrop-blur-2xl'>
                          <header className='flex min-h-14 shrink-0 items-center gap-2 border-b border-white/[0.06] px-3'>
                              <h2
                                  id={`${disclosureId}-title`}
                                  className='min-w-0 flex-1 truncate text-sm font-semibold'>
                                  {openGroup.entry.category.label}
                              </h2>
                              <button
                                  type='button'
                                  aria-label={`Close ${openGroup.entry.category.label} destinations`}
                                  onClick={() => closeDisclosure({ restoreFocus: true })}
                                  className='grid size-11 shrink-0 place-items-center rounded-[var(--dash-radius-control)] text-[var(--dash-text-muted)] transition outline-none hover:bg-[var(--dash-surface-raised)] hover:text-[var(--dash-text)] focus-visible:shadow-[var(--dash-shadow-focus)]'>
                                  <X className='size-4' aria-hidden='true' />
                              </button>
                          </header>
                          <ul className='min-h-0 space-y-1 overflow-y-auto p-2'>
                              {openGroup.entry.subNavigation.map((item) => {
                                  const ItemIcon = item.icon;
                                  const active = isSubNavigationActive(item.to, guildId, pathname);

                                  return (
                                      <li key={item.id}>
                                          <Link
                                              to={item.to}
                                              params={{ guildId }}
                                              activeOptions={{ exact: true }}
                                              aria-current={active ? 'page' : undefined}
                                              onClick={() => closeDisclosure()}
                                              className={getSubNavigationLinkClassName(active)}>
                                              <ItemIcon
                                                  className={getSubNavigationIconClassName(active)}
                                                  aria-hidden='true'
                                              />
                                              <span className='relative min-w-0 truncate'>{item.label}</span>
                                          </Link>
                                      </li>
                                  );
                              })}
                          </ul>
                      </motion.section>,
                      openGroup.portalHost
                  )
                : null}
        </>
    );
}

function ActiveRailIndicator() {
    return (
        <motion.span
            layoutId='dashboard-category-active-rail'
            className='absolute inset-0 rounded-xl bg-[radial-gradient(circle_at_20%_50%,rgba(90,215,255,0.16),rgba(90,215,255,0.045)_70%,transparent)]'
            transition={{ duration: 0.16, ease: 'easeOut' }}>
            <span className='absolute inset-y-2 left-0 w-0.5 rounded-full bg-[var(--dash-primary)] shadow-[0_0_10px_rgba(90,215,255,0.6)]' />
        </motion.span>
    );
}

function getRailControlClassName(active: boolean): string {
    const base = 'relative grid size-11 place-items-center overflow-hidden rounded-xl outline-none transition';

    return active
        ? `${base} text-[var(--dash-text)] focus-visible:shadow-[var(--dash-shadow-focus)]`
        : `${base} text-[var(--dash-text-muted)] hover:bg-white/[0.045] hover:text-[var(--dash-text)] focus-visible:shadow-[var(--dash-shadow-focus)]`;
}

function getRailIconClassName(active: boolean): string {
    return active ? 'relative size-5 text-[var(--dash-primary)]' : 'relative size-5 text-[var(--dash-text-muted)]';
}

function getSubNavigationLinkClassName(active: boolean): string {
    const base =
        'relative flex min-h-10 items-center gap-2 rounded-lg px-3 text-[0.86rem] font-medium outline-none transition-colors';

    return active
        ? `${base} bg-white/[0.035] text-[var(--dash-text)] focus-visible:shadow-[var(--dash-shadow-focus)]`
        : `${base} text-[var(--dash-text-muted)] hover:bg-white/[0.035] hover:text-[var(--dash-text)] focus-visible:shadow-[var(--dash-shadow-focus)]`;
}

function getSubNavigationIconClassName(active: boolean): string {
    return active
        ? 'relative size-4 shrink-0 text-[var(--dash-primary)]'
        : 'relative size-4 shrink-0 text-[var(--dash-text-muted)]';
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

    return entry.subNavigation.some((item) => isSubNavigationActive(item.to, guildId, pathname));
}

function isSubNavigationActive(to: string, guildId: string, pathname: string): boolean {
    const targetPath = to.replace('$guildId', guildId);

    return pathname === targetPath || pathname.startsWith(`${targetPath}/`);
}

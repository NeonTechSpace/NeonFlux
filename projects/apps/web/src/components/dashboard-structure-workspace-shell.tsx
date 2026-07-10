import { Link, Outlet } from '@tanstack/react-router';
import { motion } from 'motion/react';
import type { ReactNode } from 'react';

const blueprintNavigation = [
    { id: 'current', label: 'Current', to: '/dashboard/$guildId/structure/current' },
    { id: 'backups', label: 'Backups', to: '/dashboard/$guildId/structure/backups' },
    { id: 'compare', label: 'Compare', to: '/dashboard/$guildId/structure/compare' },
    { id: 'deploy', label: 'Deploy', to: '/dashboard/$guildId/structure/deploy' },
    { id: 'runs', label: 'Runs', to: '/dashboard/$guildId/structure/runs' },
] as const;

export function DashboardStructureWorkspaceShell({ guildId, children }: { guildId: string; children: ReactNode }) {
    return (
        <section className='min-w-0' aria-labelledby='server-blueprint-title'>
            <header className='sticky top-0 z-10 border-b border-[var(--dash-border)] bg-[rgba(7,8,11,0.94)] px-1 backdrop-blur-md'>
                <div className='flex min-h-14 items-center justify-between gap-5'>
                    <h2
                        id='server-blueprint-title'
                        className='text-xl font-semibold tracking-tight text-[var(--dash-text)]'>
                        Server Blueprint
                    </h2>
                    <p className='hidden text-sm text-[var(--dash-text-muted)] 2xl:block'>
                        Capture versions, understand differences, and apply reviewed changes.
                    </p>
                </div>
                <nav className='flex min-w-0 gap-6 overflow-x-auto' aria-label='Server Blueprint tools'>
                    {blueprintNavigation.map((item) => (
                        <Link
                            key={item.id}
                            to={item.to}
                            params={{ guildId }}
                            className='relative shrink-0 py-3 text-sm font-medium text-[var(--dash-text-muted)] transition-colors hover:text-[var(--dash-text)] focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--dash-primary)]'
                            activeProps={{ className: 'text-[var(--dash-text)]' }}>
                            {({ isActive }) => (
                                <>
                                    {item.label}
                                    {isActive ? (
                                        <motion.span
                                            layoutId='server-blueprint-active-tool'
                                            className='absolute inset-x-0 bottom-0 h-0.5 bg-[var(--dash-primary)]'
                                            transition={{ duration: 0.18, ease: 'easeOut' }}
                                        />
                                    ) : null}
                                </>
                            )}
                        </Link>
                    ))}
                </nav>
            </header>
            <div className='pt-5'>{children}</div>
        </section>
    );
}

export function DashboardStructureWorkspaceOutlet() {
    return <Outlet />;
}

import { DashboardShell } from './dashboard-layout.js';

export function DashboardRouteLoading() {
    return (
        <DashboardShell>
            <section
                className='flex h-full min-h-0 min-w-0 flex-col gap-4 overflow-hidden'
                role='status'
                aria-label='Loading dashboard'>
                <span className='sr-only'>Loading dashboard</span>
                <header className='shrink-0 border-b border-[var(--dash-border)] px-1 pt-1 pb-4'>
                    <div className='flex items-center gap-4'>
                        <div className='size-12 shrink-0 animate-pulse rounded-full bg-[var(--dash-primary-soft)]' />
                        <div className='min-w-0 space-y-2'>
                            <div className='h-7 w-56 max-w-[70vw] animate-pulse rounded-[var(--dash-radius-control)] bg-[var(--dash-surface-raised)]' />
                            <div className='h-3 w-48 max-w-[60vw] animate-pulse rounded-[var(--dash-radius-control)] bg-[rgba(177,186,200,0.16)]' />
                        </div>
                    </div>
                </header>
                <div className='grid min-h-0 min-w-0 grid-cols-[minmax(0,1fr)] gap-5 overflow-hidden xl:grid-cols-[15rem_minmax(0,1fr)]'>
                    <aside className='hidden min-h-0 border-r border-[var(--dash-border)] pr-4 xl:block'>
                        <div className='mb-4 h-4 w-24 animate-pulse rounded bg-[var(--dash-primary-soft)]' />
                        <div className='space-y-2'>
                            {Array.from({ length: 7 }, (_, index) => (
                                <div
                                    key={index}
                                    className='h-11 animate-pulse rounded-[var(--dash-radius-control)] bg-[rgba(56,189,248,0.08)]'
                                />
                            ))}
                        </div>
                    </aside>
                    <div className='min-h-0 min-w-0 overflow-hidden'>
                        <div className='border-b border-[var(--dash-border)] px-1 pb-3'>
                            <div className='h-7 w-40 animate-pulse rounded-[var(--dash-radius-control)] bg-[var(--dash-surface-raised)]' />
                            <div className='mt-2 h-4 w-80 max-w-full animate-pulse rounded-[var(--dash-radius-control)] bg-[rgba(177,186,200,0.16)]' />
                        </div>
                        <div className='mt-4 grid gap-4 lg:grid-cols-2'>
                            <div className='dashboard-glass-panel h-40 animate-pulse' />
                            <div className='dashboard-glass-panel h-40 animate-pulse' />
                        </div>
                    </div>
                </div>
            </section>
        </DashboardShell>
    );
}

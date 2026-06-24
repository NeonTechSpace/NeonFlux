import { DashboardShell } from './dashboard-layout.js';

export function DashboardRouteLoading() {
    return (
        <DashboardShell>
            <section className='space-y-8' role='status' aria-label='Loading dashboard'>
                <span className='sr-only'>Loading dashboard</span>
                <header className='space-y-3 border-b border-neutral-800 pb-6'>
                    <div className='h-4 w-28 animate-pulse rounded bg-sky-500/20' />
                    <div className='h-10 w-72 max-w-full animate-pulse rounded bg-neutral-900' />
                    <div className='h-4 w-full max-w-md animate-pulse rounded bg-neutral-900' />
                </header>
                <div className='space-y-4'>
                    <div className='h-7 w-36 animate-pulse rounded bg-neutral-900' />
                    <div className='grid gap-3 sm:grid-cols-2'>
                        <div className='h-28 animate-pulse rounded-lg border border-neutral-800 bg-neutral-900' />
                        <div className='h-28 animate-pulse rounded-lg border border-neutral-800 bg-neutral-900' />
                    </div>
                </div>
            </section>
        </DashboardShell>
    );
}

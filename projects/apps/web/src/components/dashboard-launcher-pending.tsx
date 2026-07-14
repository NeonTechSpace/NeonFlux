import { DashboardShell } from './dashboard-layout.js';
import { DashboardRouteRetryButton } from './dashboard-route-retry-button.js';

export function DashboardLauncherPending() {
    return (
        <DashboardShell>
            <header className='shrink-0 border-b border-[var(--dash-border)] pb-4'>
                <h1 className='text-3xl font-semibold tracking-tight text-[var(--dash-text)]'>Choose server</h1>
                <p className='mt-1 text-sm leading-6 text-[var(--dash-text-muted)]'>
                    Open a server you can manage with this Fluxer account.
                </p>
            </header>
            <section className='py-5' aria-label='Server launcher'>
                <div
                    role='status'
                    aria-label='Loading available servers'
                    className='flex min-h-12 items-center gap-3 text-sm text-[var(--dash-text-muted)]'>
                    <span
                        data-dashboard-loading='pulse'
                        className='size-2 shrink-0 animate-pulse rounded-full bg-[var(--dash-primary)]'
                        aria-hidden='true'
                    />
                    Loading available servers…
                </div>
            </section>
        </DashboardShell>
    );
}

export function DashboardLauncherError({ onRetry }: { onRetry: () => Promise<unknown> | void }) {
    return (
        <DashboardShell>
            <header className='shrink-0 border-b border-[var(--dash-border)] pb-4'>
                <h1 className='text-3xl font-semibold tracking-tight text-[var(--dash-text)]'>Choose server</h1>
                <p className='mt-1 text-sm leading-6 text-[var(--dash-text-muted)]'>
                    Open a server you can manage with this Fluxer account.
                </p>
            </header>
            <section className='py-5' aria-label='Server launcher'>
                <div role='alert' className='max-w-2xl space-y-4'>
                    <div>
                        <h2 className='text-lg font-semibold text-[var(--dash-text)]'>Servers could not load</h2>
                        <p className='mt-1 text-sm leading-6 text-[var(--dash-text-muted)]'>
                            NeonFlux could not confirm which servers this account can manage. No server was opened.
                        </p>
                    </div>
                    <DashboardRouteRetryButton label='Retry servers' onRetry={onRetry} />
                </div>
            </section>
        </DashboardShell>
    );
}

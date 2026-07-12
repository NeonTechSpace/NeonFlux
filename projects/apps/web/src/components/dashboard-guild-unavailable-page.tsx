import { Link } from '@tanstack/react-router';

import type { DashboardGuildRouteData } from '../server/dashboard-guild-route-data.js';
import { DashboardShell, DashboardStatusSection } from './dashboard-layout.js';
import { DashboardRouteRetryButton } from './dashboard-route-retry-button.js';
import { dashboardSecondaryActionClassName } from './dashboard-ui.js';

export function DashboardGuildUnavailablePage({
    data,
}: {
    data: Extract<DashboardGuildRouteData, { type: 'unavailable' }>;
}) {
    if (data.status === 404) {
        return (
            <DashboardShell>
                <DashboardStatusSection
                    eyebrow='Dashboard'
                    title={data.title}
                    body={data.message}
                    actionLabel='Choose server'
                    actionTo='/dashboard'
                />
            </DashboardShell>
        );
    }

    return (
        <DashboardShell>
            <section className='max-w-2xl space-y-5'>
                <div className='space-y-2'>
                    <p className='text-sm font-medium tracking-wide text-[var(--dash-primary)] uppercase'>Dashboard</p>
                    <h1 className='text-3xl font-semibold text-[var(--dash-text)]'>{data.title}</h1>
                    <p className='text-sm leading-6 text-[var(--dash-text-muted)]'>{data.message}</p>
                </div>
                <div className='flex flex-wrap items-center gap-3'>
                    <DashboardRouteRetryButton label='Retry dashboard' />
                    <Link to='/dashboard' className={`${dashboardSecondaryActionClassName} inline-flex items-center`}>
                        Choose server
                    </Link>
                </div>
            </section>
        </DashboardShell>
    );
}

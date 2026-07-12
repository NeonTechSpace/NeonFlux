import { Link } from '@tanstack/react-router';
import { MotionConfig } from 'motion/react';
import type { ReactNode } from 'react';

import { DashboardAmbientSurface } from './dashboard-ambient-surface.js';
import { useDashboardDisplayPreferences } from './dashboard-display-preferences-store.js';
import { dashboardPrimaryActionClassName } from './dashboard-ui.js';

export function DashboardShell({ children }: { children: ReactNode }) {
    const reducedEffectsEnabled = useDashboardDisplayPreferences((state) => state.reducedEffectsEnabled);

    return (
        <MotionConfig reducedMotion={reducedEffectsEnabled ? 'always' : 'user'} skipAnimations={reducedEffectsEnabled}>
            <main
                className='dashboard-theme relative isolate h-dvh overflow-hidden bg-[var(--dash-bg)] px-3 py-4 text-[var(--dash-text)] sm:px-5 lg:px-6'
                data-reduce-effects={reducedEffectsEnabled}>
                <DashboardAmbientSurface />
                <div className='relative z-10 mx-auto flex h-full w-full max-w-[1800px] min-w-0 flex-col gap-5 overflow-hidden'>
                    {children}
                </div>
            </main>
        </MotionConfig>
    );
}

export function DashboardStatusSection({
    eyebrow,
    title,
    body,
    actionLabel,
    actionTo,
}: {
    eyebrow: string;
    title: string;
    body: string;
    actionLabel: string;
    actionTo: string;
}) {
    return (
        <section className='max-w-2xl space-y-5'>
            <div className='space-y-2'>
                <p className='text-sm font-medium tracking-wide text-[var(--dash-primary)] uppercase'>{eyebrow}</p>
                <h1 className='text-3xl font-semibold text-[var(--dash-text)]'>{title}</h1>
                <p className='text-sm leading-6 text-[var(--dash-text-muted)]'>{body}</p>
            </div>
            <DashboardStatusAction actionTo={actionTo}>{actionLabel}</DashboardStatusAction>
        </section>
    );
}

function DashboardStatusAction({ actionTo, children }: { actionTo: string; children: ReactNode }) {
    const className = `${dashboardPrimaryActionClassName} inline-flex items-center`;

    switch (actionTo) {
        case '/dashboard':
            return (
                <Link to='/dashboard' className={className}>
                    {children}
                </Link>
            );

        default:
            return (
                <a href={actionTo} className={className}>
                    {children}
                </a>
            );
    }
}

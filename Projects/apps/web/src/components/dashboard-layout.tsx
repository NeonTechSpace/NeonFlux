import { Link } from '@tanstack/react-router';
import type { ReactNode } from 'react';

import { DashboardAmbientSurface } from './dashboard-ambient-surface.js';

export function DashboardShell({ children }: { children: ReactNode }) {
    return (
        <main className='dashboard-theme h-dvh overflow-hidden px-3 py-4 text-neutral-100 sm:px-5 lg:px-6'>
            <DashboardAmbientSurface />
            <div className='relative z-10 mx-auto flex h-full w-full max-w-[1540px] min-w-0 flex-col gap-5 overflow-hidden'>
                {children}
            </div>
        </main>
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
                <p className='text-sm font-medium tracking-wide text-sky-300 uppercase'>{eyebrow}</p>
                <h1 className='text-3xl font-semibold text-white'>{title}</h1>
                <p className='text-sm leading-6 text-neutral-300'>{body}</p>
            </div>
            <DashboardStatusAction actionTo={actionTo}>{actionLabel}</DashboardStatusAction>
        </section>
    );
}

function DashboardStatusAction({ actionTo, children }: { actionTo: string; children: ReactNode }) {
    const className =
        'inline-flex min-h-10 items-center rounded-md bg-sky-500 px-4 text-sm font-semibold text-white transition hover:bg-sky-400 focus:ring-2 focus:ring-sky-300 focus:ring-offset-2 focus:ring-offset-neutral-950 focus:outline-none';

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

import { Link } from '@tanstack/react-router';
import type { ReactNode } from 'react';

export function DashboardShell({ children }: { children: ReactNode }) {
    return (
        <main className='min-h-screen bg-neutral-950 px-5 py-8 text-neutral-100 sm:px-8'>
            <div className='mx-auto flex w-full max-w-5xl flex-col gap-8'>{children}</div>
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

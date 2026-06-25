import { Link } from '@tanstack/react-router';

import { createDashboardGuildPreview, withDashboardGuildPreview } from '../dashboard-guild-preview.js';
import type { DashboardViewModel, DashboardViewModelGuild } from '../server/dashboard-view-model.server.js';
import type { DashboardRouteData } from '../server/dashboard-route-data.js';
import { DashboardShell, DashboardStatusSection } from './dashboard-layout.js';

const fluxerLoginPath = '/auth/fluxer/login';

export function DashboardPageContent({ data }: { data: DashboardRouteData }) {
    switch (data.type) {
        case 'dashboard':
            return <DashboardView viewModel={data.viewModel} />;

        case 'unavailable':
            return (
                <DashboardShell>
                    <DashboardStatusSection
                        eyebrow='Dashboard'
                        title='Dashboard unavailable'
                        body={data.message}
                        actionLabel='Try again'
                        actionTo='/dashboard'
                    />
                </DashboardShell>
            );
    }
}

function DashboardView({ viewModel }: { viewModel: DashboardViewModel }) {
    switch (viewModel.type) {
        case 'guild-list':
            return (
                <DashboardShell>
                    <header className='space-y-2 border-b border-neutral-800 pb-6'>
                        <p className='text-sm font-medium tracking-wide text-sky-300 uppercase'>
                            {viewModel.mode === 'single' ? 'Single instance' : 'Multi instance'}
                        </p>
                        <h1 className='text-3xl font-semibold text-white'>NeonFlux Dashboard</h1>
                        <p className='max-w-2xl text-sm leading-6 text-neutral-300'>Manage connected servers.</p>
                    </header>

                    <section className='space-y-4' aria-labelledby='dashboard-servers-heading'>
                        <div className='flex items-end justify-between gap-4'>
                            <div>
                                <h2 id='dashboard-servers-heading' className='text-xl font-semibold text-white'>
                                    Servers
                                </h2>
                                <p className='mt-1 text-sm text-neutral-400'>
                                    {viewModel.mode === 'single'
                                        ? 'The configured server for this bot.'
                                        : 'Servers where you can manage this bot.'}
                                </p>
                            </div>
                            <span className='text-sm text-neutral-400'>{viewModel.guilds.length}</span>
                        </div>

                        <ul className='grid gap-3 sm:grid-cols-2'>
                            {viewModel.guilds.map((guild) => (
                                <DashboardGuildItem key={guild.id} guild={guild} mode={viewModel.mode} />
                            ))}
                        </ul>
                    </section>
                </DashboardShell>
            );

        case 'single-unauthorized':
            return (
                <DashboardShell>
                    <DashboardStatusSection
                        eyebrow='Single instance'
                        title='Not authorized'
                        body={`You are not authorized to modify ${viewModel.configuredGuildName}.`}
                        actionLabel='Use another account'
                        actionTo={fluxerLoginPath}
                    />
                </DashboardShell>
            );

        case 'multi-empty':
            return (
                <DashboardShell>
                    <DashboardStatusSection
                        eyebrow='Multi instance'
                        title='No manageable servers'
                        body='No servers are available for this account.'
                        actionLabel='Use another account'
                        actionTo={fluxerLoginPath}
                    />
                </DashboardShell>
            );
    }
}

function DashboardGuildItem({ guild, mode }: { guild: DashboardViewModelGuild; mode: 'single' | 'multi' }) {
    const preview = createDashboardGuildPreview({
        id: guild.id,
        name: guild.name,
        iconUrl: guild.iconUrl,
        mode,
    });

    return (
        <li>
            <Link
                to='/dashboard/$guildId'
                params={{ guildId: guild.id }}
                preload='intent'
                state={withDashboardGuildPreview(preview)}
                className='block rounded-lg border border-neutral-800 bg-neutral-900 p-4 transition hover:border-sky-500 focus:ring-2 focus:ring-sky-300 focus:ring-offset-2 focus:ring-offset-neutral-950 focus:outline-none'>
                <div className='flex items-center justify-between gap-4'>
                    <div className='flex min-w-0 items-center gap-3'>
                        <DashboardGuildIcon guild={guild} />
                        <h3 className='truncate text-lg font-semibold text-white'>{guild.name}</h3>
                    </div>
                    <span className='text-sm font-medium text-sky-300'>Open</span>
                </div>
            </Link>
        </li>
    );
}

function DashboardGuildIcon({ guild }: { guild: DashboardViewModelGuild }) {
    const fallbackLabel = getGuildFallbackLabel(guild.name);

    if (guild.iconUrl) {
        return (
            <img
                src={guild.iconUrl}
                alt={`${guild.name} icon`}
                className='size-10 shrink-0 rounded-lg bg-neutral-800 object-cover'
                loading='lazy'
                referrerPolicy='no-referrer'
            />
        );
    }

    return (
        <span
            className='grid size-10 shrink-0 place-items-center rounded-lg bg-neutral-800 text-sm font-semibold text-neutral-200'
            aria-hidden='true'>
            {fallbackLabel}
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

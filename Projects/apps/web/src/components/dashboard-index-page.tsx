import { Link } from '@tanstack/react-router';
import { ExternalLink, Plus, Server } from 'lucide-react';

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
                    <header className='shrink-0 space-y-2 border-b border-[var(--dash-border)] pb-6'>
                        <h1 className='text-3xl font-semibold text-[var(--dash-text)] [text-shadow:0_2px_18px_rgba(0,0,0,0.72)]'>
                            Choose server
                        </h1>
                        <p className='max-w-2xl text-[0.98rem] leading-6 text-[var(--dash-text-muted)]'>
                            Open a server you can manage.
                        </p>
                    </header>

                    <section
                        className='min-h-0 space-y-4 overflow-y-auto pb-8'
                        aria-labelledby='dashboard-servers-heading'>
                        <div className='flex items-end justify-between gap-4'>
                            <div>
                                <h2
                                    id='dashboard-servers-heading'
                                    className='text-xl font-semibold text-[var(--dash-text)]'>
                                    Manageable servers
                                </h2>
                                <p className='mt-1 text-sm text-[var(--dash-text-muted)]'>
                                    {viewModel.mode === 'single'
                                        ? 'The configured server for this bot.'
                                        : 'Servers where you can manage this bot.'}
                                </p>
                            </div>
                            {viewModel.botInviteUrl ? (
                                <a
                                    href={viewModel.botInviteUrl}
                                    className='dashboard-secondary-button inline-flex min-h-10 items-center gap-2 px-3'>
                                    <Plus className='size-4' aria-hidden='true' />
                                    Invite bot
                                </a>
                            ) : null}
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
                        eyebrow='Server access'
                        title='Not authorized'
                        body={`You are not authorized to modify ${viewModel.configuredGuildName}.`}
                        actionLabel='Use another account'
                        actionTo={fluxerLoginPath}
                    />
                </DashboardShell>
            );

        case 'multi-empty':
            return <DashboardNoManageableServers botInviteUrl={viewModel.botInviteUrl} />;
    }
}

function DashboardNoManageableServers({ botInviteUrl }: { botInviteUrl?: string }) {
    return (
        <DashboardShell>
            <section className='dashboard-glass-panel mx-auto grid min-h-[24rem] max-w-3xl place-items-center p-8 text-center'>
                <div className='max-w-xl'>
                    <div className='mx-auto grid size-14 place-items-center rounded-full border border-[rgba(56,189,248,0.32)] bg-[rgba(56,189,248,0.12)] text-[var(--dash-primary)] shadow-[0_0_32px_rgba(56,189,248,0.2)]'>
                        <Server className='size-6' aria-hidden='true' />
                    </div>
                    <h1 className='mt-5 text-3xl font-semibold tracking-tight text-[var(--dash-text)] [text-shadow:0_2px_18px_rgba(0,0,0,0.72)]'>
                        No manageable servers
                    </h1>
                    <p className='mt-3 text-[0.98rem] leading-7 text-[var(--dash-text-muted)]'>
                        Use an account with Manage Server, or invite the bot to a server you own.
                    </p>
                    <div className='mt-6 flex flex-wrap justify-center gap-3'>
                        {botInviteUrl ? (
                            <a
                                href={botInviteUrl}
                                className='dashboard-primary-button inline-flex min-h-11 items-center gap-2 px-4'>
                                <Plus className='size-4' aria-hidden='true' />
                                Invite bot
                            </a>
                        ) : null}
                        <Link
                            to={fluxerLoginPath}
                            className='dashboard-secondary-button inline-flex min-h-11 items-center gap-2 px-4'>
                            <ExternalLink className='size-4' aria-hidden='true' />
                            Use another account
                        </Link>
                    </div>
                </div>
            </section>
        </DashboardShell>
    );
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
                className='dashboard-glass-panel block p-4 transition hover:border-[var(--dash-border-interactive)] focus-visible:border-[var(--dash-primary)] focus-visible:shadow-[var(--dash-shadow-focus)] focus-visible:outline-none'>
                <div className='flex items-center justify-between gap-4'>
                    <div className='flex min-w-0 items-center gap-3'>
                        <DashboardGuildIcon guild={guild} />
                        <h3 className='truncate text-lg font-semibold text-[var(--dash-text)]'>{guild.name}</h3>
                    </div>
                    <span className='text-sm font-medium text-[var(--dash-primary)]'>Open</span>
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
                className='size-10 shrink-0 rounded-full bg-[var(--dash-surface-raised)] object-cover'
                loading='lazy'
                referrerPolicy='no-referrer'
            />
        );
    }

    return (
        <span
            className='grid size-10 shrink-0 place-items-center rounded-full bg-[var(--dash-surface-raised)] text-sm font-semibold text-[var(--dash-text)]'
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

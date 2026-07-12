import { Link } from '@tanstack/react-router';
import { ArrowUpRight, ExternalLink, Plus, Server } from 'lucide-react';

import { createDashboardGuildPreview, withDashboardGuildPreview } from '../dashboard-guild-preview.js';
import type { DashboardViewModel, DashboardViewModelGuild } from '../server/dashboard-view-model.server.js';
import type { DashboardRouteData } from '../server/dashboard-route-data.js';
import { DashboardDisplayControls } from './dashboard-display-controls.js';
import { DashboardShell, DashboardStatusSection } from './dashboard-layout.js';
import { DashboardServerDockAvatar } from './dashboard-server-dock-ui.js';

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
                    <header className='flex shrink-0 flex-wrap items-center justify-between gap-4 border-b border-[var(--dash-border)] pb-4'>
                        <div className='min-w-0'>
                            <h1 className='text-3xl font-semibold tracking-tight text-[var(--dash-text)]'>
                                Choose server
                            </h1>
                            <p className='mt-1 text-sm leading-6 text-[var(--dash-text-muted)]'>
                                Open a server you can manage with this Fluxer account.
                            </p>
                        </div>
                        <div className='flex shrink-0 items-center gap-2'>
                            {viewModel.botInviteUrl ? (
                                <a
                                    href={viewModel.botInviteUrl}
                                    className='dashboard-secondary-button inline-flex min-h-10 items-center gap-2 px-3'>
                                    <Plus className='size-4' aria-hidden='true' />
                                    Invite bot
                                </a>
                            ) : null}
                            <DashboardDisplayControls variant='inline' />
                        </div>
                    </header>

                    <section className='min-h-0 flex-1 overflow-y-auto pb-6' aria-label='Server launcher'>
                        <ul className='grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3'>
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
            <div className='flex shrink-0 justify-end'>
                <DashboardDisplayControls variant='inline' />
            </div>
            <section className='dashboard-glass-panel mx-auto grid min-h-[18rem] max-w-3xl place-items-center p-6 text-center sm:p-8'>
                <div className='max-w-xl'>
                    <div className='relative mx-auto grid size-14 place-items-center rounded-full border border-[var(--dash-border-interactive)] bg-[var(--dash-primary-soft)] text-[var(--dash-primary)] shadow-[0_0_18px_rgba(90,215,255,0.14)]'>
                        <Server className='size-6' aria-hidden='true' />
                    </div>
                    <h1 className='mt-5 text-3xl font-semibold tracking-tight text-[var(--dash-text)]'>
                        No servers available
                    </h1>
                    <p className='mt-3 text-[0.98rem] leading-7 text-[var(--dash-text-muted)]'>
                        {botInviteUrl
                            ? 'Invite NeonFlux to a server you own, or switch accounts if your servers are elsewhere.'
                            : 'Sign in with a Fluxer account that can manage at least one server.'}
                    </p>
                    <div className='relative mt-6 flex flex-wrap justify-center gap-2'>
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
                aria-label={`Open ${guild.name} dashboard`}
                className='dashboard-glass-panel group flex min-h-[6.75rem] items-center gap-3 p-3 transition hover:border-[var(--dash-border-interactive)] focus-visible:border-[var(--dash-primary)] focus-visible:shadow-[var(--dash-shadow-focus)] focus-visible:outline-none'>
                <div className='relative flex min-w-0 flex-1 items-center gap-3'>
                    <span className='rounded-full bg-[linear-gradient(135deg,var(--dash-primary),var(--dash-creative))] p-px shadow-[0_0_18px_rgba(90,215,255,0.12)] transition group-hover:shadow-[0_0_22px_rgba(90,215,255,0.24)]'>
                        <DashboardServerDockAvatar guild={guild} />
                    </span>
                    <div className='min-w-0 flex-1'>
                        <h3 className='truncate text-lg font-semibold text-[var(--dash-text)]'>{guild.name}</h3>
                    </div>
                </div>
                <span className='relative grid size-9 shrink-0 place-items-center rounded-[var(--dash-radius-control)] border border-[var(--dash-border)] bg-[var(--dash-primary-soft)] text-[var(--dash-primary)] transition group-hover:border-[var(--dash-primary)]'>
                    <ArrowUpRight className='size-4' aria-hidden='true' />
                </span>
            </Link>
        </li>
    );
}

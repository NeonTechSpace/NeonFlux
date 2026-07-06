import { Link } from '@tanstack/react-router';
import { ArrowUpRight, ExternalLink, Plus, Server } from 'lucide-react';

import { createDashboardGuildPreview, withDashboardGuildPreview } from '../dashboard-guild-preview.js';
import type { DashboardViewModel, DashboardViewModelGuild } from '../server/dashboard-view-model.server.js';
import type { DashboardRouteData } from '../server/dashboard-route-data.js';
import { DashboardDisplayControls } from './dashboard-display-controls.js';
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
                    <header className='flex shrink-0 flex-wrap items-center justify-between gap-4 border-b border-[var(--dash-border)] pb-5'>
                        <div className='min-w-0'>
                            <h1 className='text-3xl font-semibold text-[var(--dash-text)] [text-shadow:0_2px_18px_rgba(0,0,0,0.72)]'>
                                Choose server
                            </h1>
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

                    <section className='min-h-0 flex-1 overflow-y-auto pb-8' aria-label='Server launcher'>
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
            <section className='dashboard-glass-panel mx-auto grid min-h-[24rem] max-w-3xl place-items-center p-8 text-center'>
                <div className='max-w-xl'>
                    <div className='mx-auto grid size-14 place-items-center rounded-full border border-[rgba(56,189,248,0.32)] bg-[rgba(56,189,248,0.12)] text-[var(--dash-primary)] shadow-[0_0_32px_rgba(56,189,248,0.2)]'>
                        <Server className='size-6' aria-hidden='true' />
                    </div>
                    <h1 className='mt-5 text-3xl font-semibold tracking-tight text-[var(--dash-text)] [text-shadow:0_2px_18px_rgba(0,0,0,0.72)]'>
                        No servers available
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
                aria-label={`Open ${guild.name} dashboard`}
                className='group relative flex min-h-[6.75rem] items-center gap-3 overflow-hidden rounded-[var(--dash-radius-panel)] border border-[rgba(148,163,184,0.28)] bg-[linear-gradient(135deg,rgba(8,13,25,0.9),rgba(12,18,30,0.86)_56%,rgba(32,15,41,0.66))] p-3 shadow-[var(--dash-shadow-surface)] transition hover:border-[var(--dash-border-interactive)] hover:bg-[linear-gradient(135deg,rgba(10,18,32,0.96),rgba(18,25,40,0.9)_56%,rgba(42,18,54,0.74))] focus-visible:border-[var(--dash-primary)] focus-visible:shadow-[var(--dash-shadow-focus)] focus-visible:outline-none'>
                <span
                    className='absolute inset-x-0 top-0 h-px bg-[linear-gradient(90deg,rgba(34,211,238,0.86),rgba(167,139,250,0.56),rgba(250,204,21,0.48))]'
                    aria-hidden='true'
                />
                <div className='flex min-w-0 flex-1 items-center gap-3'>
                    <DashboardGuildIcon guild={guild} />
                    <div className='min-w-0 flex-1'>
                        <h3 className='truncate text-lg font-semibold text-[var(--dash-text)]'>{guild.name}</h3>
                        <p className='mt-1 max-w-full truncate font-mono text-[0.72rem] text-[var(--dash-text-subtle)]'>
                            {guild.id}
                        </p>
                    </div>
                </div>
                <span className='grid size-9 shrink-0 place-items-center rounded-[var(--dash-radius-control)] border border-[rgba(56,189,248,0.22)] bg-[rgba(56,189,248,0.08)] text-[var(--dash-primary)] opacity-80 transition group-hover:border-[rgba(56,189,248,0.54)] group-hover:bg-[rgba(56,189,248,0.14)] group-hover:opacity-100'>
                    <ArrowUpRight className='size-4' aria-hidden='true' />
                </span>
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
                className='size-12 shrink-0 rounded-[var(--dash-radius-surface)] bg-[var(--dash-surface-raised)] object-cover ring-1 ring-[rgba(255,255,255,0.1)]'
                loading='lazy'
                referrerPolicy='no-referrer'
            />
        );
    }

    return (
        <span
            className='grid size-12 shrink-0 place-items-center rounded-[var(--dash-radius-surface)] bg-[var(--dash-surface-raised)] text-sm font-semibold text-[var(--dash-text)] ring-1 ring-[rgba(255,255,255,0.1)]'
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

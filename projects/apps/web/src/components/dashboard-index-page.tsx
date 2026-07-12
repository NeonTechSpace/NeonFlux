import { Link } from '@tanstack/react-router';
import { ArrowUpRight, ExternalLink, Plus, Server } from 'lucide-react';

import { createDashboardGuildPreview, withDashboardGuildPreview } from '../dashboard-guild-preview.js';
import type { DashboardViewModel, DashboardViewModelGuild } from '../server/dashboard-view-model.server.js';
import type { DashboardRouteData } from '../server/dashboard-route-data.js';
import { DashboardDisplayControls } from './dashboard-display-controls.js';
import { DashboardShell, DashboardStatusSection } from './dashboard-layout.js';
import { DashboardGuildSelectorAvatar } from './dashboard-server-dock-ui.js';
import { dashboardPrimaryActionClassName, dashboardSecondaryActionClassName } from './dashboard-ui.js';

const fluxerLoginPath = '/auth/fluxer/login';
const dashboardGuildCardBaseClassName =
    'group relative isolate flex min-h-[7.5rem] items-center overflow-hidden rounded-[var(--dash-radius-panel)] border border-[rgba(112,177,224,0.3)] bg-[radial-gradient(circle_at_8%_0%,rgba(90,215,255,0.1),transparent_42%),linear-gradient(145deg,rgba(11,24,43,0.94),rgba(15,15,35,0.92))] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.075),var(--dash-shadow-surface),0_18px_52px_rgba(3,7,18,0.2)] backdrop-blur-[18px] backdrop-saturate-[1.28] transition-[border-color,background,box-shadow] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] sm:p-5';
const dashboardGuildCardDecorationClassName =
    "before:pointer-events-none before:absolute before:inset-0 before:z-0 before:scale-[0.94] before:bg-[radial-gradient(circle_at_12%_10%,rgba(90,215,255,0.24),transparent_46%),radial-gradient(circle_at_92%_110%,rgba(157,140,255,0.22),transparent_52%)] before:opacity-0 before:transition-[opacity,transform] before:duration-[240ms] before:ease-out before:content-[''] after:pointer-events-none after:absolute after:inset-x-[12%] after:bottom-0 after:h-px after:origin-center after:scale-x-[0.28] after:bg-[linear-gradient(90deg,transparent,var(--dash-primary),var(--dash-creative),transparent)] after:opacity-30 after:transition-[opacity,transform] after:duration-[240ms] after:ease-out after:content-['']";
const dashboardGuildCardInteractionClassName =
    'hover:border-[rgba(90,215,255,0.68)] hover:bg-[radial-gradient(circle_at_8%_0%,rgba(90,215,255,0.15),transparent_42%),linear-gradient(145deg,rgba(12,31,54,0.97),rgba(24,17,48,0.95))] hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.11),0_0_0_1px_rgba(90,215,255,0.1),0_18px_42px_rgba(4,10,24,0.4),0_0_30px_rgba(90,215,255,0.13)] hover:before:scale-100 hover:before:opacity-100 hover:after:scale-x-100 hover:after:opacity-[0.86] focus-visible:border-[rgba(90,215,255,0.68)] focus-visible:bg-[radial-gradient(circle_at_8%_0%,rgba(90,215,255,0.15),transparent_42%),linear-gradient(145deg,rgba(12,31,54,0.97),rgba(24,17,48,0.95))] focus-visible:shadow-[var(--dash-shadow-focus),0_18px_42px_rgba(4,10,24,0.4),0_0_30px_rgba(90,215,255,0.13)] focus-visible:outline-none focus-visible:before:scale-100 focus-visible:before:opacity-100 focus-visible:after:scale-x-100 focus-visible:after:opacity-[0.86]';
const dashboardGuildCardReducedEffectsClassName =
    'motion-reduce:transform-none motion-reduce:transition-none motion-reduce:before:transition-none motion-reduce:after:transition-none [.dashboard-theme[data-reduce-effects=true]_&]:transform-none [.dashboard-theme[data-reduce-effects=true]_&]:transition-none [.dashboard-theme[data-reduce-effects=true]_&]:before:transition-none [.dashboard-theme[data-reduce-effects=true]_&]:after:transition-none';
const dashboardGuildCardClassName = [
    dashboardGuildCardBaseClassName,
    dashboardGuildCardDecorationClassName,
    dashboardGuildCardInteractionClassName,
    dashboardGuildCardReducedEffectsClassName,
].join(' ');

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
                                    className={`${dashboardSecondaryActionClassName} inline-flex min-h-10 items-center gap-2`}>
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
                                className={`${dashboardPrimaryActionClassName} inline-flex min-h-11 items-center gap-2`}>
                                <Plus className='size-4' aria-hidden='true' />
                                Invite bot
                            </a>
                        ) : null}
                        <Link
                            to={fluxerLoginPath}
                            className={`${dashboardSecondaryActionClassName} inline-flex min-h-11 items-center gap-2 px-4`}>
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
                className={dashboardGuildCardClassName}>
                <div className='relative flex min-w-0 flex-1 items-center gap-4'>
                    <span className='grid size-14 shrink-0 place-items-center overflow-hidden rounded-full border border-[var(--dash-border-interactive)] bg-[var(--dash-surface-raised)] shadow-[0_0_22px_rgba(90,215,255,0.14)] transition duration-200 group-hover:scale-[1.04] group-hover:border-[var(--dash-primary)] group-hover:shadow-[0_0_28px_rgba(90,215,255,0.3)] motion-reduce:transform-none motion-reduce:transition-none [.dashboard-theme[data-reduce-effects=true]_&]:transform-none [.dashboard-theme[data-reduce-effects=true]_&]:transition-none'>
                        <DashboardGuildSelectorAvatar guild={guild} />
                    </span>
                    <div className='min-w-0 flex-1'>
                        <h3 className='line-clamp-2 text-xl leading-7 font-semibold text-[var(--dash-text)]'>
                            {guild.name}
                        </h3>
                    </div>
                    <span className='grid size-9 shrink-0 place-items-center rounded-[var(--dash-radius-control)] border border-[var(--dash-border)] bg-[var(--dash-primary-soft)] text-[var(--dash-primary)] transition-[border-color,box-shadow,transform] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] group-hover:translate-x-0.5 group-hover:border-[var(--dash-primary)] group-hover:shadow-[0_0_16px_rgba(90,215,255,0.2)] motion-reduce:transform-none motion-reduce:transition-none [.dashboard-theme[data-reduce-effects=true]_&]:transform-none [.dashboard-theme[data-reduce-effects=true]_&]:transition-none'>
                        <ArrowUpRight className='size-4' aria-hidden='true' />
                    </span>
                </div>
            </Link>
        </li>
    );
}

import { Outlet } from '@tanstack/react-router';
import { createContext, use } from 'react';
import type { ReactNode } from 'react';

import type { DashboardLiveArea } from '../dashboard-live.js';
import type { DashboardGuildPreview } from '../dashboard-guild-preview.js';
import { getDashboardCategory } from '../dashboard-categories.js';
import type { DashboardCategoryId } from '../dashboard-categories.js';
import type { DashboardGuildShellGuild } from '../server/dashboard-guild-page.server.js';
import type { DashboardGuildRouteData } from '../server/dashboard-guild-route-data.js';
import { DashboardCategoryNavigation } from './dashboard-category-navigation.js';
import { DashboardAuditEventsPanel } from './dashboard-audit-events-panel.js';
import { DashboardCommandPrefixSettingsPanel } from './dashboard-command-prefix-panel.js';
import { DashboardFeaturePlaceholder } from './dashboard-feature-placeholder.js';
import { getDashboardGuildSwitchPath } from './dashboard-guild-selector.js';
import { useDashboardLiveInvalidation } from './dashboard-live-invalidation.js';
import { DashboardShell, DashboardStatusSection } from './dashboard-layout.js';
import { DashboardPostingPanel } from './dashboard-posting-panel.js';
import { DashboardReactionRolesPanel } from './dashboard-reaction-roles-panel.js';
import { DashboardServerOverviewLoading, DashboardServerOverviewPanel } from './dashboard-server-overview-panel.js';
import { DashboardStructurePanel } from './dashboard-structure-panel.js';

const fluxerLoginPath = '/auth/fluxer/login';
const commandLiveArea = ['commands'] as const satisfies readonly DashboardLiveArea[];
const overviewLiveArea = ['overview'] as const satisfies readonly DashboardLiveArea[];
const messagingLiveArea = ['posting'] as const satisfies readonly DashboardLiveArea[];
const reactionRolesLiveArea = ['reaction_roles'] as const satisfies readonly DashboardLiveArea[];
const structureLiveArea = ['import_export', 'structure'] as const satisfies readonly DashboardLiveArea[];
const auditLiveArea = ['audit'] as const satisfies readonly DashboardLiveArea[];

type AuthorizedDashboardGuildRouteData = Extract<DashboardGuildRouteData, { type: 'guild' }>;

const DashboardGuildDataContext = createContext<AuthorizedDashboardGuildRouteData | undefined>(undefined);

export function DashboardGuildPageContent({
    data,
    activeCategoryId = 'overview',
    children,
}: {
    data: DashboardGuildRouteData;
    activeCategoryId?: DashboardCategoryId;
    children?: ReactNode;
}) {
    switch (data.type) {
        case 'guild':
            return (
                <DashboardGuildView data={data} activeCategoryId={activeCategoryId}>
                    {children ?? <Outlet />}
                </DashboardGuildView>
            );

        case 'single-unauthorized':
            return (
                <DashboardShell>
                    <DashboardStatusSection
                        eyebrow='Server access'
                        title='Not authorized'
                        body={`You are not authorized to modify ${data.configuredGuildName}.`}
                        actionLabel='Use another account'
                        actionTo={fluxerLoginPath}
                    />
                </DashboardShell>
            );

        case 'unavailable':
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
}

export function DashboardGuildPendingPage({
    guildId,
    preview,
    sourcePreview,
    pathname,
    activeCategoryId = 'overview',
}: {
    guildId: string;
    preview?: DashboardGuildPreview;
    sourcePreview?: DashboardGuildPreview;
    pathname?: string;
    activeCategoryId?: DashboardCategoryId;
}) {
    if (!preview) {
        return <DashboardGuildColdLoadingShell activeCategoryId={activeCategoryId} />;
    }

    const currentPreview = sourcePreview ?? preview;
    const sourcePathname =
        sourcePreview && pathname ? getDashboardGuildSwitchPath(guildId, sourcePreview.id, pathname) : undefined;

    return (
        <DashboardGuildFrame
            guild={currentPreview}
            manageableGuilds={sourcePreview ? [sourcePreview, preview] : [preview]}
            guildId={sourcePreview?.id ?? guildId}
            activeCategoryId={activeCategoryId}
            mode={sourcePreview ? 'multi' : preview.mode}
            pendingGuildId={sourcePreview ? preview.id : undefined}
            pathnameOverride={sourcePathname}
            isLoading>
            <DashboardPendingCategory activeCategoryId={activeCategoryId} />
        </DashboardGuildFrame>
    );
}

function DashboardGuildColdLoadingShell({ activeCategoryId }: { activeCategoryId: DashboardCategoryId }) {
    return (
        <DashboardShell>
            <div className='flex h-full min-h-0 min-w-0 flex-col gap-3 overflow-hidden md:flex-row md:gap-4'>
                <header
                    className='flex min-h-14 shrink-0 items-center gap-3 rounded-[var(--dash-radius-panel)] border border-[var(--dash-border)] bg-[rgba(8,13,21,0.92)] p-2 md:hidden'
                    aria-label='Loading dashboard navigation'>
                    <span className='size-9 animate-pulse rounded-full bg-[var(--dash-surface-raised)]' />
                    <span className='h-3 w-32 animate-pulse rounded-full bg-[var(--dash-surface-raised)]' />
                </header>
                <aside
                    className='hidden h-full min-h-0 w-[4.5rem] shrink-0 flex-col rounded-[var(--dash-radius-panel)] border border-[var(--dash-border)] bg-[rgba(7,11,18,0.9)] p-2 md:flex xl:w-64 xl:p-3'
                    aria-label='Loading dashboard navigation'>
                    <div className='flex min-h-12 items-center justify-center gap-3 border-b border-[var(--dash-border)] pb-3 xl:justify-start'>
                        <span className='size-9 animate-pulse rounded-full bg-[var(--dash-surface-raised)]' />
                        <span className='hidden h-3 w-28 animate-pulse rounded-full bg-[var(--dash-surface-raised)] xl:block' />
                    </div>
                    <div className='space-y-2 py-4'>
                        {Array.from({ length: 6 }, (_, index) => (
                            <div
                                key={index}
                                className='mx-auto h-11 w-11 animate-pulse rounded-[var(--dash-radius-control)] bg-[var(--dash-surface-raised)] xl:mx-0 xl:w-full'
                            />
                        ))}
                    </div>
                </aside>
                <div className='min-h-0 min-w-0 flex-1 overflow-y-auto px-0.5 pb-8 md:pr-2'>
                    <section className='min-h-full space-y-4' aria-label='Loading dashboard'>
                        <div className='border-b border-[var(--dash-border)] px-1 pb-3'>
                            <span role='status' className='sr-only'>
                                Loading dashboard
                            </span>
                            <div className='h-7 w-48 animate-pulse rounded-[var(--dash-radius-control)] bg-[var(--dash-surface-raised)]' />
                            <div className='mt-2 h-4 w-80 max-w-full animate-pulse rounded-[var(--dash-radius-control)] bg-[var(--dash-surface-raised)]' />
                        </div>
                        <DashboardCategoryLoading categoryId={activeCategoryId} />
                    </section>
                </div>
            </div>
        </DashboardShell>
    );
}

function useDashboardGuildData(): AuthorizedDashboardGuildRouteData {
    const data = use(DashboardGuildDataContext);

    if (!data) {
        throw new Error('Dashboard guild category rendered outside the guild dashboard context.');
    }

    return data;
}

export function DashboardGuildOverviewCategory() {
    const data = useDashboardGuildData();

    useDashboardLiveInvalidation({
        guildId: data.guild.id,
        areas: overviewLiveArea,
    });

    return (
        <DashboardCategorySection categoryId='overview'>
            <DashboardServerOverviewPanel guildId={data.guild.id} />
        </DashboardCategorySection>
    );
}

export function DashboardGuildCommandPrefixCategory() {
    const data = useDashboardGuildData();

    useDashboardLiveInvalidation({
        guildId: data.guild.id,
        areas: commandLiveArea,
    });

    return <DashboardCommandPrefixSettingsPanel guildId={data.guild.id} commandSettings={data.commandSettings} />;
}

export function DashboardGuildMessageBuilderCategory() {
    const data = useDashboardGuildData();

    useDashboardLiveInvalidation({
        guildId: data.guild.id,
        areas: messagingLiveArea,
    });

    return <DashboardPostingPanel guildId={data.guild.id} />;
}

export function DashboardGuildReactionRolesCategory() {
    const data = useDashboardGuildData();

    useDashboardLiveInvalidation({
        guildId: data.guild.id,
        areas: reactionRolesLiveArea,
    });

    return <DashboardReactionRolesPanel guildId={data.guild.id} />;
}

export function DashboardGuildStructureCategory() {
    const data = useDashboardGuildData();

    useDashboardLiveInvalidation({
        guildId: data.guild.id,
        areas: structureLiveArea,
    });

    return <DashboardStructurePanel guildId={data.guild.id} />;
}

export function DashboardGuildAuditEventsCategory() {
    const data = useDashboardGuildData();

    useDashboardLiveInvalidation({
        guildId: data.guild.id,
        areas: auditLiveArea,
    });

    return <DashboardAuditEventsPanel guildId={data.guild.id} />;
}

export function DashboardGuildPlaceholderCategory({ featureName }: { featureName: string }) {
    return <DashboardFeaturePlaceholder featureName={featureName} />;
}

function DashboardGuildView({
    data,
    activeCategoryId,
    children,
}: {
    data: AuthorizedDashboardGuildRouteData;
    activeCategoryId: DashboardCategoryId;
    children: ReactNode;
}) {
    return (
        <DashboardGuildFrame
            guild={data.guild}
            manageableGuilds={data.manageableGuilds ?? [data.guild]}
            guildId={data.guild.id}
            activeCategoryId={activeCategoryId}
            mode={data.mode}
            botInviteUrl={data.botInviteUrl}>
            <DashboardGuildDataContext value={data}>{children}</DashboardGuildDataContext>
        </DashboardGuildFrame>
    );
}

function DashboardGuildFrame({
    guild,
    manageableGuilds,
    guildId,
    activeCategoryId,
    mode,
    botInviteUrl,
    pendingGuildId,
    pathnameOverride,
    isLoading = false,
    children,
}: {
    guild: DashboardGuildShellGuild;
    manageableGuilds: DashboardGuildShellGuild[];
    guildId: string;
    activeCategoryId: DashboardCategoryId;
    mode: 'single' | 'multi';
    botInviteUrl?: string;
    pendingGuildId?: string;
    pathnameOverride?: string;
    isLoading?: boolean;
    children: ReactNode;
}) {
    return (
        <DashboardShell>
            <div className='flex h-full min-h-0 min-w-0 flex-col gap-3 overflow-hidden md:flex-row md:gap-4'>
                <DashboardCategoryNavigation
                    guild={guild}
                    guilds={manageableGuilds}
                    guildId={guildId}
                    activeCategoryId={activeCategoryId}
                    mode={mode}
                    botInviteUrl={botInviteUrl}
                    pendingGuildId={pendingGuildId}
                    pathnameOverride={pathnameOverride}
                    isLoading={isLoading}
                />
                <div className='min-h-0 min-w-0 flex-1 overflow-y-auto px-0.5 pb-8 md:pr-2'>{children}</div>
            </div>
        </DashboardShell>
    );
}

function DashboardCategorySection({ categoryId, children }: { categoryId: DashboardCategoryId; children: ReactNode }) {
    const category = getDashboardCategory(categoryId);
    const headingId = `dashboard-${category.id}-heading`;
    const title = category.id === 'overview' ? 'Server pulse' : category.label;
    const description =
        category.id === 'overview' ? 'Growth and message activity across this server.' : category.description;

    return (
        <section className='min-h-full space-y-4' aria-label={category.label}>
            <div className='border-b border-[var(--dash-border)] px-1 pb-3'>
                <h2 id={headingId} className='text-2xl font-semibold tracking-tight text-[var(--dash-text)]'>
                    {title}
                </h2>
                <p className='mt-1 max-w-3xl text-[0.95rem] leading-6 text-[var(--dash-text-muted)]'>{description}</p>
            </div>
            {children}
        </section>
    );
}

function DashboardPendingCategory({ activeCategoryId }: { activeCategoryId: DashboardCategoryId }) {
    if (activeCategoryId === 'overview') {
        return (
            <DashboardCategorySection categoryId='overview'>
                <DashboardServerOverviewLoading />
            </DashboardCategorySection>
        );
    }

    return (
        <DashboardCategorySection categoryId={activeCategoryId}>
            <DashboardCategoryLoading categoryId={activeCategoryId} />
        </DashboardCategorySection>
    );
}

function DashboardCategoryLoading({ categoryId }: { categoryId: DashboardCategoryId }) {
    const compact = categoryId === 'general' || categoryId === 'structure' || categoryId === 'events';

    return (
        <div className={compact ? 'space-y-4' : 'grid gap-4 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]'}>
            <article className='dashboard-glass-panel p-5' aria-label='Loading settings panel'>
                <div className='h-5 w-40 animate-pulse rounded-[var(--dash-radius-control)] bg-[var(--dash-surface-raised)]' />
                <div className='mt-3 h-4 w-64 max-w-full animate-pulse rounded-[var(--dash-radius-control)] bg-[rgba(177,186,200,0.14)]' />
                <div className='mt-6 space-y-3'>
                    {Array.from({ length: compact ? 2 : 4 }, (_, index) => (
                        <div
                            key={index}
                            className='h-11 animate-pulse rounded-[var(--dash-radius-control)] border border-[var(--dash-border)] bg-[rgba(6,10,18,0.52)]'
                        />
                    ))}
                </div>
            </article>
            {!compact ? (
                <article className='dashboard-glass-panel p-5' aria-label='Loading preview panel'>
                    <div className='h-5 w-36 animate-pulse rounded-[var(--dash-radius-control)] bg-[var(--dash-surface-raised)]' />
                    <div className='mt-5 space-y-3'>
                        <div className='h-16 animate-pulse rounded-[var(--dash-radius-control)] bg-[rgba(56,189,248,0.08)]' />
                        <div className='h-16 animate-pulse rounded-[var(--dash-radius-control)] bg-[rgba(217,70,239,0.08)]' />
                    </div>
                </article>
            ) : null}
        </div>
    );
}

import { Outlet, useLocation } from '@tanstack/react-router';
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
import { DashboardDisplayControls } from './dashboard-display-controls.js';
import { DashboardFeaturePlaceholder } from './dashboard-feature-placeholder.js';
import { DashboardGuildSelector } from './dashboard-guild-selector.js';
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
    activeCategoryId = 'overview',
}: {
    guildId: string;
    preview?: DashboardGuildPreview;
    activeCategoryId?: DashboardCategoryId;
}) {
    if (!preview) {
        return null;
    }

    return (
        <DashboardGuildFrame guild={preview} manageableGuilds={[preview]} mode={preview.mode} isLoading>
            <DashboardCategoryLayout guildId={guildId} activeCategoryId={activeCategoryId}>
                <DashboardPendingCategory activeCategoryId={activeCategoryId} />
            </DashboardCategoryLayout>
        </DashboardGuildFrame>
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
            mode={data.mode}
            botInviteUrl={data.botInviteUrl}>
            <DashboardGuildDataContext value={data}>
                <DashboardCategoryLayout guildId={data.guild.id} activeCategoryId={activeCategoryId}>
                    {children}
                </DashboardCategoryLayout>
            </DashboardGuildDataContext>
        </DashboardGuildFrame>
    );
}

function DashboardGuildFrame({
    guild,
    manageableGuilds,
    mode,
    botInviteUrl,
    isLoading = false,
    children,
}: {
    guild: DashboardGuildShellGuild;
    manageableGuilds: DashboardGuildShellGuild[];
    mode: 'single' | 'multi';
    botInviteUrl?: string;
    isLoading?: boolean;
    children: ReactNode;
}) {
    const pathname = useLocation({ select: (location) => location.pathname });
    const guildSelector =
        mode === 'multi' ? (
            <DashboardGuildSelector
                guilds={manageableGuilds}
                activeGuildId={guild.id}
                pathname={pathname}
                botInviteUrl={botInviteUrl}
            />
        ) : undefined;

    return (
        <DashboardShell>
            <DashboardDisplayControls />
            <div className='flex h-full min-h-0 min-w-0 flex-col gap-4 overflow-hidden'>
                <DashboardGuildHeader guild={guild} isLoading={isLoading} guildSelector={guildSelector} />
                <div className='min-h-0 min-w-0 flex-1 overflow-hidden'>{children}</div>
            </div>
        </DashboardShell>
    );
}

function DashboardCategoryLayout({
    guildId,
    activeCategoryId,
    children,
}: {
    guildId: string;
    activeCategoryId: DashboardCategoryId;
    children: ReactNode;
}) {
    return (
        <div className='grid h-full min-h-0 min-w-0 grid-cols-[minmax(0,1fr)] gap-5 overflow-hidden xl:grid-cols-[15rem_minmax(0,1fr)]'>
            <DashboardCategoryNavigation guildId={guildId} activeCategoryId={activeCategoryId} />
            <main className='min-h-0 min-w-0 overflow-y-auto pr-1 pb-8 xl:pr-3'>{children}</main>
        </div>
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

function DashboardGuildHeader({
    guild,
    isLoading = false,
    guildSelector,
}: {
    guild: { id: string; name: string; iconUrl?: string };
    isLoading?: boolean;
    guildSelector?: ReactNode;
}) {
    return (
        <header className='shrink-0 border-b border-[var(--dash-border)] px-1 pt-1 pb-4 lg:pr-24'>
            <div
                className={
                    guildSelector
                        ? 'grid min-w-0 gap-4 lg:grid-cols-[minmax(0,20rem)_minmax(18rem,1fr)] lg:items-center'
                        : 'grid min-w-0 gap-4 lg:grid-cols-[minmax(0,20rem)] lg:items-center'
                }>
                <div className='flex min-w-0 items-center gap-3 sm:gap-4'>
                    <DashboardGuildAvatar guild={guild} />
                    <div className='w-56 max-w-[calc(100vw-7rem)] min-w-0 shrink text-center sm:w-64 lg:w-64'>
                        <h1 className='block truncate text-center text-[1.7rem] leading-tight font-semibold text-[var(--dash-text)] [text-shadow:0_2px_16px_rgba(0,0,0,0.76)]'>
                            {guild.name}
                        </h1>
                        <p className='mt-1 block truncate text-center font-mono text-[0.8rem] font-medium text-[var(--dash-text-muted)] [text-shadow:0_1px_10px_rgba(0,0,0,0.72)]'>
                            {guild.id}
                        </p>
                    </div>
                </div>
                {guildSelector ? <div className='min-w-0'>{guildSelector}</div> : null}
                {isLoading ? (
                    <span
                        role='status'
                        className='inline-flex min-h-9 shrink-0 items-center rounded-[var(--dash-radius-control)] border border-[var(--dash-border)] px-3 text-sm font-semibold text-[var(--dash-text-muted)] lg:col-start-2'>
                        Loading settings
                    </span>
                ) : null}
            </div>
        </header>
    );
}

function DashboardGuildAvatar({ guild }: { guild: { name: string; iconUrl?: string } }) {
    const fallbackLabel = getGuildFallbackLabel(guild.name);

    if (guild.iconUrl) {
        return (
            <img
                src={guild.iconUrl}
                alt={`${guild.name} icon`}
                className='size-12 shrink-0 rounded-full bg-[var(--dash-surface-raised)] object-cover'
                loading='lazy'
                referrerPolicy='no-referrer'
            />
        );
    }

    return (
        <span
            className='grid size-12 shrink-0 place-items-center rounded-full bg-[var(--dash-surface-raised)] text-base font-semibold text-[var(--dash-text)]'
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

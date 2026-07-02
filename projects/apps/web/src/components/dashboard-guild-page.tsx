import { Link, Outlet } from '@tanstack/react-router';
import { createContext, use } from 'react';
import type { ReactNode } from 'react';

import type { DashboardLiveArea } from '../dashboard-live.js';
import type { DashboardGuildPreview } from '../dashboard-guild-preview.js';
import { getDashboardCategory } from '../dashboard-categories.js';
import type { DashboardCategoryId } from '../dashboard-categories.js';
import type { DashboardGuildRouteData } from '../server/dashboard-guild-route-data.js';
import { DashboardAuditEventsPanel } from './dashboard-audit-events-panel.js';
import { DashboardAutorolePanel } from './dashboard-autorole-panel.js';
import { DashboardAutomodPanel } from './dashboard-automod-panel.js';
import { DashboardCommandAccessPanel } from './dashboard-command-access-panel.js';
import { DashboardCategoryNavigation } from './dashboard-category-navigation.js';
import { DashboardCommandPrefixSettingsPanel } from './dashboard-command-prefix-panel.js';
import { DashboardInviteTrackingLoading, DashboardInviteTrackingPanel } from './dashboard-invite-tracking-panel.js';
import { useDashboardLiveInvalidation } from './dashboard-live-invalidation.js';
import { DashboardLoggingDestinationsPanel } from './dashboard-logging-destinations-panel.js';
import { DashboardGiveawaysPanel } from './dashboard-giveaways-panel.js';
import { DashboardShell, DashboardStatusSection } from './dashboard-layout.js';
import { DashboardModerationCasesPanel } from './dashboard-moderation-cases-panel.js';
import { DashboardModerationPolicyPanel } from './dashboard-moderation-policy-panel.js';
import { DashboardPostingPanel } from './dashboard-posting-panel.js';
import { DashboardProfileBuilderPanel } from './dashboard-profile-builder-panel.js';
import { DashboardReactionRolesPanel } from './dashboard-reaction-roles-panel.js';
import { DashboardRoleReconciliationPanel } from './dashboard-role-reconciliation-panel.js';
import { DashboardServerOverviewLoading, DashboardServerOverviewPanel } from './dashboard-server-overview-panel.js';
import { DashboardStructurePanel } from './dashboard-structure-panel.js';
import { DashboardSuggestionsPanel } from './dashboard-suggestions-panel.js';
import { DashboardTicketsPanel } from './dashboard-tickets-panel.js';
import { DashboardVerificationPanel } from './dashboard-verification-panel.js';
import { DashboardVcGeneratorPanel } from './dashboard-vc-generator-panel.js';
import { DashboardXpSettingsPanel } from './dashboard-xp-settings-panel.js';

const fluxerLoginPath = '/auth/fluxer/login';
const auditLiveArea = ['audit'] as const satisfies readonly DashboardLiveArea[];
const commandLiveArea = ['commands'] as const satisfies readonly DashboardLiveArea[];
const overviewLiveArea = ['overview'] as const satisfies readonly DashboardLiveArea[];
const invitesLiveArea = ['invites'] as const satisfies readonly DashboardLiveArea[];
const loggingLiveArea = ['logging'] as const satisfies readonly DashboardLiveArea[];
const messagingLiveArea = ['posting'] as const satisfies readonly DashboardLiveArea[];
const moderationLiveArea = ['moderation'] as const satisfies readonly DashboardLiveArea[];
const structureLiveArea = ['import_export', 'structure'] as const satisfies readonly DashboardLiveArea[];
const accessLiveArea = [
    'access',
    'autorole',
    'reaction_roles',
    'role_reconciliation',
    'verification',
] as const satisfies readonly DashboardLiveArea[];
const communityLiveArea = [
    'xp',
    'vc_generator',
    'tickets',
    'suggestions',
    'profile_builder',
    'giveaways',
] as const satisfies readonly DashboardLiveArea[];

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
                        eyebrow='Single instance'
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
        <DashboardShell>
            <DashboardGuildHeader mode={preview.mode} guild={preview} isLoading />
            <DashboardCategoryLayout guildId={guildId} activeCategoryId={activeCategoryId}>
                <DashboardPendingCategory activeCategoryId={activeCategoryId} />
            </DashboardCategoryLayout>
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

export function DashboardGuildGeneralCategory() {
    const data = useDashboardGuildData();

    useDashboardLiveInvalidation({
        guildId: data.guild.id,
        areas: commandLiveArea,
    });

    return (
        <DashboardCategorySection categoryId='general'>
            <DashboardCommandPrefixSettingsPanel guildId={data.guild.id} commandSettings={data.commandSettings} />
        </DashboardCategorySection>
    );
}

export function DashboardGuildMessagingCategory() {
    const data = useDashboardGuildData();

    useDashboardLiveInvalidation({
        guildId: data.guild.id,
        areas: messagingLiveArea,
    });

    return (
        <DashboardCategorySection categoryId='messaging'>
            <DashboardPostingPanel guildId={data.guild.id} />
        </DashboardCategorySection>
    );
}

export function DashboardGuildInviteTrackingCategory() {
    const data = useDashboardGuildData();

    useDashboardLiveInvalidation({
        guildId: data.guild.id,
        areas: invitesLiveArea,
    });

    return (
        <DashboardCategorySection categoryId='invites'>
            <DashboardInviteTrackingPanel guildId={data.guild.id} />
        </DashboardCategorySection>
    );
}

export function DashboardGuildAccessCategory() {
    const data = useDashboardGuildData();

    useDashboardLiveInvalidation({
        guildId: data.guild.id,
        areas: accessLiveArea,
    });

    return (
        <DashboardCategorySection categoryId='access'>
            <DashboardAutorolePanel guildId={data.guild.id} />
            <DashboardReactionRolesPanel guildId={data.guild.id} />
            <DashboardVerificationPanel guildId={data.guild.id} />
            <DashboardRoleReconciliationPanel guildId={data.guild.id} />
            <DashboardCommandAccessPanel guildId={data.guild.id} />
        </DashboardCategorySection>
    );
}

export function DashboardGuildCommunityCategory() {
    const data = useDashboardGuildData();

    useDashboardLiveInvalidation({
        guildId: data.guild.id,
        areas: communityLiveArea,
    });

    return (
        <DashboardCategorySection categoryId='community'>
            <DashboardXpSettingsPanel guildId={data.guild.id} />
            <DashboardGiveawaysPanel guildId={data.guild.id} />
            <DashboardProfileBuilderPanel guildId={data.guild.id} />
            <DashboardVcGeneratorPanel guildId={data.guild.id} />
            <DashboardTicketsPanel guildId={data.guild.id} />
            <DashboardSuggestionsPanel guildId={data.guild.id} />
        </DashboardCategorySection>
    );
}

export function DashboardGuildModerationCategory() {
    const data = useDashboardGuildData();

    useDashboardLiveInvalidation({
        guildId: data.guild.id,
        areas: moderationLiveArea,
    });

    return (
        <DashboardCategorySection categoryId='moderation'>
            <DashboardAutomodPanel guildId={data.guild.id} />
            <DashboardModerationPolicyPanel guildId={data.guild.id} />
            <DashboardModerationCasesPanel guildId={data.guild.id} />
        </DashboardCategorySection>
    );
}

export function DashboardGuildLoggingCategory() {
    const data = useDashboardGuildData();

    useDashboardLiveInvalidation({
        guildId: data.guild.id,
        areas: loggingLiveArea,
    });

    return (
        <DashboardCategorySection categoryId='logging'>
            <DashboardLoggingDestinationsPanel guildId={data.guild.id} />
        </DashboardCategorySection>
    );
}

export function DashboardGuildStructureCategory() {
    const data = useDashboardGuildData();

    useDashboardLiveInvalidation({
        guildId: data.guild.id,
        areas: structureLiveArea,
    });

    return (
        <DashboardCategorySection categoryId='structure'>
            <DashboardStructurePanel guildId={data.guild.id} />
        </DashboardCategorySection>
    );
}

export function DashboardGuildAuditCategory() {
    const data = useDashboardGuildData();

    useDashboardLiveInvalidation({
        guildId: data.guild.id,
        areas: auditLiveArea,
    });

    return (
        <DashboardCategorySection categoryId='audit'>
            <DashboardAuditEventsPanel guildId={data.guild.id} />
        </DashboardCategorySection>
    );
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
        <DashboardShell>
            <DashboardGuildHeader mode={data.mode} guild={data.guild} />
            <DashboardGuildDataContext value={data}>
                <DashboardCategoryLayout guildId={data.guild.id} activeCategoryId={activeCategoryId}>
                    {children}
                </DashboardCategoryLayout>
            </DashboardGuildDataContext>
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
        <div className='grid gap-6 lg:grid-cols-[16rem_minmax(0,1fr)]'>
            <DashboardCategoryNavigation guildId={guildId} activeCategoryId={activeCategoryId} />
            <div className='min-w-0'>{children}</div>
        </div>
    );
}

function DashboardCategorySection({ categoryId, children }: { categoryId: DashboardCategoryId; children: ReactNode }) {
    const category = getDashboardCategory(categoryId);
    const headingId = `dashboard-${category.id}-heading`;

    return (
        <section className='space-y-4' aria-labelledby={headingId}>
            <div className='space-y-1'>
                <h2 id={headingId} className='text-xl font-semibold text-white'>
                    {category.label}
                </h2>
                <p className='text-sm leading-6 text-neutral-400'>{category.description}</p>
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

    if (activeCategoryId === 'invites') {
        return (
            <DashboardCategorySection categoryId='invites'>
                <DashboardInviteTrackingLoading />
            </DashboardCategorySection>
        );
    }

    return (
        <DashboardCategorySection categoryId={activeCategoryId}>
            <StatusCard title='Loading settings' body='Fetching saved settings for this category.' isLoading />
        </DashboardCategorySection>
    );
}

function DashboardGuildHeader({
    mode,
    guild,
    isLoading = false,
}: {
    mode: 'single' | 'multi';
    guild: { id: string; name: string; iconUrl?: string };
    isLoading?: boolean;
}) {
    return (
        <header className='space-y-3 border-b border-neutral-800 pb-6'>
            <div className='flex flex-wrap items-center justify-between gap-3'>
                <p className='text-sm font-medium tracking-wide text-sky-300 uppercase'>
                    {mode === 'single' ? 'Single instance' : 'Multi instance'}
                </p>
                <div className='flex flex-wrap items-center gap-2'>
                    {isLoading ? (
                        <span
                            role='status'
                            className='inline-flex min-h-9 items-center rounded-md border border-neutral-700 px-3 text-sm font-semibold text-neutral-300'>
                            Loading settings
                        </span>
                    ) : null}
                    {mode === 'multi' ? (
                        <Link
                            to='/dashboard'
                            className='inline-flex min-h-9 items-center rounded-md border border-neutral-700 px-3 text-sm font-semibold text-neutral-100 transition hover:border-sky-400 hover:text-sky-200 focus:ring-2 focus:ring-sky-300 focus:ring-offset-2 focus:ring-offset-neutral-950 focus:outline-none'>
                            Choose server
                        </Link>
                    ) : null}
                </div>
            </div>
            <div className='flex min-w-0 items-center gap-4'>
                <DashboardGuildAvatar guild={guild} />
                <div className='min-w-0'>
                    <h1 className='truncate text-3xl font-semibold text-white'>{guild.name}</h1>
                    <p className='mt-2 text-sm text-neutral-400'>Server ID: {guild.id}</p>
                </div>
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
                className='size-14 shrink-0 rounded-xl bg-neutral-800 object-cover'
                loading='lazy'
                referrerPolicy='no-referrer'
            />
        );
    }

    return (
        <span
            className='grid size-14 shrink-0 place-items-center rounded-xl bg-neutral-800 text-base font-semibold text-neutral-200'
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

function StatusCard({ title, body, isLoading = false }: { title: string; body: string; isLoading?: boolean }) {
    return (
        <article className='rounded-lg border border-neutral-800 bg-neutral-900 p-4' aria-busy={isLoading || undefined}>
            <h3 className='text-lg font-semibold text-white'>{title}</h3>
            <p className='mt-2 text-sm leading-6 text-neutral-400'>{body}</p>
            {isLoading ? <div className='mt-4 h-4 w-40 animate-pulse rounded bg-neutral-800' /> : null}
        </article>
    );
}

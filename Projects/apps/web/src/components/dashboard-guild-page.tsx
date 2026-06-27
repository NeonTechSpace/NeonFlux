import { Link, Outlet } from '@tanstack/react-router';
import { createContext, use } from 'react';
import type { ReactNode } from 'react';

import type { DashboardLiveArea } from '../dashboard-live.js';
import type { DashboardGuildPreview } from '../dashboard-guild-preview.js';
import { getDashboardCategory } from '../dashboard-categories.js';
import type { DashboardCategoryId } from '../dashboard-categories.js';
import type { DashboardGuildRouteData } from '../server/dashboard-guild-route-data.js';
import { DashboardAuditEventsPanel } from './dashboard-audit-events-panel.js';
import { DashboardCommandAccessPanel } from './dashboard-command-access-panel.js';
import { DashboardCategoryNavigation } from './dashboard-category-navigation.js';
import {
    DashboardCommandPrefixSettingsPanel,
    DashboardCommandPrefixSettingsPanelLoading,
} from './dashboard-command-prefix-panel.js';
import { DashboardInviteTrackingLoading, DashboardInviteTrackingPanel } from './dashboard-invite-tracking-panel.js';
import { useDashboardLiveInvalidation } from './dashboard-live-invalidation.js';
import { DashboardShell, DashboardStatusSection } from './dashboard-layout.js';
import { DashboardPostingPanel } from './dashboard-posting-panel.js';
import { DashboardServerOverviewLoading, DashboardServerOverviewPanel } from './dashboard-server-overview-panel.js';

const fluxerLoginPath = '/auth/fluxer/login';
const auditLiveArea = ['audit'] as const satisfies readonly DashboardLiveArea[];
const commandLiveArea = ['commands'] as const satisfies readonly DashboardLiveArea[];

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
    if (preview) {
        return (
            <DashboardShell>
                <DashboardGuildHeader mode={preview.mode} guild={preview} isLoading />
                <DashboardCategoryLayout guildId={guildId} activeCategoryId={activeCategoryId}>
                    <DashboardPendingCategory activeCategoryId={activeCategoryId} />
                </DashboardCategoryLayout>
            </DashboardShell>
        );
    }

    return (
        <DashboardShell>
            <header className='space-y-3 border-b border-neutral-800 pb-6'>
                <p className='text-sm font-medium tracking-wide text-sky-300 uppercase'>Loading server</p>
                <div className='min-w-0'>
                    <h1 className='truncate text-3xl font-semibold text-white'>Loading server...</h1>
                    <p className='mt-2 text-sm text-neutral-400'>Server ID: {guildId}</p>
                </div>
            </header>
            <DashboardCategoryLayout guildId={guildId} activeCategoryId={activeCategoryId}>
                <DashboardCategoryLoadingState />
            </DashboardCategoryLayout>
        </DashboardShell>
    );
}

export function useDashboardGuildData(): AuthorizedDashboardGuildRouteData {
    const data = use(DashboardGuildDataContext);

    if (!data) {
        throw new Error('Dashboard guild category rendered outside the guild dashboard context.');
    }

    return data;
}

export function DashboardGuildOverviewCategory() {
    const data = useDashboardGuildData();

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

    return (
        <DashboardCategorySection categoryId='messaging'>
            <DashboardPostingPanel guildId={data.guild.id} />
        </DashboardCategorySection>
    );
}

export function DashboardGuildInviteTrackingCategory() {
    const data = useDashboardGuildData();

    return (
        <DashboardCategorySection categoryId='invites'>
            <DashboardInviteTrackingPanel guildId={data.guild.id} />
        </DashboardCategorySection>
    );
}

export function DashboardGuildAccessCategory() {
    const data = useDashboardGuildData();

    return (
        <DashboardCategorySection categoryId='access'>
            <DashboardCommandAccessPanel guildId={data.guild.id} />
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

export function DashboardGuildPlannedCategory({ categoryId }: { categoryId: DashboardCategoryId }) {
    return (
        <DashboardCategorySection categoryId={categoryId}>
            <DashboardPlannedCategoryNotice categoryId={categoryId} />
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

function DashboardPlannedCategoryNotice({ categoryId }: { categoryId: DashboardCategoryId }) {
    const category = getDashboardCategory(categoryId);

    return (
        <article className='rounded-lg border border-neutral-800 bg-neutral-900 p-4'>
            <h3 className='text-lg font-semibold text-white'>{category.label} is not built yet</h3>
            <p className='mt-2 text-sm leading-6 text-neutral-400'>
                This category is reserved so the dashboard can grow without crowding current tools.
            </p>
        </article>
    );
}

function DashboardCategoryLoadingState() {
    return (
        <section className='space-y-4' aria-label='Loading dashboard category'>
            <DashboardCommandPrefixSettingsPanelLoading />
            <StatusCard title='Dashboard category' body='Loading server settings for this section.' isLoading />
        </section>
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

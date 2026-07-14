import { Outlet, useNavigate, useRouterState } from '@tanstack/react-router';
import { createContext, use, useEffect } from 'react';
import type { ReactNode } from 'react';

import type { DashboardLiveArea } from '../dashboard-live.js';
import type { DashboardGuildPreview } from '../dashboard-guild-preview.js';
import { dashboardStructureIdentity, dashboardStructureNavigationItems } from '../dashboard-structure-navigation.js';
import {
    getDashboardCategory,
    getDashboardCategoryIdFromPathname,
    getDashboardCategorySubNavigation,
    getDashboardNavigationJob,
} from '../dashboard-categories.js';
import type { DashboardCategoryId } from '../dashboard-categories.js';
import type { DashboardGuildShellGuild } from '../server/dashboard-guild-page.server.js';
import type { DashboardGuildCatalog } from '../server/dashboard-guild-catalog-route-data.js';
import type {
    DashboardCommandSettingsReadResult,
    DashboardGuildRouteData,
} from '../server/dashboard-guild-route-data.js';
import { DashboardCategoryNavigation } from './dashboard-category-navigation.js';
import { DashboardAuditEventsPanel } from './dashboard-audit-events-panel.js';
import { DashboardCommandPrefixRouteContent } from './dashboard-command-prefix-route-content.js';
import { DashboardGuildUnavailablePage } from './dashboard-guild-unavailable-page.js';
import { useDashboardGuildCatalog } from './dashboard-guild-catalog.js';
import { getDashboardGuildSwitchPath } from './dashboard-guild-selector.js';
import { useDashboardLiveInvalidation } from './dashboard-live-invalidation.js';
import { DashboardShell, DashboardStatusSection } from './dashboard-layout.js';
import { DashboardPostingPanel } from './dashboard-posting-panel.js';
import { DashboardServerOverviewPanel } from './dashboard-server-overview-panel.js';
import { DashboardStructureNavigation } from './dashboard-structure-workspace-shell.js';
import { DashboardFeaturePage } from './dashboard-ui.js';
import { getDashboardWorkbenchWidth } from './dashboard-workbench.js';

const fluxerLoginPath = '/auth/fluxer/login';
const commandLiveArea = ['commands'] as const satisfies readonly DashboardLiveArea[];
const overviewLiveArea = ['overview'] as const satisfies readonly DashboardLiveArea[];
const messagingLiveArea = ['posting'] as const satisfies readonly DashboardLiveArea[];
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
            return <DashboardGuildUnavailablePage data={data} />;
    }
}

export function DashboardGuildPendingPage({
    guildId,
    preview,
    sourcePreview,
    cachedCatalog,
    pathname,
    activeCategoryId = 'overview',
}: {
    guildId: string;
    preview?: DashboardGuildPreview;
    sourcePreview?: DashboardGuildPreview;
    cachedCatalog?: DashboardGuildCatalog;
    pathname?: string;
    activeCategoryId?: DashboardCategoryId;
}) {
    const cachedGuild = cachedCatalog?.guilds.find((guild) => guild.id === guildId);
    const cachedPreview =
        cachedCatalog && cachedGuild
            ? {
                  id: cachedGuild.id,
                  name: cachedGuild.name,
                  ...(cachedGuild.iconUrl ? { iconUrl: cachedGuild.iconUrl } : {}),
                  mode: cachedCatalog.mode,
              }
            : undefined;
    const resolvedPreview = preview ?? cachedPreview;

    if (!resolvedPreview) {
        return <DashboardGuildColdLoadingShell activeCategoryId={activeCategoryId} pathname={pathname} />;
    }

    const currentPreview = sourcePreview ?? resolvedPreview;
    const sourcePathname =
        sourcePreview && pathname ? getDashboardGuildSwitchPath(guildId, sourcePreview.id, pathname) : undefined;
    const pendingGuilds = mergePendingGuilds(cachedCatalog?.guilds ?? [], currentPreview, resolvedPreview);

    return (
        <DashboardGuildFrame
            guild={currentPreview}
            manageableGuilds={pendingGuilds}
            guildId={sourcePreview?.id ?? guildId}
            activeCategoryId={activeCategoryId}
            mode={sourcePreview ? 'multi' : resolvedPreview.mode}
            pendingGuildId={sourcePreview ? resolvedPreview.id : undefined}
            pathnameOverride={sourcePathname}
            isLoading>
            <DashboardPendingCategory
                activeCategoryId={activeCategoryId}
                pathname={pathname}
                guildId={sourcePreview?.id ?? resolvedPreview.id}
            />
        </DashboardGuildFrame>
    );
}

function mergePendingGuilds(
    cachedGuilds: DashboardGuildShellGuild[],
    currentGuild: DashboardGuildPreview,
    targetGuild: DashboardGuildPreview
): DashboardGuildShellGuild[] {
    const guildsById = new Map(cachedGuilds.map((guild) => [guild.id, guild]));

    guildsById.set(currentGuild.id, currentGuild);
    guildsById.set(targetGuild.id, targetGuild);

    return [...guildsById.values()];
}

function DashboardGuildColdLoadingShell({
    activeCategoryId,
    pathname,
}: {
    activeCategoryId: DashboardCategoryId;
    pathname?: string;
}) {
    return (
        <DashboardShell>
            <div className='flex h-full min-h-0 min-w-0 flex-col gap-3 overflow-hidden md:flex-row md:gap-4'>
                <header
                    className='flex min-h-14 shrink-0 items-center gap-3 rounded-[var(--dash-radius-panel)] border border-[var(--dash-border)] bg-[rgba(8,13,21,0.92)] p-2 md:hidden'
                    aria-label='Dashboard navigation pending'>
                    <div className='grid size-9 shrink-0 place-items-center rounded-full border border-[var(--dash-border)] bg-[var(--dash-surface-raised)] text-xs font-semibold text-[var(--dash-text-muted)]'>
                        NF
                    </div>
                    <div className='min-w-0 flex-1'>
                        <p className='truncate text-sm font-semibold text-[var(--dash-text)]'>Server dashboard</p>
                        <p className='truncate text-xs text-[var(--dash-text-muted)]'>Checking access…</p>
                    </div>
                </header>
                <aside
                    className='hidden h-full min-h-0 w-[4.5rem] shrink-0 flex-col rounded-[var(--dash-radius-panel)] border border-[var(--dash-border)] bg-[rgba(7,11,18,0.9)] p-2 md:flex lg:w-64 lg:p-3'
                    aria-label='Dashboard navigation pending'>
                    <div className='flex min-h-12 items-center justify-center gap-3 border-b border-[var(--dash-border)] pb-3 lg:justify-start'>
                        <div className='grid size-9 shrink-0 place-items-center rounded-full border border-[var(--dash-border)] bg-[var(--dash-surface-raised)] text-xs font-semibold text-[var(--dash-text-muted)]'>
                            NF
                        </div>
                        <div className='hidden min-w-0 lg:block'>
                            <p className='truncate text-sm font-semibold text-[var(--dash-text)]'>Server dashboard</p>
                            <p className='truncate text-xs text-[var(--dash-text-muted)]'>Checking access…</p>
                        </div>
                    </div>
                    <div className='flex min-h-0 flex-1 items-center justify-center py-4 lg:items-start lg:justify-start'>
                        <p className='text-center text-xs leading-5 text-[var(--dash-text-muted)] lg:text-left'>
                            <span className='hidden lg:inline'>Loading authorized navigation…</span>
                            <span className='lg:hidden'>Loading…</span>
                        </p>
                    </div>
                </aside>
                <div className='min-h-0 min-w-0 flex-1 overflow-y-auto px-0.5 pb-8 md:pr-2'>
                    <DashboardPendingCategory activeCategoryId={activeCategoryId} pathname={pathname} />
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

    const category = getDashboardCategory('overview');
    const FeatureIcon = category.icon;

    return (
        <DashboardFeaturePage
            title='Server pulse'
            description='Growth and message activity across this server.'
            eyebrow={getDashboardNavigationJob('overview').label}
            icon={<FeatureIcon className='size-5' aria-hidden='true' />}
            titleId='dashboard-overview-heading'
            width='wide'>
            <DashboardServerOverviewPanel guildId={data.guild.id} />
        </DashboardFeaturePage>
    );
}

export function DashboardGuildCommandPrefixCategory({
    commandSettingsResult,
}: {
    commandSettingsResult: DashboardCommandSettingsReadResult;
}) {
    const data = useDashboardGuildData();

    useDashboardLiveInvalidation({
        guildId: data.guild.id,
        areas: commandLiveArea,
    });

    return <DashboardCommandPrefixRouteContent guildId={data.guild.id} commandSettingsResult={commandSettingsResult} />;
}

export function DashboardGuildMessageBuilderCategory() {
    const data = useDashboardGuildData();

    useDashboardLiveInvalidation({
        guildId: data.guild.id,
        areas: messagingLiveArea,
    });

    return <DashboardPostingPanel guildId={data.guild.id} />;
}

export function DashboardGuildAuditEventsCategory() {
    const data = useDashboardGuildData();

    useDashboardLiveInvalidation({
        guildId: data.guild.id,
        areas: auditLiveArea,
    });

    return <DashboardAuditEventsPanel guildId={data.guild.id} />;
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
    const navigate = useNavigate();
    const pendingPathname = useRouterState({
        select: (state) =>
            state.isLoading && state.location.pathname !== state.resolvedLocation?.pathname
                ? state.location.pathname
                : undefined,
    });
    const initialGuilds = data.manageableGuilds ?? [data.guild];
    const catalogQuery = useDashboardGuildCatalog({
        guilds: initialGuilds,
        mode: data.mode,
        ...(data.botInviteUrl ? { botInviteUrl: data.botInviteUrl } : {}),
    });
    const catalog = catalogQuery.data;
    const activeGuild = catalog?.guilds.find((guild) => guild.id === data.guild.id);
    const activeGuildAvailable = activeGuild !== undefined;

    useEffect(() => {
        if (!catalog || activeGuildAvailable) {
            return;
        }

        void navigate({ to: '/dashboard', replace: true });
    }, [activeGuildAvailable, catalog, navigate]);

    const displayGuild = activeGuild ?? data.guild;
    const displayGuilds = activeGuild && catalog ? catalog.guilds : initialGuilds;
    const guildPath = `/dashboard/${data.guild.id}`;
    const sameGuildPendingPathname =
        pendingPathname === guildPath || pendingPathname?.startsWith(`${guildPath}/`) ? pendingPathname : undefined;
    const pendingCategoryId = sameGuildPendingPathname
        ? getDashboardCategoryIdFromPathname(data.guild.id, sameGuildPendingPathname)
        : undefined;

    return (
        <DashboardGuildFrame
            guild={displayGuild}
            manageableGuilds={displayGuilds}
            guildId={data.guild.id}
            activeCategoryId={pendingCategoryId ?? activeCategoryId}
            mode={catalog?.mode ?? data.mode}
            botInviteUrl={catalog?.botInviteUrl ?? data.botInviteUrl}
            isLoading={Boolean(sameGuildPendingPathname)}>
            <DashboardGuildDataContext key={data.guild.id} value={data}>
                {pendingCategoryId ? (
                    <DashboardPendingCategory
                        activeCategoryId={pendingCategoryId}
                        pathname={sameGuildPendingPathname}
                        guildId={data.guild.id}
                    />
                ) : (
                    children
                )}
            </DashboardGuildDataContext>
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

function DashboardPendingCategory({
    activeCategoryId,
    pathname,
    guildId,
}: {
    activeCategoryId: DashboardCategoryId;
    pathname?: string;
    guildId?: string;
}) {
    const identity = getDashboardPendingIdentity(activeCategoryId, pathname);

    if (activeCategoryId === 'overview') {
        const category = getDashboardCategory('overview');
        const FeatureIcon = category.icon;

        return (
            <DashboardFeaturePage
                title={identity.title}
                description={identity.description}
                eyebrow={getDashboardNavigationJob('overview').label}
                icon={<FeatureIcon className='size-5' aria-hidden='true' />}
                titleId='dashboard-overview-heading'
                width='wide'>
                <span role='status' className='sr-only'>
                    Loading {identity.title}
                </span>
                <DashboardCategoryLoading categoryId={activeCategoryId} identity={identity} />
            </DashboardFeaturePage>
        );
    }

    if (activeCategoryId !== 'structure') {
        const category = getDashboardCategory(activeCategoryId);
        const featureId = identity.id.split(':').at(-1) ?? category.id;
        const activeItem = getDashboardCategorySubNavigation(activeCategoryId).find((item) => item.id === featureId);
        const FeatureIcon = activeItem?.icon ?? category.icon;
        const headingId = `dashboard-${featureId}-heading`;

        return (
            <DashboardFeaturePage
                title={identity.title}
                description={identity.description}
                eyebrow={activeItem ? getDashboardNavigationJob(activeItem.navigationJobId).label : undefined}
                icon={<FeatureIcon className='size-5' aria-hidden='true' />}
                titleId={headingId}
                width={getDashboardWorkbenchWidth(featureId)}>
                <span role='status' className='sr-only'>
                    Loading {identity.title}
                </span>
                <DashboardCategoryLoading categoryId={activeCategoryId} identity={identity} />
            </DashboardFeaturePage>
        );
    }

    const category = getDashboardCategory('structure');
    const FeatureIcon = category.icon;

    return (
        <DashboardFeaturePage
            title={dashboardStructureIdentity.title}
            description={dashboardStructureIdentity.description}
            eyebrow={dashboardStructureIdentity.eyebrow}
            icon={<FeatureIcon className='size-5' aria-hidden='true' />}
            titleId='server-blueprint-title'
            width='full'
            navigation={guildId ? <DashboardStructureNavigation guildId={guildId} /> : undefined}>
            <section aria-labelledby='dashboard-blueprint-pending-surface-heading'>
                <h2
                    id='dashboard-blueprint-pending-surface-heading'
                    className='text-lg font-semibold text-[var(--dash-text)]'>
                    {identity.title}
                </h2>
                <p className='mt-1 text-sm leading-6 text-[var(--dash-text-muted)]'>{identity.description}</p>
                <div className='mt-5'>
                    <span role='status' className='sr-only'>
                        Loading {identity.title}
                    </span>
                    <DashboardCategoryLoading categoryId={activeCategoryId} identity={identity} />
                </div>
            </section>
        </DashboardFeaturePage>
    );
}

function DashboardCategoryLoading({
    categoryId,
    identity,
}: {
    categoryId: DashboardCategoryId;
    identity: DashboardPendingIdentity;
}) {
    const compact = categoryId === 'general' || categoryId === 'structure' || categoryId === 'events';

    return (
        <div className={compact ? 'space-y-4' : 'grid gap-4 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]'}>
            <article
                className='dashboard-glass-panel flex min-h-44 items-start p-5'
                aria-label={`Loading ${identity.title} data`}>
                <div className='max-w-md'>
                    <p className='text-sm font-semibold text-[var(--dash-text)]'>Loading current server data</p>
                    <p className='mt-1 text-sm leading-6 text-[var(--dash-text-muted)]'>
                        This panel will be ready when the server confirms the latest state.
                    </p>
                    <div className='mt-5 h-1 w-32 overflow-hidden rounded-full bg-[var(--dash-surface-raised)]'>
                        <span
                            data-dashboard-loading='pulse'
                            className='block h-full w-1/2 animate-pulse rounded-full bg-[var(--dash-primary)] opacity-70'
                        />
                    </div>
                </div>
            </article>
            {!compact ? <article className='dashboard-glass-panel min-h-44 p-5' aria-hidden='true' /> : null}
        </div>
    );
}

type DashboardPendingIdentity = {
    id: string;
    title: string;
    description: string;
};

function getDashboardPendingIdentity(
    categoryId: DashboardCategoryId,
    pathname: string | undefined
): DashboardPendingIdentity {
    const pathSegment = pathname?.split('/').filter(Boolean).at(-1);
    const subfeature = getDashboardCategorySubNavigation(categoryId).find((item) => item.id === pathSegment);

    if (subfeature) {
        return {
            id: `${categoryId}:${subfeature.id}`,
            title: subfeature.label,
            description: subfeature.description,
        };
    }

    const structureItem =
        categoryId === 'structure'
            ? dashboardStructureNavigationItems.find((item) => item.id === pathSegment)
            : undefined;

    if (structureItem) {
        return {
            id: `structure:${structureItem.id}`,
            title: structureItem.title,
            description: structureItem.description,
        };
    }

    const category = getDashboardCategory(categoryId);
    return {
        id: category.id,
        title: category.id === 'overview' ? 'Server pulse' : category.label,
        description:
            category.id === 'overview' ? 'Growth and message activity across this server.' : category.description,
    };
}

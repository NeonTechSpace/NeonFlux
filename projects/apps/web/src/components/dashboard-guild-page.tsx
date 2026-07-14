import { Outlet, useNavigate, useRouterState } from '@tanstack/react-router';
import { useEffect } from 'react';
import type { ReactNode } from 'react';

import type { DashboardGuildPreview } from '../dashboard-guild-preview.js';
import { getDashboardCategoryIdFromPathname } from '../dashboard-categories.js';
import type { DashboardCategoryId } from '../dashboard-categories.js';
import type { DashboardGuildShellGuild } from '../server/dashboard-guild-page.server.js';
import type { DashboardGuildCatalog } from '../server/dashboard-guild-catalog-route-data.js';
import type { DashboardGuildRouteData } from '../server/dashboard-guild-route-data.js';
import { DashboardCategoryNavigation } from './dashboard-category-navigation.js';
import { DashboardGuildDataProvider } from './dashboard-guild-context.js';
import type { AuthorizedDashboardGuildRouteData } from './dashboard-guild-context.js';
import { DashboardCategoryRouteState } from './dashboard-guild-route-state.js';
import { DashboardGuildUnavailablePage } from './dashboard-guild-unavailable-page.js';
import { useDashboardGuildCatalog } from './dashboard-guild-catalog.js';
import { getDashboardGuildSwitchPath } from './dashboard-guild-selector.js';
import { DashboardShell, DashboardStatusSection } from './dashboard-layout.js';

const fluxerLoginPath = '/auth/fluxer/login';

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
    const frame = resolveDashboardGuildFrame({ cachedCatalog, guildId, preview, sourcePreview, pathname });

    if (!frame) {
        return <DashboardGuildColdShell activeCategoryId={activeCategoryId} pathname={pathname} state='pending' />;
    }

    return (
        <DashboardGuildFrame
            guild={frame.currentPreview}
            manageableGuilds={frame.guilds}
            guildId={frame.currentGuildId}
            activeCategoryId={activeCategoryId}
            mode={frame.mode}
            pendingGuildId={frame.pendingGuildId}
            pathnameOverride={frame.pathnameOverride}
            isLoading>
            <DashboardPendingCategory
                activeCategoryId={activeCategoryId}
                pathname={pathname}
                guildId={frame.currentGuildId}
            />
        </DashboardGuildFrame>
    );
}

export function DashboardGuildErrorPage({
    guildId,
    preview,
    sourcePreview,
    cachedCatalog,
    pathname,
    activeCategoryId = 'overview',
    onRetry,
}: {
    guildId: string;
    preview?: DashboardGuildPreview;
    sourcePreview?: DashboardGuildPreview;
    cachedCatalog?: DashboardGuildCatalog;
    pathname?: string;
    activeCategoryId?: DashboardCategoryId;
    onRetry: () => Promise<unknown> | void;
}) {
    const frame = resolveDashboardGuildFrame({ cachedCatalog, guildId, preview, sourcePreview, pathname });

    if (!frame) {
        return (
            <DashboardGuildColdShell
                activeCategoryId={activeCategoryId}
                pathname={pathname}
                state='error'
                onRetry={onRetry}
            />
        );
    }

    return (
        <DashboardGuildFrame
            guild={frame.currentPreview}
            manageableGuilds={frame.guilds}
            guildId={frame.currentGuildId}
            activeCategoryId={activeCategoryId}
            mode={frame.mode}
            pathnameOverride={frame.pathnameOverride}>
            <DashboardCategoryRouteState
                activeCategoryId={activeCategoryId}
                pathname={pathname}
                guildId={frame.currentGuildId}
                state='error'
                onRetry={onRetry}
            />
        </DashboardGuildFrame>
    );
}

function resolveDashboardGuildFrame({
    cachedCatalog,
    guildId,
    preview,
    sourcePreview,
    pathname,
}: {
    cachedCatalog?: DashboardGuildCatalog;
    guildId: string;
    preview?: DashboardGuildPreview;
    sourcePreview?: DashboardGuildPreview;
    pathname?: string;
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

    if (!resolvedPreview) return undefined;

    const currentPreview = sourcePreview ?? resolvedPreview;
    return {
        currentPreview,
        currentGuildId: sourcePreview?.id ?? guildId,
        guilds: mergePendingGuilds(cachedCatalog?.guilds ?? [], currentPreview, resolvedPreview),
        mode: sourcePreview ? ('multi' as const) : resolvedPreview.mode,
        pendingGuildId: sourcePreview ? resolvedPreview.id : undefined,
        pathnameOverride:
            sourcePreview && pathname ? getDashboardGuildSwitchPath(guildId, sourcePreview.id, pathname) : undefined,
    };
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

function DashboardGuildColdShell({
    activeCategoryId,
    pathname,
    state,
    onRetry,
}: {
    activeCategoryId: DashboardCategoryId;
    pathname?: string;
    state: 'error' | 'pending';
    onRetry?: () => Promise<unknown> | void;
}) {
    const isPending = state === 'pending';

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
                        <p className='truncate text-xs text-[var(--dash-text-muted)]'>
                            {isPending ? 'Checking access…' : 'Access check failed'}
                        </p>
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
                            <p className='truncate text-xs text-[var(--dash-text-muted)]'>
                                {isPending ? 'Checking access…' : 'Access check failed'}
                            </p>
                        </div>
                    </div>
                    <div className='flex min-h-0 flex-1 items-center justify-center py-4 lg:items-start lg:justify-start'>
                        <p className='text-center text-xs leading-5 text-[var(--dash-text-muted)] lg:text-left'>
                            <span className='hidden lg:inline'>
                                {isPending ? 'Loading authorized navigation…' : 'Authorized navigation unavailable'}
                            </span>
                            <span className='lg:hidden'>{isPending ? 'Loading…' : 'Unavailable'}</span>
                        </p>
                    </div>
                </aside>
                <div className='min-h-0 min-w-0 flex-1 overflow-y-auto px-0.5 pb-8 md:pr-2'>
                    <DashboardCategoryRouteState
                        activeCategoryId={activeCategoryId}
                        pathname={pathname}
                        state={state}
                        onRetry={onRetry}
                    />
                </div>
            </div>
        </DashboardShell>
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
    const preservesBlueprintRuntime = activeCategoryId === 'blueprint' && pendingCategoryId === 'blueprint';

    return (
        <DashboardGuildFrame
            guild={displayGuild}
            manageableGuilds={displayGuilds}
            guildId={data.guild.id}
            activeCategoryId={pendingCategoryId ?? activeCategoryId}
            mode={catalog?.mode ?? data.mode}
            botInviteUrl={catalog?.botInviteUrl ?? data.botInviteUrl}
            isLoading={Boolean(sameGuildPendingPathname)}>
            <DashboardGuildDataProvider data={data}>
                {pendingCategoryId && !preservesBlueprintRuntime ? (
                    <DashboardPendingCategory
                        activeCategoryId={pendingCategoryId}
                        pathname={sameGuildPendingPathname}
                        guildId={data.guild.id}
                    />
                ) : (
                    children
                )}
            </DashboardGuildDataProvider>
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
    return (
        <DashboardCategoryRouteState
            activeCategoryId={activeCategoryId}
            pathname={pathname}
            guildId={guildId}
            state='pending'
        />
    );
}

import { dashboardStructureIdentity, dashboardStructureNavigationItems } from '../dashboard-structure-navigation.js';
import {
    getDashboardCategory,
    getDashboardCategorySubNavigation,
    getDashboardNavigationJob,
} from '../dashboard-categories.js';
import type { DashboardCategoryId } from '../dashboard-categories.js';
import { DashboardRouteRetryButton } from './dashboard-route-retry-button.js';
import { DashboardStructureNavigation } from './dashboard-structure-workspace-shell.js';
import { DashboardErrorState, DashboardFeaturePage } from './dashboard-ui.js';
import { getDashboardWorkbenchWidth } from './dashboard-workbench.js';

export function DashboardCategoryRouteState({
    activeCategoryId,
    pathname,
    guildId,
    state,
    onRetry,
}: {
    activeCategoryId: DashboardCategoryId;
    pathname?: string;
    guildId?: string;
    state: 'error' | 'pending';
    onRetry?: () => Promise<unknown> | void;
}) {
    const identity = getDashboardPendingIdentity(activeCategoryId, pathname);
    const content = <DashboardCategoryAsyncState identity={identity} state={state} onRetry={onRetry} />;

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
                {content}
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
                {content}
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
                <div className='mt-5'>{content}</div>
            </section>
        </DashboardFeaturePage>
    );
}

function DashboardCategoryAsyncState({
    identity,
    state,
    onRetry,
}: {
    identity: DashboardPendingIdentity;
    state: 'error' | 'pending';
    onRetry?: () => Promise<unknown> | void;
}) {
    if (state === 'error') {
        return (
            <DashboardErrorState
                title={`${identity.title} could not open`}
                description='NeonFlux could not confirm this server route. Retrying does not change server settings.'
                action={
                    onRetry ? (
                        <DashboardRouteRetryButton label={`Retry ${identity.title}`} onRetry={onRetry} />
                    ) : undefined
                }
            />
        );
    }

    return <DashboardCategoryLoading identity={identity} />;
}

function DashboardCategoryLoading({ identity }: { identity: DashboardPendingIdentity }) {
    return (
        <div
            role='status'
            aria-label={`Loading ${identity.title}`}
            className='flex min-h-12 items-center gap-3 py-4 text-sm text-[var(--dash-text-muted)]'>
            <span
                data-dashboard-loading='pulse'
                className='size-2 shrink-0 animate-pulse rounded-full bg-[var(--dash-primary)]'
                aria-hidden='true'
            />
            Loading {identity.title}…
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

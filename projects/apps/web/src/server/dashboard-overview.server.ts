import '@tanstack/react-start/server-only';

import { loadGuildOverviewAggregate } from '@neonflux/db';

import { getWebDb } from './db.server.js';
import type { DashboardGuildPageDataResult } from './dashboard-guild-page.server.js';
import { loadDashboardGuildPageData } from './dashboard-guild-page.server.js';
import type { DashboardGuildOverviewResult } from './dashboard-overview-model.js';

type AuthorizedGuildPageData = Extract<DashboardGuildPageDataResult, { type: 'guild' }>;

type DashboardGuildPageErrorResult = Exclude<DashboardGuildOverviewResult, { type: 'overview' }>;

export async function loadDashboardGuildOverview(
    request: Request,
    guildId: string
): Promise<DashboardGuildOverviewResult> {
    const guildPageData = await loadDashboardGuildPageData(request, guildId);

    if (guildPageData.type !== 'guild') {
        return mapDashboardGuildPageError(guildPageData);
    }

    const aggregateResult = await loadGuildOverviewAggregate((await getWebDb()).db, {
        guildId: guildPageData.guild.id,
        days: 30,
    });

    if (aggregateResult.isErr()) {
        return { type: 'database-error' };
    }

    return {
        type: 'overview',
        overview: {
            ...(aggregateResult.value.oldestRetainedActivityAt
                ? { oldestRetainedActivityAt: aggregateResult.value.oldestRetainedActivityAt.toISOString() }
                : {}),
            activityPresence: aggregateResult.value.activityPresence,
            memberFlow: aggregateResult.value.memberFlow,
            messages: aggregateResult.value.messages,
            windowDays: aggregateResult.value.windowDays,
        },
    };
}

function mapDashboardGuildPageError(
    guildPageData: Exclude<DashboardGuildPageDataResult, AuthorizedGuildPageData>
): DashboardGuildPageErrorResult {
    switch (guildPageData.type) {
        case 'auth-required':
        case 'deployment-config-not-found':
        case 'database-error':
        case 'guild-lookup-failed':
            return { type: guildPageData.type };

        case 'not-found':
        case 'single-unauthorized':
            return { type: 'not-found' };
    }
}

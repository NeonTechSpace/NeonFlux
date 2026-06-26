import '@tanstack/react-start/server-only';

import { loadGuildOverviewAggregate } from '@neonflux/db';

import { getWebDatabaseClient } from './database.server.js';
import type { DashboardGuildPageDataResult } from './dashboard-guild-page.server.js';
import { loadDashboardGuildPageData } from './dashboard-guild-page.server.js';

export type DashboardGuildOverview = {
    trackingStartedAt?: string;
    memberFlow: {
        totalJoins: number;
        totalLeaves: number;
        netGrowth: number;
        graph: Array<{
            date: string;
            joins: number;
            leaves: number;
            netGrowth: number;
        }>;
    };
    invites: {
        activeInviteCount: number;
        totalInviteUses: number;
        attribution: {
            attributed: number;
            baselineMissing: number;
            ambiguous: number;
            unavailable: number;
            notApplicable: number;
        };
        topInviters: Array<{
            inviterUserId: string;
            attributedJoins: number;
            inviteCodes: Array<{
                code: string;
                uses: number;
                active: boolean;
            }>;
        }>;
    };
    messages: {
        totalMessages: number;
        topChannels: Array<{
            channelId: string;
            messageCount: number;
        }>;
    };
    dataHealth: {
        hasMemberFlow: boolean;
        hasInviteSnapshots: boolean;
        hasMessageActivity: boolean;
    };
};

export type DashboardGuildOverviewResult =
    | {
          type: 'overview';
          overview: DashboardGuildOverview;
      }
    | { type: 'auth-required' }
    | { type: 'not-found' }
    | { type: 'deployment-config-not-found' }
    | { type: 'database-error' }
    | { type: 'guild-lookup-failed' };

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

    const aggregateResult = await loadGuildOverviewAggregate(getWebDatabaseClient().db, {
        guildId: guildPageData.guild.id,
        days: 30,
    });

    if (aggregateResult.isErr()) {
        return { type: 'database-error' };
    }

    return {
        type: 'overview',
        overview: {
            ...(aggregateResult.value.trackingStartedAt
                ? { trackingStartedAt: aggregateResult.value.trackingStartedAt.toISOString() }
                : {}),
            memberFlow: aggregateResult.value.memberFlow,
            invites: {
                activeInviteCount: aggregateResult.value.invites.activeInviteCount,
                totalInviteUses: aggregateResult.value.invites.totalInviteUses,
                attribution: {
                    attributed: aggregateResult.value.invites.attribution.attributed,
                    baselineMissing: aggregateResult.value.invites.attribution['baseline-missing'],
                    ambiguous: aggregateResult.value.invites.attribution.ambiguous,
                    unavailable: aggregateResult.value.invites.attribution.unavailable,
                    notApplicable: aggregateResult.value.invites.attribution['not-applicable'],
                },
                topInviters: aggregateResult.value.invites.topInviters,
            },
            messages: aggregateResult.value.messages,
            dataHealth: aggregateResult.value.dataHealth,
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

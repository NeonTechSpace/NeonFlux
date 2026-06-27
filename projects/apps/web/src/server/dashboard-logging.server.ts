import '@tanstack/react-start/server-only';

import { SERVER_LOG_EVENT_GROUPS } from '@neonflux/core/server-event-logging';
import type { ServerLogEventGroup } from '@neonflux/core/server-event-logging';
import {
    deleteGuildLoggingDestination,
    listGuildLoggingDestinationsByGuildId,
    recordBotActionEvent,
    upsertGuildLoggingDestination,
} from '@neonflux/db';
import type { GuildLoggingDestinationRecord } from '@neonflux/db';
import { getFluxerCurrentUser } from '@neonflux/fluxer/users';

import { getWebDatabaseClient } from './database.server.js';
import type { DashboardGuildPageDataResult } from './dashboard-guild-page.server.js';
import { loadDashboardGuildPageData } from './dashboard-guild-page.server.js';
import { readAuthenticatedFluxerContext } from './fluxer-auth-context.server.js';

export type DashboardLoggingEventGroup = {
    id: ServerLogEventGroup;
    label: string;
    description: string;
};

export type DashboardLoggingDestination = {
    id: string;
    eventGroup: ServerLogEventGroup;
    channelId: string;
    enabled: boolean;
    updatedAt: string;
};

export type DashboardLoggingSettingsResult =
    | {
          type: 'settings';
          eventGroups: DashboardLoggingEventGroup[];
          destinations: DashboardLoggingDestination[];
      }
    | DashboardLoggingErrorResult;

export type DashboardLoggingDestinationUpdateInput = {
    guildId: string;
    eventGroup: string;
    channelId: string;
    enabled?: boolean;
};

export type DashboardLoggingDestinationUpdateResult =
    | {
          type: 'updated';
          destination: DashboardLoggingDestination;
      }
    | { type: 'invalid-input'; field: string }
    | DashboardLoggingErrorResult;

export type DashboardLoggingDestinationDeleteInput = {
    guildId: string;
    eventGroup: string;
};

export type DashboardLoggingDestinationDeleteResult =
    | {
          type: 'deleted';
          destination: DashboardLoggingDestination;
      }
    | { type: 'invalid-input'; field: string }
    | DashboardLoggingErrorResult;

type DashboardLoggingErrorResult =
    | { type: 'auth-required' }
    | { type: 'not-found' }
    | { type: 'deployment-config-not-found' }
    | { type: 'database-error' }
    | { type: 'guild-lookup-failed' };
type DashboardLoggingMutationErrorResult = { type: 'invalid-input'; field: string } | DashboardLoggingErrorResult;

type AuthorizedGuildPageData = Extract<DashboardGuildPageDataResult, { type: 'guild' }>;

const dashboardLoggingFeature = 'logging';

export async function loadDashboardLoggingSettings(
    request: Request,
    guildId: string
): Promise<DashboardLoggingSettingsResult> {
    const guildPageData = await loadDashboardGuildPageData(request, guildId);

    if (guildPageData.type !== 'guild') {
        return mapDashboardGuildPageError(guildPageData);
    }

    const destinationsResult = await listGuildLoggingDestinationsByGuildId(getWebDatabaseClient().db, {
        guildId: guildPageData.guild.id,
    });

    if (destinationsResult.isErr()) {
        return { type: 'database-error' };
    }

    return {
        type: 'settings',
        eventGroups: SERVER_LOG_EVENT_GROUPS.map((group) => ({
            id: group.id,
            label: group.label,
            description: group.description,
        })),
        destinations: destinationsResult.value.map(toDashboardLoggingDestination),
    };
}

export async function updateDashboardLoggingDestination(
    request: Request,
    input: DashboardLoggingDestinationUpdateInput
): Promise<DashboardLoggingDestinationUpdateResult> {
    const guildPageData = await loadDashboardGuildPageData(request, input.guildId);

    if (guildPageData.type !== 'guild') {
        return mapDashboardGuildPageError(guildPageData);
    }

    const actorResult = await resolveLoggingActor(request);

    if (actorResult.type !== 'actor') {
        return actorResult;
    }

    const database = getWebDatabaseClient();
    const destinationResult = await upsertGuildLoggingDestination(database.db, {
        guildId: guildPageData.guild.id,
        eventGroup: input.eventGroup,
        channelId: input.channelId,
        enabled: input.enabled ?? true,
    });

    if (destinationResult.isErr()) {
        return mapLoggingRepositoryError(destinationResult.error);
    }

    const auditResult = await recordBotActionEvent(database.db, {
        guildId: guildPageData.guild.id,
        feature: dashboardLoggingFeature,
        action: 'destination.updated',
        actorUserId: actorResult.actorUserId,
        targetId: destinationResult.value.eventGroup,
        metadata: {
            eventGroup: destinationResult.value.eventGroup,
            channelId: destinationResult.value.channelId,
            enabled: destinationResult.value.enabled,
            source: 'dashboard',
            ...actorResult.metadata,
        },
    });

    if (auditResult.isErr()) {
        return { type: 'database-error' };
    }

    return {
        type: 'updated',
        destination: toDashboardLoggingDestination(destinationResult.value),
    };
}

export async function deleteDashboardLoggingDestination(
    request: Request,
    input: DashboardLoggingDestinationDeleteInput
): Promise<DashboardLoggingDestinationDeleteResult> {
    const guildPageData = await loadDashboardGuildPageData(request, input.guildId);

    if (guildPageData.type !== 'guild') {
        return mapDashboardGuildPageError(guildPageData);
    }

    const actorResult = await resolveLoggingActor(request);

    if (actorResult.type !== 'actor') {
        return actorResult;
    }

    const database = getWebDatabaseClient();
    const destinationResult = await deleteGuildLoggingDestination(database.db, {
        guildId: guildPageData.guild.id,
        eventGroup: input.eventGroup,
    });

    if (destinationResult.isErr()) {
        return mapLoggingRepositoryError(destinationResult.error);
    }

    const auditResult = await recordBotActionEvent(database.db, {
        guildId: guildPageData.guild.id,
        feature: dashboardLoggingFeature,
        action: 'destination.deleted',
        actorUserId: actorResult.actorUserId,
        targetId: destinationResult.value.eventGroup,
        metadata: {
            eventGroup: destinationResult.value.eventGroup,
            channelId: destinationResult.value.channelId,
            source: 'dashboard',
            ...actorResult.metadata,
        },
    });

    if (auditResult.isErr()) {
        return { type: 'database-error' };
    }

    return {
        type: 'deleted',
        destination: toDashboardLoggingDestination(destinationResult.value),
    };
}

function toDashboardLoggingDestination(record: GuildLoggingDestinationRecord): DashboardLoggingDestination {
    return {
        id: record.id,
        eventGroup: record.eventGroup,
        channelId: record.channelId,
        enabled: record.enabled,
        updatedAt: record.updatedAt.toISOString(),
    };
}

function mapDashboardGuildPageError(
    guildPageData: Exclude<DashboardGuildPageDataResult, AuthorizedGuildPageData>
): DashboardLoggingErrorResult {
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

function mapLoggingRepositoryError(error: { type: string; field?: string }): DashboardLoggingMutationErrorResult {
    switch (error.type) {
        case 'missing-input':
        case 'invalid-value':
            return { type: 'invalid-input', field: error.field ?? 'unknown' };
        case 'not-found':
            return { type: 'not-found' };
        case 'database-error':
        default:
            return { type: 'database-error' };
    }
}

type LoggingActor =
    | {
          type: 'actor';
          actorUserId: string;
          metadata: Record<string, string>;
      }
    | { type: 'auth-required' }
    | { type: 'database-error' };

async function resolveLoggingActor(request: Request): Promise<LoggingActor> {
    const authContextResult = await readAuthenticatedFluxerContext(request);

    if (authContextResult.isErr()) {
        return authContextResult.error === 'database-error' ? { type: 'database-error' } : { type: 'auth-required' };
    }

    const currentUserResult = await getFluxerCurrentUser({
        accessToken: authContextResult.value.accessToken,
    });

    if (currentUserResult.isErr() || currentUserResult.value.id !== authContextResult.value.fluxerUserId) {
        return {
            type: 'actor',
            actorUserId: authContextResult.value.fluxerUserId,
            metadata: {},
        };
    }

    return {
        type: 'actor',
        actorUserId: authContextResult.value.fluxerUserId,
        metadata: {
            actorUsername: currentUserResult.value.username,
            ...(currentUserResult.value.globalName ? { actorDisplayName: currentUserResult.value.globalName } : {}),
        },
    };
}

import '@tanstack/react-start/server-only';

import { recordBotActionEvent } from '@neonflux/db';
import { getFluxerCurrentUser } from '@neonflux/fluxer/users';

import { getWebDatabaseClient } from './database.server.js';
import type { DashboardGuildPageDataResult } from './dashboard-guild-page.server.js';
import { loadDashboardGuildPageData } from './dashboard-guild-page.server.js';
import { readAuthenticatedFluxerContext } from './fluxer-auth-context.server.js';

export type DashboardStructureErrorResult =
    | { type: 'auth-required' }
    | { type: 'not-found' }
    | { type: 'deployment-config-not-found' }
    | { type: 'database-error' }
    | { type: 'guild-lookup-failed' };

export type AuthorizedStructureContext = {
    type: 'authorized';
    guild: Extract<DashboardGuildPageDataResult, { type: 'guild' }>['guild'];
    actor: {
        actorUserId: string;
        metadata: Record<string, string>;
    };
};

type StructureActor =
    | { type: 'actor'; actorUserId: string; metadata: Record<string, string> }
    | { type: 'auth-required' }
    | { type: 'database-error' };

const structureFeature = 'import_export';

export async function loadAuthorizedStructureContext(
    request: Request,
    guildId: string
): Promise<AuthorizedStructureContext | DashboardStructureErrorResult> {
    const guildPageData = await loadDashboardGuildPageData(request, guildId);

    if (guildPageData.type !== 'guild') return mapDashboardGuildPageError(guildPageData);

    const actor = await resolveStructureActor(request);

    if (actor.type !== 'actor') return actor;

    return {
        type: 'authorized',
        guild: guildPageData.guild,
        actor,
    };
}

export async function recordStructureAudit(
    context: AuthorizedStructureContext,
    action: string,
    targetId: string,
    metadata: Record<string, unknown>
): Promise<'recorded' | 'database-error'> {
    const result = await recordBotActionEvent(getWebDatabaseClient().db, {
        guildId: context.guild.id,
        feature: structureFeature,
        action,
        actorUserId: context.actor.actorUserId,
        targetId,
        metadata: {
            source: 'dashboard',
            ...metadata,
            ...context.actor.metadata,
        },
    });

    return result.isOk() ? 'recorded' : 'database-error';
}

async function resolveStructureActor(request: Request): Promise<StructureActor> {
    const authContextResult = await readAuthenticatedFluxerContext(request);

    if (authContextResult.isErr()) {
        return authContextResult.error === 'database-error' ? { type: 'database-error' } : { type: 'auth-required' };
    }

    const currentUserResult = await getFluxerCurrentUser({ accessToken: authContextResult.value.accessToken });

    if (currentUserResult.isErr() || currentUserResult.value.id !== authContextResult.value.fluxerUserId) {
        return { type: 'actor', actorUserId: authContextResult.value.fluxerUserId, metadata: {} };
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

function mapDashboardGuildPageError(
    guildPageData: Exclude<DashboardGuildPageDataResult, Extract<DashboardGuildPageDataResult, { type: 'guild' }>>
): DashboardStructureErrorResult {
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

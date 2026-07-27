import '@tanstack/react-start/server-only';

import { getFluxerCurrentUser } from '@neonflux/fluxer/users';

import type { DashboardGuildPageDataResult } from './dashboard-guild-page.server.js';
import { loadDashboardGuildPageDataForAuthenticatedContext } from './dashboard-guild-page.server.js';
import { readAuthenticatedFluxerContext } from './fluxer-auth-context.server.js';
import type { AuthenticatedFluxerContext } from './fluxer-auth-context.server.js';
import type { DashboardBlueprintErrorResult } from './dashboard-blueprint-model.js';

export type AuthorizedBlueprintContext = {
    type: 'authorized';
    guild: Extract<DashboardGuildPageDataResult, { type: 'guild' }>['guild'];
    actor: {
        actorUserId: string;
        metadata: Record<string, string>;
    };
};

type StructureActor = { type: 'actor'; actorUserId: string; metadata: Record<string, string> };

export async function loadAuthorizedBlueprintContext(
    request: Request,
    guildId: string
): Promise<AuthorizedBlueprintContext | DashboardBlueprintErrorResult> {
    const authContextResult = await readAuthenticatedFluxerContext(request);

    if (authContextResult.isErr()) {
        return authContextResult.error === 'database-error' ? { type: 'database-error' } : { type: 'auth-required' };
    }

    const guildPageData = await loadDashboardGuildPageDataForAuthenticatedContext(authContextResult.value, guildId);

    if (guildPageData.type !== 'guild') return mapDashboardGuildPageError(guildPageData);

    const actor = await resolveStructureActor(authContextResult.value);

    return {
        type: 'authorized',
        guild: guildPageData.guild,
        actor,
    };
}

export function createBlueprintAuditInput(
    context: AuthorizedBlueprintContext,
    action: string,
    targetId: string,
    metadata: Record<string, unknown>
) {
    return {
        action,
        actorUserId: context.actor.actorUserId,
        targetId,
        metadata: {
            source: 'dashboard',
            ...metadata,
            ...context.actor.metadata,
        },
    };
}

async function resolveStructureActor(authContext: AuthenticatedFluxerContext): Promise<StructureActor> {
    const currentUserResult = await getFluxerCurrentUser({ accessToken: authContext.accessToken });

    if (currentUserResult.isErr() || currentUserResult.value.id !== authContext.fluxerUserId) {
        return { type: 'actor', actorUserId: authContext.fluxerUserId, metadata: {} };
    }

    return {
        type: 'actor',
        actorUserId: authContext.fluxerUserId,
        metadata: {
            actorUsername: currentUserResult.value.username,
            ...(currentUserResult.value.globalName ? { actorDisplayName: currentUserResult.value.globalName } : {}),
        },
    };
}

function mapDashboardGuildPageError(
    guildPageData: Exclude<DashboardGuildPageDataResult, Extract<DashboardGuildPageDataResult, { type: 'guild' }>>
): DashboardBlueprintErrorResult {
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

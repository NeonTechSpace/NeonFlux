import '@tanstack/react-start/server-only';

import { recordBotActionEvent } from '@neonflux/db';
import { getFluxerCurrentUser } from '@neonflux/fluxer/users';

import type { DashboardGuildPageDataResult } from './dashboard-guild-page.server.js';
import { readAuthenticatedFluxerContext } from './fluxer-auth-context.server.js';

export type AuthorizedReactionRoleGuildPageData = Extract<DashboardGuildPageDataResult, { type: 'guild' }>;

export type ReactionRoleActor =
    | {
          type: 'actor';
          actorUserId: string;
          metadata: Record<string, string>;
      }
    | { type: 'auth-required' }
    | { type: 'database-error' };

export function mapDashboardGuildPageError(
    guildPageData: Exclude<DashboardGuildPageDataResult, AuthorizedReactionRoleGuildPageData>
) {
    switch (guildPageData.type) {
        case 'auth-required':
        case 'deployment-config-not-found':
        case 'database-error':
        case 'guild-lookup-failed':
            return { type: guildPageData.type };

        case 'not-found':
        case 'single-unauthorized':
            return { type: 'not-found' as const };
    }
}

export async function resolveReactionRoleActor(request: Request): Promise<ReactionRoleActor> {
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

export async function recordReactionRoleAuditEvent(
    db: Parameters<typeof recordBotActionEvent>[0],
    guildPageData: AuthorizedReactionRoleGuildPageData,
    actor: Extract<ReactionRoleActor, { type: 'actor' }>,
    input: {
        action: string;
        targetId: string;
        metadata: Record<string, string | number | boolean | null | undefined>;
    }
): Promise<'recorded' | 'database-error'> {
    const rawMetadata: Record<string, string | number | boolean | null | undefined> = {
        ...input.metadata,
        source: 'dashboard',
        ...actor.metadata,
    };
    const metadataEntries = Object.entries(rawMetadata).filter((entry) => entry[1] !== undefined) as Array<
        [string, string | number | boolean | null]
    >;
    const metadata = Object.fromEntries(metadataEntries);
    const result = await recordBotActionEvent(db, {
        guildId: guildPageData.guild.id,
        feature: 'reaction_roles',
        action: input.action,
        actorUserId: actor.actorUserId,
        targetId: input.targetId,
        metadata,
    });

    return result.isOk() ? 'recorded' : 'database-error';
}

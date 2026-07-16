import '@tanstack/react-start/server-only';

import type { AppMode } from '@neonflux/config';
import { loadWebConfig } from '@neonflux/config';
import type { DashboardGuild } from '@neonflux/core';
import { authorizeDashboardAccess } from '@neonflux/core/defcon';
import { readDashboardGuildAuthorizationFacts } from '@neonflux/db';
import { listFluxerCurrentUserGuilds } from '@neonflux/fluxer/guilds';
import { toDashboardGuild } from '@neonflux/fluxer/permissions';
import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import { getWebDb } from './db.server.js';
import type { AuthenticatedFluxerContext } from './fluxer-auth-context.server.js';

export type DashboardPostingTargetAuthorizationError =
    | 'not-found'
    | 'deployment-config-not-found'
    | 'database-error'
    | 'guild-lookup-failed';

export async function authorizeDashboardPostingTarget(
    authContext: AuthenticatedFluxerContext,
    guildId: string
): Promise<Result<{ guild: DashboardGuild; mode: AppMode }, DashboardPostingTargetAuthorizationError>> {
    const normalizedGuildId = guildId.trim();

    if (!normalizedGuildId) {
        return err('not-found');
    }

    const authorizationFactsPromise = loadDashboardGuildAuthorizationFacts(normalizedGuildId);
    const guildsPromise = loadPostingTargetFluxerGuilds(authContext.accessToken);
    const [authorizationFactsResult, guildsResult] = await Promise.all([authorizationFactsPromise, guildsPromise]);

    if (authorizationFactsResult.isErr()) {
        return err('database-error');
    }

    const authorizationFacts = authorizationFactsResult.value;

    if (!authorizationFacts.deployment) {
        return err('deployment-config-not-found');
    }

    if (guildsResult.isErr()) {
        return err('guild-lookup-failed');
    }

    const providerGuild = guildsResult.value.find((guild) => guild.id === normalizedGuildId);
    if (!providerGuild) return err('not-found');

    const guild = toDashboardGuild(providerGuild);
    const mode: AppMode = authorizationFacts.deployment;

    if (mode.instanceMode === 'single' && mode.singleGuildId !== normalizedGuildId) {
        return err('not-found');
    }

    if (mode.instanceMode === 'multi' && !authorizationFacts.botInstalled) {
        return err('not-found');
    }

    const config = loadWebConfig();
    const authorization = authorizeDashboardAccess({
        actor: {
            userId: authContext.fluxerUserId,
            isServerOwner: guild.ownerId === authContext.fluxerUserId,
            hasManageServer: guild.canManage,
        },
        appEnv: config.appEnv,
        override: config.guildDefconOverride,
        ...(authorizationFacts.storedDefconLevel === null ? {} : { storedLevel: authorizationFacts.storedDefconLevel }),
    });

    if (!authorization.allowed) {
        return err('not-found');
    }

    return ok({
        guild: mode.instanceMode === 'multi' ? { ...guild, botInstalled: true } : guild,
        mode,
    });
}

async function loadDashboardGuildAuthorizationFacts(guildId: string) {
    try {
        const database = await getWebDb();
        return await readDashboardGuildAuthorizationFacts(database.db, { guildId });
    } catch {
        return err<'database-error'>('database-error');
    }
}

async function loadPostingTargetFluxerGuilds(accessToken: string) {
    try {
        return await listFluxerCurrentUserGuilds({
            accessToken,
            limit: 200,
        });
    } catch {
        return err({ type: 'invalid-response' } as const);
    }
}

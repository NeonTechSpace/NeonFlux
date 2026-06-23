import '@tanstack/react-start/server-only';

import type { AppMode } from '@neonflux/config';
import { loadConfig } from '@neonflux/config';
import { authorizeDashboardAccess } from '@neonflux/core/defcon';
import type { DashboardGuild } from '@neonflux/core';
import {
    findDeploymentConfig,
    listGuildDashboardPermissionRulesByGuildIds,
    listGuildSecurityPoliciesByGuildIds,
    listBotInstallationGuildIds,
} from '@neonflux/db';
import type { DeploymentConfigRecord, DeploymentConfigRepositoryError } from '@neonflux/db';
import { listFluxerCurrentUserGuilds } from '@neonflux/fluxer/guilds';
import { toDashboardGuild } from '@neonflux/fluxer/permissions';
import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import { getWebDatabaseClient } from './database.server.js';
import { readAuthenticatedFluxerContext } from './fluxer-auth-context.server.js';
import type { AuthenticatedFluxerContextError } from './fluxer-auth-context.server.js';

export type DashboardGuildAccess =
    | { type: 'authorized'; mode: AppMode; guilds: DashboardGuild[] }
    | {
          type: 'unauthorized';
          mode: Extract<AppMode, { instanceMode: 'single' }>;
          configuredGuildId: string;
          configuredGuildName?: string;
      }
    | { type: 'no-manageable-guilds'; mode: Extract<AppMode, { instanceMode: 'multi' }> };

export type DashboardGuildAccessError =
    | AuthenticatedFluxerContextError
    | 'deployment-config-not-found'
    | 'guild-lookup-failed'
    | 'database-error';

export async function loadDashboardGuildAccess(
    request: Request
): Promise<Result<DashboardGuildAccess, DashboardGuildAccessError>> {
    const authContextResult = await readAuthenticatedFluxerContext(request);

    if (authContextResult.isErr()) {
        return err(authContextResult.error);
    }

    const database = getWebDatabaseClient();
    const modeResult = await findDeploymentConfig(database.db);

    if (modeResult.isErr()) {
        return err(mapDeploymentConfigError(modeResult.error));
    }

    const mode = toAppMode(modeResult.value);
    const config = loadConfig();
    const guildsResult = await listFluxerCurrentUserGuilds({
        accessToken: authContextResult.value.accessToken,
        limit: 200,
    });

    if (guildsResult.isErr()) {
        return err('guild-lookup-failed');
    }

    const guilds = guildsResult.value.map(toDashboardGuild);

    switch (mode.instanceMode) {
        case 'single':
            return await selectSingleDashboardGuildAccess({
                mode,
                guilds,
                fluxerUserId: authContextResult.value.fluxerUserId,
                appEnv: config.appEnv,
                guildDefconOverride: config.guildDefconOverride,
            });

        case 'multi':
            return selectMultiDashboardGuildAccess({
                mode,
                guilds,
                fluxerUserId: authContextResult.value.fluxerUserId,
                appEnv: config.appEnv,
                guildDefconOverride: config.guildDefconOverride,
            });
    }
}

type DashboardSelectionContext = {
    guilds: DashboardGuild[];
    fluxerUserId: string;
    appEnv: ReturnType<typeof loadConfig>['appEnv'];
    guildDefconOverride: ReturnType<typeof loadConfig>['guildDefconOverride'];
};

async function selectSingleDashboardGuildAccess(
    context: DashboardSelectionContext & { mode: Extract<AppMode, { instanceMode: 'single' }> }
): Promise<Result<DashboardGuildAccess, DashboardGuildAccessError>> {
    const configuredGuild = context.guilds.find((guild) => guild.id === context.mode.singleGuildId);
    const authorizedGuilds = configuredGuild ? await authorizeDashboardGuilds(context, [configuredGuild]) : ok([]);

    if (authorizedGuilds.isErr()) {
        return err(authorizedGuilds.error);
    }

    if (authorizedGuilds.value.length > 0) {
        return ok({
            type: 'authorized',
            mode: context.mode,
            guilds: authorizedGuilds.value,
        });
    }

    return ok({
        type: 'unauthorized',
        mode: context.mode,
        configuredGuildId: context.mode.singleGuildId,
        ...(configuredGuild?.name ? { configuredGuildName: configuredGuild.name } : {}),
    });
}

async function selectMultiDashboardGuildAccess(
    context: DashboardSelectionContext & { mode: Extract<AppMode, { instanceMode: 'multi' }> }
): Promise<Result<DashboardGuildAccess, DashboardGuildAccessError>> {
    const database = getWebDatabaseClient();
    const installedGuildIdsResult = await listBotInstallationGuildIds(database.db);

    if (installedGuildIdsResult.isErr()) {
        return err('database-error');
    }

    const installedGuildIds = new Set(installedGuildIdsResult.value);
    const installedGuilds = context.guilds
        .filter((guild) => installedGuildIds.has(guild.id))
        .map((guild) => ({
            ...guild,
            botInstalled: true,
        }));
    const authorizedGuilds = await authorizeDashboardGuilds(context, installedGuilds);

    if (authorizedGuilds.isErr()) {
        return err(authorizedGuilds.error);
    }

    if (authorizedGuilds.value.length === 0) {
        return ok({
            type: 'no-manageable-guilds',
            mode: context.mode,
        });
    }

    return ok({
        type: 'authorized',
        mode: context.mode,
        guilds: authorizedGuilds.value,
    });
}

async function authorizeDashboardGuilds(
    context: DashboardSelectionContext,
    guilds: readonly DashboardGuild[]
): Promise<Result<DashboardGuild[], 'database-error'>> {
    const policyContextResult = await loadDashboardPolicyContext(guilds);

    if (policyContextResult.isErr()) {
        return err(policyContextResult.error);
    }

    const authorizedGuilds: DashboardGuild[] = [];

    for (const guild of guilds) {
        if (authorizeDashboardGuild(context, policyContextResult.value, guild)) {
            authorizedGuilds.push(guild);
        }
    }

    return ok(authorizedGuilds);
}

type DashboardPolicyContext = {
    securityPoliciesByGuildId: ReadonlyMap<string, { defconLevel: 1 | 2 | 3 }>;
    dashboardGrantsByGuildId: ReadonlyMap<string, { userIds: string[]; roleIds: string[] }>;
};

async function loadDashboardPolicyContext(
    guilds: readonly DashboardGuild[]
): Promise<Result<DashboardPolicyContext, 'database-error'>> {
    const database = getWebDatabaseClient();
    const guildIds = guilds.map((guild) => guild.id);
    const [securityPoliciesResult, dashboardGrantsResult] = await Promise.all([
        listGuildSecurityPoliciesByGuildIds(database.db, { guildIds }),
        listGuildDashboardPermissionRulesByGuildIds(database.db, { guildIds }),
    ]);

    if (securityPoliciesResult.isErr() || dashboardGrantsResult.isErr()) {
        return err('database-error');
    }

    return ok({
        securityPoliciesByGuildId: new Map(
            securityPoliciesResult.value.map((policy) => [policy.guildId, { defconLevel: policy.defconLevel }])
        ),
        dashboardGrantsByGuildId: new Map(
            dashboardGrantsResult.value.map((grant) => [
                grant.guildId,
                {
                    userIds: grant.userIds,
                    roleIds: grant.roleIds,
                },
            ])
        ),
    });
}

function authorizeDashboardGuild(
    context: DashboardSelectionContext,
    policyContext: DashboardPolicyContext,
    guild: DashboardGuild
): boolean {
    const securityPolicy = policyContext.securityPoliciesByGuildId.get(guild.id);
    const dashboardGrant = policyContext.dashboardGrantsByGuildId.get(guild.id);
    const authorization = authorizeDashboardAccess({
        appEnv: context.appEnv,
        override: context.guildDefconOverride,
        ...(securityPolicy ? { storedLevel: securityPolicy.defconLevel } : {}),
        actor: {
            userId: context.fluxerUserId,
            isServerOwner: guild.ownerId === context.fluxerUserId,
            hasManageServer: guild.canManage,
        },
        ...(dashboardGrant ? { dashboardGrant } : {}),
    });

    return authorization.allowed;
}

function toAppMode(config: DeploymentConfigRecord): AppMode {
    switch (config.instanceMode) {
        case 'single':
            return {
                instanceMode: 'single',
                singleGuildId: config.singleGuildId,
            };

        case 'multi':
            return {
                instanceMode: 'multi',
            };
    }
}

function mapDeploymentConfigError(
    errorValue: DeploymentConfigRepositoryError
): 'deployment-config-not-found' | 'database-error' {
    switch (errorValue) {
        case 'not-found':
            return 'deployment-config-not-found';

        case 'database-error':
        case 'invalid-instance-mode':
        case 'missing-instance-mode':
        case 'missing-single-guild-id':
            return 'database-error';
    }
}

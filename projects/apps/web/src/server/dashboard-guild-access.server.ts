import '@tanstack/react-start/server-only';

import type { AppMode } from '@neonflux/config';
import { selectDashboardGuilds } from '@neonflux/core';
import type { DashboardGuild } from '@neonflux/core';
import { findDeploymentConfig, listBotInstallationGuildIds } from '@neonflux/db';
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
    const guildsResult = await listFluxerCurrentUserGuilds({
        accessToken: authContextResult.value.accessToken,
        limit: 200,
    });

    if (guildsResult.isErr()) {
        return err('guild-lookup-failed');
    }

    switch (mode.instanceMode) {
        case 'single':
            return ok(selectSingleDashboardGuildAccess(mode, guildsResult.value.map(toDashboardGuild)));

        case 'multi':
            return selectMultiDashboardGuildAccess(mode, guildsResult.value.map(toDashboardGuild));
    }
}

function selectSingleDashboardGuildAccess(
    mode: Extract<AppMode, { instanceMode: 'single' }>,
    guilds: DashboardGuild[]
): DashboardGuildAccess {
    const selectedGuilds = selectDashboardGuilds(mode, guilds);

    if (selectedGuilds.length > 0) {
        return {
            type: 'authorized',
            mode,
            guilds: selectedGuilds,
        };
    }

    const configuredGuild = guilds.find((guild) => guild.id === mode.singleGuildId);

    return {
        type: 'unauthorized',
        mode,
        configuredGuildId: mode.singleGuildId,
        ...(configuredGuild?.name ? { configuredGuildName: configuredGuild.name } : {}),
    };
}

async function selectMultiDashboardGuildAccess(
    mode: Extract<AppMode, { instanceMode: 'multi' }>,
    guilds: DashboardGuild[]
): Promise<Result<DashboardGuildAccess, DashboardGuildAccessError>> {
    const database = getWebDatabaseClient();
    const installedGuildIdsResult = await listBotInstallationGuildIds(database.db);

    if (installedGuildIdsResult.isErr()) {
        return err('database-error');
    }

    const installedGuildIds = new Set(installedGuildIdsResult.value);
    const guildsWithInstallation = guilds.map((guild) => ({
        ...guild,
        botInstalled: installedGuildIds.has(guild.id),
    }));
    const selectedGuilds = selectDashboardGuilds(mode, guildsWithInstallation);

    if (selectedGuilds.length === 0) {
        return ok({
            type: 'no-manageable-guilds',
            mode,
        });
    }

    return ok({
        type: 'authorized',
        mode,
        guilds: selectedGuilds,
    });
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

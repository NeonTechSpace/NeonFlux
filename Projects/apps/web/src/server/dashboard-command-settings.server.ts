import '@tanstack/react-start/server-only';

import { COMMAND_PREFIX_INVALID_MESSAGE } from '@neonflux/core/command-prefix';
import { findGuildCommandSettingsByGuildId, recordBotActionEvent, upsertGuildCommandPrefix } from '@neonflux/db';
import type { GuildCommandSettingsRepositoryError } from '@neonflux/db';
import { getFluxerCurrentUser } from '@neonflux/fluxer/users';

import { getWebDatabaseClient } from './database.server.js';
import { loadDashboardGuildPageData } from './dashboard-guild-page.server.js';
import type { DashboardGuildPageDataResult } from './dashboard-guild-page.server.js';
import { readAuthenticatedFluxerContext } from './fluxer-auth-context.server.js';

const DEFAULT_DASHBOARD_COMMAND_PREFIX = '!';

export type DashboardCommandSettings = {
    prefix: string;
    isDefaultPrefix: boolean;
};

export type DashboardCommandSettingsPageDataResult =
    | (Extract<DashboardGuildPageDataResult, { type: 'guild' }> & {
          commandSettings: DashboardCommandSettings;
      })
    | Exclude<DashboardGuildPageDataResult, { type: 'guild' }>;

export type DashboardCommandPrefixUpdateResult =
    | {
          type: 'updated';
          commandSettings: DashboardCommandSettings;
      }
    | {
          type: 'invalid-prefix';
          message: string;
      }
    | { type: 'auth-required' }
    | { type: 'not-found' }
    | { type: 'deployment-config-not-found' }
    | { type: 'database-error' }
    | { type: 'guild-lookup-failed' };

export type DashboardCommandPrefixUpdateInput = {
    guildId: string;
    prefix: string;
};

const invalidPrefixMessage = COMMAND_PREFIX_INVALID_MESSAGE;
const commandSettingsFeature = 'settings';
const commandPrefixUpdatedAction = 'command_prefix.updated';

export async function loadDashboardCommandSettingsPageData(
    request: Request,
    guildId: string
): Promise<DashboardCommandSettingsPageDataResult> {
    const guildPageData = await loadDashboardGuildPageData(request, guildId);

    if (guildPageData.type !== 'guild') {
        return guildPageData;
    }

    const commandSettingsResult = await loadDashboardCommandSettings(guildPageData.guild.id);

    if (commandSettingsResult.type === 'database-error') {
        return { type: 'database-error' };
    }

    return {
        ...guildPageData,
        commandSettings: commandSettingsResult.commandSettings,
    };
}

export async function updateDashboardGuildCommandPrefix(
    request: Request,
    input: DashboardCommandPrefixUpdateInput
): Promise<DashboardCommandPrefixUpdateResult> {
    const guildPageData = await loadDashboardGuildPageData(request, input.guildId);

    switch (guildPageData.type) {
        case 'guild':
            return updateCommandPrefixForAuthorizedGuild(request, guildPageData.guild.id, input.prefix);

        case 'auth-required':
            return { type: 'auth-required' };

        case 'deployment-config-not-found':
            return { type: 'deployment-config-not-found' };

        case 'database-error':
            return { type: 'database-error' };

        case 'guild-lookup-failed':
            return { type: 'guild-lookup-failed' };

        case 'not-found':
        case 'single-unauthorized':
            return { type: 'not-found' };
    }
}

async function loadDashboardCommandSettings(
    guildId: string
): Promise<{ type: 'settings'; commandSettings: DashboardCommandSettings } | { type: 'database-error' }> {
    const database = getWebDatabaseClient();
    const settingsResult = await findGuildCommandSettingsByGuildId(database.db, { guildId });

    if (settingsResult.isOk()) {
        return {
            type: 'settings',
            commandSettings: {
                prefix: settingsResult.value.prefix,
                isDefaultPrefix: false,
            },
        };
    }

    switch (settingsResult.error) {
        case 'not-found':
            return {
                type: 'settings',
                commandSettings: {
                    prefix: DEFAULT_DASHBOARD_COMMAND_PREFIX,
                    isDefaultPrefix: true,
                },
            };

        case 'missing-guild-id':
        case 'invalid-prefix':
        case 'invalid-config':
        case 'database-error':
            return { type: 'database-error' };
    }
}

async function updateCommandPrefixForAuthorizedGuild(
    request: Request,
    guildId: string,
    prefix: string
): Promise<DashboardCommandPrefixUpdateResult> {
    const actorResult = await resolveDashboardCommandSettingsActor(request);

    if (actorResult.type !== 'actor') {
        return actorResult;
    }

    const database = getWebDatabaseClient();
    const updateResult = await upsertGuildCommandPrefix(database.db, { guildId, prefix });

    if (updateResult.isOk()) {
        const auditResult = await recordBotActionEvent(database.db, {
            guildId,
            feature: commandSettingsFeature,
            action: commandPrefixUpdatedAction,
            actorUserId: actorResult.actorUserId,
            targetId: 'settings.prefix',
            metadata: {
                prefix: updateResult.value.prefix,
                source: 'dashboard',
                ...actorResult.metadata,
            },
        });

        if (auditResult.isErr()) {
            return { type: 'database-error' };
        }

        return {
            type: 'updated',
            commandSettings: {
                prefix: updateResult.value.prefix,
                isDefaultPrefix: updateResult.value.prefix === DEFAULT_DASHBOARD_COMMAND_PREFIX,
            },
        };
    }

    return mapCommandSettingsRepositoryError(updateResult.error);
}

async function resolveDashboardCommandSettingsActor(request: Request): Promise<
    | {
          type: 'actor';
          actorUserId: string;
          metadata: Record<string, string>;
      }
    | { type: 'auth-required' }
    | { type: 'database-error' }
> {
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

function mapCommandSettingsRepositoryError(
    errorValue: GuildCommandSettingsRepositoryError
): DashboardCommandPrefixUpdateResult {
    switch (errorValue) {
        case 'invalid-prefix':
            return {
                type: 'invalid-prefix',
                message: invalidPrefixMessage,
            };

        case 'missing-guild-id':
        case 'invalid-config':
        case 'not-found':
        case 'database-error':
            return { type: 'database-error' };
    }
}

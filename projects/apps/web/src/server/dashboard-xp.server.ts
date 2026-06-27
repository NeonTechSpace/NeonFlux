import '@tanstack/react-start/server-only';

import { findXpSettingsByGuildId, recordBotActionEvent, upsertXpSettings } from '@neonflux/db';
import type { XpSettingsRecord } from '@neonflux/db';
import { getFluxerCurrentUser } from '@neonflux/fluxer/users';

import { getWebDatabaseClient } from './database.server.js';
import type { DashboardGuildPageDataResult } from './dashboard-guild-page.server.js';
import { loadDashboardGuildPageData } from './dashboard-guild-page.server.js';
import { readAuthenticatedFluxerContext } from './fluxer-auth-context.server.js';

export type DashboardXpSettings = {
    enabled: boolean;
    messageXpMin: number;
    messageXpMax: number;
    cooldownSeconds: number;
    voiceXpPerMinute: number;
    voiceMinimumMinutes: number;
    updatedAt?: string;
};

export type DashboardXpSettingsResult =
    | {
          type: 'settings';
          settings: DashboardXpSettings;
      }
    | DashboardXpSettingsErrorResult;

export type DashboardXpSettingsUpdateInput = {
    guildId: string;
    enabled?: boolean;
    messageXpMin?: number;
    messageXpMax?: number;
    cooldownSeconds?: number;
    voiceXpPerMinute?: number;
    voiceMinimumMinutes?: number;
};

export type DashboardXpSettingsUpdateResult =
    | {
          type: 'updated';
          settings: DashboardXpSettings;
      }
    | { type: 'invalid-input'; field: string }
    | DashboardXpSettingsErrorResult;

type DashboardXpSettingsErrorResult =
    | { type: 'auth-required' }
    | { type: 'not-found' }
    | { type: 'deployment-config-not-found' }
    | { type: 'database-error' }
    | { type: 'guild-lookup-failed' };

type AuthorizedGuildPageData = Extract<DashboardGuildPageDataResult, { type: 'guild' }>;

const dashboardXpFeature = 'xp';
const defaultXpSettings: DashboardXpSettings = {
    enabled: false,
    messageXpMin: 5,
    messageXpMax: 10,
    cooldownSeconds: 60,
    voiceXpPerMinute: 2,
    voiceMinimumMinutes: 5,
};

export async function loadDashboardXpSettings(request: Request, guildId: string): Promise<DashboardXpSettingsResult> {
    const guildPageData = await loadDashboardGuildPageData(request, guildId);

    if (guildPageData.type !== 'guild') {
        return mapDashboardGuildPageError(guildPageData);
    }

    const settingsResult = await findXpSettingsByGuildId(getWebDatabaseClient().db, {
        guildId: guildPageData.guild.id,
    });

    if (settingsResult.isErr()) {
        if (settingsResult.error.type === 'not-found') {
            return {
                type: 'settings',
                settings: defaultXpSettings,
            };
        }

        return { type: 'database-error' };
    }

    return {
        type: 'settings',
        settings: toDashboardXpSettings(settingsResult.value),
    };
}

export async function updateDashboardXpSettings(
    request: Request,
    input: DashboardXpSettingsUpdateInput
): Promise<DashboardXpSettingsUpdateResult> {
    const validation = validateXpSettingsUpdateInput(input);

    if (validation) {
        return validation;
    }

    const guildPageData = await loadDashboardGuildPageData(request, input.guildId);

    if (guildPageData.type !== 'guild') {
        return mapDashboardGuildPageError(guildPageData);
    }

    const actorResult = await resolveXpActor(request);

    if (actorResult.type !== 'actor') {
        return actorResult;
    }

    const database = getWebDatabaseClient();
    const settingsResult = await upsertXpSettings(database.db, {
        guildId: guildPageData.guild.id,
        enabled: input.enabled ?? false,
        messageXpMin: input.messageXpMin,
        messageXpMax: input.messageXpMax,
        cooldownSeconds: input.cooldownSeconds,
        voiceXpPerMinute: input.voiceXpPerMinute,
        voiceMinimumMinutes: input.voiceMinimumMinutes,
    });

    if (settingsResult.isErr()) {
        return settingsResult.error.type === 'invalid-value' || settingsResult.error.type === 'missing-input'
            ? { type: 'invalid-input', field: settingsResult.error.field }
            : { type: 'database-error' };
    }

    const settings = toDashboardXpSettings(settingsResult.value);
    const auditResult = await recordBotActionEvent(database.db, {
        guildId: guildPageData.guild.id,
        feature: dashboardXpFeature,
        action: 'settings.updated',
        actorUserId: actorResult.actorUserId,
        targetId: guildPageData.guild.id,
        metadata: {
            enabled: settings.enabled,
            messageXpMin: settings.messageXpMin,
            messageXpMax: settings.messageXpMax,
            cooldownSeconds: settings.cooldownSeconds,
            voiceXpPerMinute: settings.voiceXpPerMinute,
            voiceMinimumMinutes: settings.voiceMinimumMinutes,
            source: 'dashboard',
            ...actorResult.metadata,
        },
    });

    if (auditResult.isErr()) {
        return { type: 'database-error' };
    }

    return {
        type: 'updated',
        settings,
    };
}

function validateXpSettingsUpdateInput(
    input: DashboardXpSettingsUpdateInput
): { type: 'invalid-input'; field: string } | undefined {
    const requiredIntegerFields = [
        'messageXpMin',
        'messageXpMax',
        'cooldownSeconds',
        'voiceXpPerMinute',
        'voiceMinimumMinutes',
    ] as const;

    for (const field of requiredIntegerFields) {
        if (!Number.isInteger(input[field])) {
            return { type: 'invalid-input', field };
        }
    }

    return undefined;
}

function toDashboardXpSettings(record: XpSettingsRecord): DashboardXpSettings {
    return {
        enabled: record.enabled,
        messageXpMin: record.messageXpMin,
        messageXpMax: record.messageXpMax,
        cooldownSeconds: record.cooldownSeconds,
        voiceXpPerMinute: record.voiceXpPerMinute,
        voiceMinimumMinutes: record.voiceMinimumMinutes,
        updatedAt: record.updatedAt.toISOString(),
    };
}

function mapDashboardGuildPageError(
    guildPageData: Exclude<DashboardGuildPageDataResult, AuthorizedGuildPageData>
): DashboardXpSettingsErrorResult {
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

type XpActor =
    | {
          type: 'actor';
          actorUserId: string;
          metadata: Record<string, string>;
      }
    | { type: 'auth-required' }
    | { type: 'database-error' };

async function resolveXpActor(request: Request): Promise<XpActor> {
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

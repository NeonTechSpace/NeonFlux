import '@tanstack/react-start/server-only';

import {
    findRoleReconciliationSettingsByGuildId,
    recordBotActionEvent,
    upsertRoleReconciliationSettings,
} from '@neonflux/db';
import type { RoleReconciliationSettingsRecord } from '@neonflux/db';
import { getFluxerCurrentUser } from '@neonflux/fluxer/users';

import { getWebDatabaseClient } from './database.server.js';
import type { DashboardGuildPageDataResult } from './dashboard-guild-page.server.js';
import { loadDashboardGuildPageData } from './dashboard-guild-page.server.js';
import { readAuthenticatedFluxerContext } from './fluxer-auth-context.server.js';

export type DashboardRoleReconciliationSettings = {
    enabled: boolean;
    restoreAutoroleRoles: boolean;
    restoreVerificationRoles: boolean;
    restoreReactionRoles: boolean;
    cleanupDeletedRoleReferences: boolean;
    updatedAt?: string;
};

export type DashboardRoleReconciliationSettingsResult =
    | {
          type: 'settings';
          settings: DashboardRoleReconciliationSettings;
      }
    | DashboardRoleReconciliationErrorResult;

export type DashboardRoleReconciliationSettingsUpdateInput = {
    guildId: string;
    enabled?: boolean;
    restoreAutoroleRoles?: boolean;
    restoreVerificationRoles?: boolean;
    restoreReactionRoles?: boolean;
    cleanupDeletedRoleReferences?: boolean;
};

export type DashboardRoleReconciliationSettingsUpdateResult =
    | {
          type: 'updated';
          settings: DashboardRoleReconciliationSettings;
      }
    | { type: 'invalid-input'; field: string }
    | DashboardRoleReconciliationErrorResult;

type DashboardRoleReconciliationErrorResult =
    | { type: 'auth-required' }
    | { type: 'not-found' }
    | { type: 'deployment-config-not-found' }
    | { type: 'database-error' }
    | { type: 'guild-lookup-failed' };

type AuthorizedGuildPageData = Extract<DashboardGuildPageDataResult, { type: 'guild' }>;

const dashboardRoleReconciliationFeature = 'role_reconciliation';

export async function loadDashboardRoleReconciliationSettings(
    request: Request,
    guildId: string
): Promise<DashboardRoleReconciliationSettingsResult> {
    const guildPageData = await loadDashboardGuildPageData(request, guildId);

    if (guildPageData.type !== 'guild') {
        return mapDashboardGuildPageError(guildPageData);
    }

    const settingsResult = await findRoleReconciliationSettingsByGuildId(getWebDatabaseClient().db, {
        guildId: guildPageData.guild.id,
    });

    if (settingsResult.isErr()) {
        return { type: 'database-error' };
    }

    return {
        type: 'settings',
        settings: toDashboardRoleReconciliationSettings(settingsResult.value),
    };
}

export async function updateDashboardRoleReconciliationSettings(
    request: Request,
    input: DashboardRoleReconciliationSettingsUpdateInput
): Promise<DashboardRoleReconciliationSettingsUpdateResult> {
    const validation = validateRoleReconciliationSettingsUpdateInput(input);

    if (validation) {
        return validation;
    }

    const guildPageData = await loadDashboardGuildPageData(request, input.guildId);

    if (guildPageData.type !== 'guild') {
        return mapDashboardGuildPageError(guildPageData);
    }

    const actorResult = await resolveRoleReconciliationActor(request);

    if (actorResult.type !== 'actor') {
        return actorResult;
    }

    const database = getWebDatabaseClient();
    const settingsResult = await upsertRoleReconciliationSettings(database.db, {
        guildId: guildPageData.guild.id,
        enabled: input.enabled,
        restoreAutoroleRoles: input.restoreAutoroleRoles,
        restoreVerificationRoles: input.restoreVerificationRoles,
        restoreReactionRoles: input.restoreReactionRoles,
        cleanupDeletedRoleReferences: input.cleanupDeletedRoleReferences,
    });

    if (settingsResult.isErr()) {
        return settingsResult.error.type === 'missing-input'
            ? { type: 'invalid-input', field: settingsResult.error.field }
            : { type: 'database-error' };
    }

    const settings = toDashboardRoleReconciliationSettings(settingsResult.value);
    const auditResult = await recordBotActionEvent(database.db, {
        guildId: guildPageData.guild.id,
        feature: dashboardRoleReconciliationFeature,
        action: 'settings.updated',
        actorUserId: actorResult.actorUserId,
        targetId: guildPageData.guild.id,
        metadata: {
            enabled: settings.enabled,
            restoreAutoroleRoles: settings.restoreAutoroleRoles,
            restoreVerificationRoles: settings.restoreVerificationRoles,
            restoreReactionRoles: settings.restoreReactionRoles,
            cleanupDeletedRoleReferences: settings.cleanupDeletedRoleReferences,
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

function validateRoleReconciliationSettingsUpdateInput(
    input: DashboardRoleReconciliationSettingsUpdateInput
): { type: 'invalid-input'; field: string } | undefined {
    const booleanFields = [
        'enabled',
        'restoreAutoroleRoles',
        'restoreVerificationRoles',
        'restoreReactionRoles',
        'cleanupDeletedRoleReferences',
    ] as const;

    for (const field of booleanFields) {
        if (typeof input[field] !== 'boolean') {
            return { type: 'invalid-input', field };
        }
    }

    return undefined;
}

function toDashboardRoleReconciliationSettings(
    record: RoleReconciliationSettingsRecord
): DashboardRoleReconciliationSettings {
    return {
        enabled: record.enabled,
        restoreAutoroleRoles: record.restoreAutoroleRoles,
        restoreVerificationRoles: record.restoreVerificationRoles,
        restoreReactionRoles: record.restoreReactionRoles,
        cleanupDeletedRoleReferences: record.cleanupDeletedRoleReferences,
        ...(record.updatedAt ? { updatedAt: record.updatedAt.toISOString() } : {}),
    };
}

function mapDashboardGuildPageError(
    guildPageData: Exclude<DashboardGuildPageDataResult, AuthorizedGuildPageData>
): DashboardRoleReconciliationErrorResult {
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

type RoleReconciliationActor =
    | {
          type: 'actor';
          actorUserId: string;
          metadata: Record<string, string>;
      }
    | { type: 'auth-required' }
    | { type: 'database-error' };

async function resolveRoleReconciliationActor(request: Request): Promise<RoleReconciliationActor> {
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

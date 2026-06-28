import '@tanstack/react-start/server-only';

import { loadWebConfig } from '@neonflux/config';
import { deleteAutoroleRule, listAutoroleRulesByGuildId, recordBotActionEvent, upsertAutoroleRule } from '@neonflux/db';
import type { AutoroleRuleRecord } from '@neonflux/db';
import { readFluxerBotGuildStructure } from '@neonflux/fluxer';
import { getFluxerCurrentUser } from '@neonflux/fluxer/users';

import { getWebDatabaseClient } from './database.server.js';
import type { DashboardGuildPageDataResult } from './dashboard-guild-page.server.js';
import { loadDashboardGuildPageData } from './dashboard-guild-page.server.js';
import { readAuthenticatedFluxerContext } from './fluxer-auth-context.server.js';

export type DashboardAutoroleRole = {
    id: string;
    name: string;
    position: number;
};

export type DashboardAutoroleRule = {
    id: string;
    roleId: string;
    name?: string;
    enabled: boolean;
    updatedAt: string;
};

type DashboardAutoroleRoleReadStatus = 'available' | 'bot-token-missing' | 'fetch-failed';

export type DashboardAutoroleSettingsResult =
    | {
          type: 'settings';
          roles: DashboardAutoroleRole[];
          roleReadStatus: DashboardAutoroleRoleReadStatus;
          rules: DashboardAutoroleRule[];
      }
    | DashboardAutoroleErrorResult;

export type DashboardAutoroleRuleUpdateInput = {
    guildId: string;
    roleId: string;
    name?: string;
    enabled?: boolean;
};

export type DashboardAutoroleRuleUpdateResult =
    | {
          type: 'updated';
          rule: DashboardAutoroleRule;
      }
    | { type: 'invalid-input'; field: string }
    | DashboardAutoroleErrorResult;

export type DashboardAutoroleRuleDeleteInput = {
    guildId: string;
    roleId: string;
};

export type DashboardAutoroleRuleDeleteResult =
    | {
          type: 'deleted';
          rule: DashboardAutoroleRule;
      }
    | { type: 'invalid-input'; field: string }
    | DashboardAutoroleErrorResult;

type DashboardAutoroleErrorResult =
    | { type: 'auth-required' }
    | { type: 'not-found' }
    | { type: 'deployment-config-not-found' }
    | { type: 'database-error' }
    | { type: 'guild-lookup-failed' };
type DashboardAutoroleMutationErrorResult = { type: 'invalid-input'; field: string } | DashboardAutoroleErrorResult;

type AuthorizedGuildPageData = Extract<DashboardGuildPageDataResult, { type: 'guild' }>;

const dashboardAutoroleFeature = 'autorole';

export async function loadDashboardAutoroleSettings(
    request: Request,
    guildId: string
): Promise<DashboardAutoroleSettingsResult> {
    const guildPageData = await loadDashboardGuildPageData(request, guildId);

    if (guildPageData.type !== 'guild') {
        return mapDashboardGuildPageError(guildPageData);
    }

    const rulesResult = await listAutoroleRulesByGuildId(getWebDatabaseClient().db, {
        guildId: guildPageData.guild.id,
    });

    if (rulesResult.isErr()) {
        return { type: 'database-error' };
    }

    const rolesResult = await loadDashboardAutoroleRoles(guildPageData.guild.id);

    return {
        type: 'settings',
        roles: rolesResult.roles,
        roleReadStatus: rolesResult.status,
        rules: rulesResult.value.map(toDashboardAutoroleRule),
    };
}

export async function updateDashboardAutoroleRule(
    request: Request,
    input: DashboardAutoroleRuleUpdateInput
): Promise<DashboardAutoroleRuleUpdateResult> {
    const guildPageData = await loadDashboardGuildPageData(request, input.guildId);

    if (guildPageData.type !== 'guild') {
        return mapDashboardGuildPageError(guildPageData);
    }

    const actorResult = await resolveAutoroleActor(request);

    if (actorResult.type !== 'actor') {
        return actorResult;
    }

    const database = getWebDatabaseClient();
    const ruleResult = await upsertAutoroleRule(database.db, {
        guildId: guildPageData.guild.id,
        roleId: input.roleId,
        name: input.name,
        enabled: input.enabled ?? true,
    });

    if (ruleResult.isErr()) {
        return mapAutoroleRepositoryError(ruleResult.error);
    }

    const auditResult = await recordBotActionEvent(database.db, {
        guildId: guildPageData.guild.id,
        feature: dashboardAutoroleFeature,
        action: 'rule.updated',
        actorUserId: actorResult.actorUserId,
        targetId: ruleResult.value.roleId,
        metadata: {
            roleId: ruleResult.value.roleId,
            ...(ruleResult.value.name ? { roleName: ruleResult.value.name } : {}),
            enabled: ruleResult.value.enabled,
            source: 'dashboard',
            ...actorResult.metadata,
        },
    });

    if (auditResult.isErr()) {
        return { type: 'database-error' };
    }

    return {
        type: 'updated',
        rule: toDashboardAutoroleRule(ruleResult.value),
    };
}

export async function deleteDashboardAutoroleRule(
    request: Request,
    input: DashboardAutoroleRuleDeleteInput
): Promise<DashboardAutoroleRuleDeleteResult> {
    const guildPageData = await loadDashboardGuildPageData(request, input.guildId);

    if (guildPageData.type !== 'guild') {
        return mapDashboardGuildPageError(guildPageData);
    }

    const actorResult = await resolveAutoroleActor(request);

    if (actorResult.type !== 'actor') {
        return actorResult;
    }

    const database = getWebDatabaseClient();
    const ruleResult = await deleteAutoroleRule(database.db, {
        guildId: guildPageData.guild.id,
        roleId: input.roleId,
    });

    if (ruleResult.isErr()) {
        return mapAutoroleRepositoryError(ruleResult.error);
    }

    const auditResult = await recordBotActionEvent(database.db, {
        guildId: guildPageData.guild.id,
        feature: dashboardAutoroleFeature,
        action: 'rule.deleted',
        actorUserId: actorResult.actorUserId,
        targetId: ruleResult.value.roleId,
        metadata: {
            roleId: ruleResult.value.roleId,
            ...(ruleResult.value.name ? { roleName: ruleResult.value.name } : {}),
            source: 'dashboard',
            ...actorResult.metadata,
        },
    });

    if (auditResult.isErr()) {
        return { type: 'database-error' };
    }

    return {
        type: 'deleted',
        rule: toDashboardAutoroleRule(ruleResult.value),
    };
}

async function loadDashboardAutoroleRoles(
    guildId: string
): Promise<{ status: DashboardAutoroleRoleReadStatus; roles: DashboardAutoroleRole[] }> {
    const botToken = loadWebConfig().fluxerBotToken;

    if (!botToken) {
        return {
            status: 'bot-token-missing',
            roles: [],
        };
    }

    const structureResult = await readFluxerBotGuildStructure({
        botToken,
        guildId,
    });

    if (structureResult.isErr()) {
        return {
            status: 'fetch-failed',
            roles: [],
        };
    }

    return {
        status: 'available',
        roles: structureResult.value.roles
            .filter((role) => role.name !== '@everyone')
            .map((role) => ({
                id: role.id,
                name: role.name,
                position: role.position,
            }))
            .sort((left, right) => right.position - left.position || left.name.localeCompare(right.name)),
    };
}

function toDashboardAutoroleRule(record: AutoroleRuleRecord): DashboardAutoroleRule {
    return {
        id: record.id,
        roleId: record.roleId,
        ...(record.name ? { name: record.name } : {}),
        enabled: record.enabled,
        updatedAt: record.updatedAt.toISOString(),
    };
}

function mapDashboardGuildPageError(
    guildPageData: Exclude<DashboardGuildPageDataResult, AuthorizedGuildPageData>
): DashboardAutoroleErrorResult {
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

function mapAutoroleRepositoryError(error: { type: string; field?: string }): DashboardAutoroleMutationErrorResult {
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

type AutoroleActor =
    | {
          type: 'actor';
          actorUserId: string;
          metadata: Record<string, string>;
      }
    | { type: 'auth-required' }
    | { type: 'database-error' };

async function resolveAutoroleActor(request: Request): Promise<AutoroleActor> {
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

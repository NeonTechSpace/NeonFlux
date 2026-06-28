import '@tanstack/react-start/server-only';

import { loadWebConfig } from '@neonflux/config';
import { listGrantableBotCommandCategories, listGrantableBotCommandDefinitions } from '@neonflux/core';
import type { BotCommandDefinition } from '@neonflux/core';
import {
    deleteGuildCommandPermissionRule,
    listGuildCommandPermissionRulesByGuildId,
    recordBotActionEvent,
    upsertGuildCommandPermissionRule,
} from '@neonflux/db';
import type { GuildCommandPermissionRuleRecord, GuildCommandPermissionRuleTargetType } from '@neonflux/db';
import { readFluxerBotGuildStructure } from '@neonflux/fluxer';
import { getFluxerCurrentUser } from '@neonflux/fluxer/users';

import { getWebDatabaseClient } from './database.server.js';
import { loadDashboardGuildPageData } from './dashboard-guild-page.server.js';
import type { DashboardGuildPageDataResult } from './dashboard-guild-page.server.js';
import { readAuthenticatedFluxerContext } from './fluxer-auth-context.server.js';

export type DashboardCommandAccessTargetType = GuildCommandPermissionRuleTargetType;

export type DashboardCommandAccessRule = {
    targetType: DashboardCommandAccessTargetType;
    targetId: string;
    userIds: string[];
    roleIds: string[];
    updatedAt: string;
};

export type DashboardCommandAccessRole = {
    id: string;
    name: string;
    position: number;
};

export type DashboardCommandAccessRoleReadStatus = 'available' | 'bot-token-missing' | 'fetch-failed';

type DashboardGrantableCommand = {
    id: string;
    categoryId: string;
    categoryTitle: string;
    commandName: string;
    description: string;
};

type DashboardGrantableCommandCategory = {
    id: string;
    title: string;
};

export type DashboardCommandAccessCatalog = {
    categories: DashboardGrantableCommandCategory[];
    commands: DashboardGrantableCommand[];
};

export type DashboardCommandAccessResult =
    | {
          type: 'access';
          catalog: DashboardCommandAccessCatalog;
          roles: DashboardCommandAccessRole[];
          roleReadStatus: DashboardCommandAccessRoleReadStatus;
          rules: DashboardCommandAccessRule[];
      }
    | DashboardCommandAccessErrorResult;

export type DashboardCommandAccessUpdateInput = {
    guildId: string;
    targetType: DashboardCommandAccessTargetType;
    targetId: string;
    userIds?: readonly string[];
    roleIds?: readonly string[];
};

export type DashboardCommandAccessUpdateResult =
    | {
          type: 'updated';
          rule: DashboardCommandAccessRule;
      }
    | { type: 'invalid-target' }
    | DashboardCommandAccessErrorResult;

export type DashboardCommandAccessDeleteInput = {
    guildId: string;
    targetType: DashboardCommandAccessTargetType;
    targetId: string;
};

export type DashboardCommandAccessDeleteResult =
    | {
          type: 'deleted';
          targetType: DashboardCommandAccessTargetType;
          targetId: string;
      }
    | { type: 'invalid-target' }
    | DashboardCommandAccessErrorResult;

type DashboardCommandAccessErrorResult =
    | { type: 'auth-required' }
    | { type: 'not-found' }
    | { type: 'deployment-config-not-found' }
    | { type: 'database-error' }
    | { type: 'guild-lookup-failed' };

type AuthorizedGuildPageData = Extract<DashboardGuildPageDataResult, { type: 'guild' }>;

const dashboardAccessFeature = 'access';
const commandAccessUpdatedAction = 'command_access.updated';
const commandAccessDeletedAction = 'command_access.deleted';

export async function loadDashboardCommandAccessPage(
    request: Request,
    guildId: string
): Promise<DashboardCommandAccessResult> {
    const guildPageData = await loadDashboardGuildPageData(request, guildId);

    if (guildPageData.type !== 'guild') {
        return mapDashboardGuildPageError(guildPageData);
    }

    const database = getWebDatabaseClient();
    const rulesResult = await listGuildCommandPermissionRulesByGuildId(database.db, {
        guildId: guildPageData.guild.id,
    });

    if (rulesResult.isErr()) {
        return { type: 'database-error' };
    }

    const rolesResult = await loadDashboardCommandAccessRoles(guildPageData.guild.id);

    return {
        type: 'access',
        catalog: createDashboardCommandAccessCatalog(),
        roles: rolesResult.roles,
        roleReadStatus: rolesResult.status,
        rules: rulesResult.value.map(toDashboardCommandAccessRule),
    };
}

export async function updateDashboardCommandAccessRule(
    request: Request,
    input: DashboardCommandAccessUpdateInput
): Promise<DashboardCommandAccessUpdateResult> {
    const guildPageData = await loadDashboardGuildPageData(request, input.guildId);

    if (guildPageData.type !== 'guild') {
        return mapDashboardGuildPageError(guildPageData);
    }

    const target = normalizeAndValidateTarget(input);

    if (!target) {
        return { type: 'invalid-target' };
    }

    const actorResult = await resolveDashboardCommandAccessActor(request);

    if (actorResult.type !== 'actor') {
        return actorResult;
    }

    const database = getWebDatabaseClient();
    const upsertResult = await upsertGuildCommandPermissionRule(database.db, {
        guildId: guildPageData.guild.id,
        targetType: target.targetType,
        targetId: target.targetId,
        userIds: input.userIds,
        roleIds: input.roleIds,
    });

    if (upsertResult.isErr()) {
        return { type: 'database-error' };
    }

    const rule = toDashboardCommandAccessRule(upsertResult.value);
    const auditResult = await recordCommandAccessAuditEvent(database.db, guildPageData, actorResult, {
        action: commandAccessUpdatedAction,
        target,
        userCount: rule.userIds.length,
        roleCount: rule.roleIds.length,
    });

    if (auditResult === 'database-error') {
        return { type: 'database-error' };
    }

    return {
        type: 'updated',
        rule,
    };
}

export async function deleteDashboardCommandAccessRule(
    request: Request,
    input: DashboardCommandAccessDeleteInput
): Promise<DashboardCommandAccessDeleteResult> {
    const guildPageData = await loadDashboardGuildPageData(request, input.guildId);

    if (guildPageData.type !== 'guild') {
        return mapDashboardGuildPageError(guildPageData);
    }

    const target = normalizeAndValidateTarget(input);

    if (!target) {
        return { type: 'invalid-target' };
    }

    const actorResult = await resolveDashboardCommandAccessActor(request);

    if (actorResult.type !== 'actor') {
        return actorResult;
    }

    const database = getWebDatabaseClient();
    const deleteResult = await deleteGuildCommandPermissionRule(database.db, {
        guildId: guildPageData.guild.id,
        targetType: target.targetType,
        targetId: target.targetId,
    });

    if (deleteResult.isErr()) {
        return deleteResult.error === 'not-found' ? { type: 'not-found' } : { type: 'database-error' };
    }

    const auditResult = await recordCommandAccessAuditEvent(database.db, guildPageData, actorResult, {
        action: commandAccessDeletedAction,
        target,
        userCount: deleteResult.value.userIds.length,
        roleCount: deleteResult.value.roleIds.length,
    });

    if (auditResult === 'database-error') {
        return { type: 'database-error' };
    }

    return {
        type: 'deleted',
        targetType: target.targetType,
        targetId: target.targetId,
    };
}

function createDashboardCommandAccessCatalog(): DashboardCommandAccessCatalog {
    return {
        categories: listGrantableBotCommandCategories(),
        commands: listGrantableBotCommandDefinitions().map(toDashboardGrantableCommand),
    };
}

async function loadDashboardCommandAccessRoles(
    guildId: string
): Promise<{ status: DashboardCommandAccessRoleReadStatus; roles: DashboardCommandAccessRole[] }> {
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

function toDashboardGrantableCommand(command: BotCommandDefinition): DashboardGrantableCommand {
    return {
        id: command.id,
        categoryId: command.categoryId,
        categoryTitle: command.categoryTitle,
        commandName: command.commandName,
        description: command.description,
    };
}

function normalizeAndValidateTarget(input: {
    targetType: DashboardCommandAccessTargetType;
    targetId: string;
}): { targetType: DashboardCommandAccessTargetType; targetId: string } | undefined {
    const targetType = input.targetType;
    const targetId = input.targetId.trim();

    if (!targetId) {
        return undefined;
    }

    if (targetType === 'category') {
        return listGrantableBotCommandCategories().some((category) => category.id === targetId)
            ? { targetType, targetId }
            : undefined;
    }

    return listGrantableBotCommandDefinitions().some((command) => command.id === targetId)
        ? { targetType, targetId }
        : undefined;
}

type DashboardCommandAccessActor =
    | {
          type: 'actor';
          actorUserId: string;
          metadata: Record<string, string>;
      }
    | { type: 'auth-required' }
    | { type: 'database-error' };

async function resolveDashboardCommandAccessActor(request: Request): Promise<DashboardCommandAccessActor> {
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

async function recordCommandAccessAuditEvent(
    db: Parameters<typeof recordBotActionEvent>[0],
    guildPageData: AuthorizedGuildPageData,
    actor: Extract<DashboardCommandAccessActor, { type: 'actor' }>,
    input: {
        action: string;
        target: { targetType: DashboardCommandAccessTargetType; targetId: string };
        userCount: number;
        roleCount: number;
    }
): Promise<'recorded' | 'database-error'> {
    const result = await recordBotActionEvent(db, {
        guildId: guildPageData.guild.id,
        feature: dashboardAccessFeature,
        action: input.action,
        actorUserId: actor.actorUserId,
        targetId: input.target.targetId,
        metadata: {
            targetType: input.target.targetType,
            targetId: input.target.targetId,
            userCount: input.userCount,
            roleCount: input.roleCount,
            source: 'dashboard',
            ...actor.metadata,
        },
    });

    return result.isOk() ? 'recorded' : 'database-error';
}

function toDashboardCommandAccessRule(rule: GuildCommandPermissionRuleRecord): DashboardCommandAccessRule {
    return {
        targetType: rule.targetType,
        targetId: rule.targetId,
        userIds: rule.userIds,
        roleIds: rule.roleIds,
        updatedAt: rule.updatedAt.toISOString(),
    };
}

function mapDashboardGuildPageError(
    guildPageData: Exclude<DashboardGuildPageDataResult, AuthorizedGuildPageData>
): DashboardCommandAccessErrorResult {
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

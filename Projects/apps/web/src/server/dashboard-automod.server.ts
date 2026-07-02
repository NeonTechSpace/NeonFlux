import '@tanstack/react-start/server-only';

import {
    deleteAutomodRule,
    listAutomodEventsByGuildId,
    listAutomodRulesByGuildId,
    recordBotActionEvent,
    saveAutomodRule,
} from '@neonflux/db';
import type { AutomodActionType, AutomodEventRecord, AutomodRuleRecord, AutomodTriggerType } from '@neonflux/db';
import { getFluxerCurrentUser } from '@neonflux/fluxer/users';

import { getWebDatabaseClient } from './database.server.js';
import type { DashboardGuildPageDataResult } from './dashboard-guild-page.server.js';
import { loadDashboardGuildPageData } from './dashboard-guild-page.server.js';
import type {
    DashboardTargetCatalogStatus,
    DashboardTargetChannel,
    DashboardTargetRole,
} from './dashboard-target-catalog.server.js';
import { loadDashboardTargetCatalog } from './dashboard-target-catalog.server.js';
import { readAuthenticatedFluxerContext } from './fluxer-auth-context.server.js';

export type DashboardAutomodRule = {
    id: string;
    name: string;
    triggerType: AutomodTriggerType;
    actionType: AutomodActionType;
    enabled: boolean;
    terms: string[];
    timeoutDurationSeconds?: number;
    ignoredChannelIds: string[];
    ignoredRoleIds: string[];
    ignoredUserIds: string[];
    updatedAt: string;
};

export type DashboardAutomodEvent = {
    id: string;
    ruleId?: string;
    messageId: string;
    channelId: string;
    authorUserId: string;
    triggerType: AutomodTriggerType;
    actionType: AutomodActionType;
    status: string;
    matchedTerms: string[];
    matchedTermCount: number;
    inviteLinkCount: number;
    contentLength?: number;
    createdAt: string;
};

export type DashboardAutomodSettingsResult =
    | {
          type: 'settings';
          structureReadStatus: DashboardTargetCatalogStatus;
          channels: DashboardTargetChannel[];
          roles: DashboardTargetRole[];
          rules: DashboardAutomodRule[];
          events: DashboardAutomodEvent[];
      }
    | DashboardAutomodErrorResult;

export type DashboardAutomodRuleUpdateInput = {
    guildId: string;
    ruleId?: string;
    name: string;
    triggerType: AutomodTriggerType;
    actionType?: AutomodActionType;
    enabled?: boolean;
    terms?: readonly string[];
    timeoutDurationSeconds?: number;
    ignoredChannelIds?: readonly string[];
    ignoredRoleIds?: readonly string[];
    ignoredUserIds?: readonly string[];
};

export type DashboardAutomodRuleUpdateResult =
    | {
          type: 'updated';
          rule: DashboardAutomodRule;
      }
    | { type: 'invalid-input'; field: string }
    | DashboardAutomodErrorResult;

export type DashboardAutomodRuleDeleteInput = {
    guildId: string;
    ruleId: string;
};

export type DashboardAutomodRuleDeleteResult =
    | {
          type: 'deleted';
          rule: DashboardAutomodRule;
      }
    | { type: 'invalid-input'; field: string }
    | DashboardAutomodErrorResult;

type DashboardAutomodErrorResult =
    | { type: 'auth-required' }
    | { type: 'not-found' }
    | { type: 'deployment-config-not-found' }
    | { type: 'database-error' }
    | { type: 'guild-lookup-failed' };

type AuthorizedGuildPageData = Extract<DashboardGuildPageDataResult, { type: 'guild' }>;

const dashboardAutomodFeature = 'automod';
const recentAutomodEventLimit = 25;

export async function loadDashboardAutomodSettings(
    request: Request,
    guildId: string
): Promise<DashboardAutomodSettingsResult> {
    const guildPageData = await loadDashboardGuildPageData(request, guildId);

    if (guildPageData.type !== 'guild') {
        return mapDashboardGuildPageError(guildPageData);
    }

    const database = getWebDatabaseClient();
    const [rulesResult, eventsResult] = await Promise.all([
        listAutomodRulesByGuildId(database.db, { guildId: guildPageData.guild.id }),
        listAutomodEventsByGuildId(database.db, {
            guildId: guildPageData.guild.id,
            limit: recentAutomodEventLimit,
        }),
    ]);

    if (rulesResult.isErr() || eventsResult.isErr()) {
        return { type: 'database-error' };
    }

    const targetCatalog = await loadDashboardTargetCatalog(guildPageData.guild.id);

    return {
        type: 'settings',
        structureReadStatus: targetCatalog.status,
        channels: targetCatalog.channels,
        roles: targetCatalog.roles,
        rules: rulesResult.value.map(toDashboardAutomodRule),
        events: eventsResult.value.map(toDashboardAutomodEvent),
    };
}

export async function updateDashboardAutomodRule(
    request: Request,
    input: DashboardAutomodRuleUpdateInput
): Promise<DashboardAutomodRuleUpdateResult> {
    const guildPageData = await loadDashboardGuildPageData(request, input.guildId);

    if (guildPageData.type !== 'guild') {
        return mapDashboardGuildPageError(guildPageData);
    }

    const actorResult = await resolveAutomodActor(request);

    if (actorResult.type !== 'actor') {
        return actorResult;
    }

    const normalizedTerms = normalizeTerms(input.terms ?? []);
    const database = getWebDatabaseClient();
    const ruleResult = await saveAutomodRule(database.db, {
        guildId: guildPageData.guild.id,
        ruleId: input.ruleId,
        name: input.name,
        triggerType: input.triggerType,
        actionType: input.actionType ?? 'record',
        enabled: input.enabled ?? true,
        config: {
            ...(input.triggerType === 'blocked_terms' ? { terms: normalizedTerms } : {}),
            ...(input.timeoutDurationSeconds ? { timeoutDurationSeconds: input.timeoutDurationSeconds } : {}),
            ignoredChannelIds: normalizeTerms(input.ignoredChannelIds ?? []),
            ignoredRoleIds: normalizeTerms(input.ignoredRoleIds ?? []),
            ignoredUserIds: normalizeTerms(input.ignoredUserIds ?? []),
        },
    });

    if (ruleResult.isErr()) {
        return ruleResult.error.type === 'missing-input' || ruleResult.error.type === 'invalid-value'
            ? { type: 'invalid-input', field: ruleResult.error.field }
            : { type: 'database-error' };
    }

    const auditResult = await recordBotActionEvent(database.db, {
        guildId: guildPageData.guild.id,
        feature: dashboardAutomodFeature,
        action: 'rule.updated',
        actorUserId: actorResult.actorUserId,
        targetId: ruleResult.value.id,
        metadata: {
            ruleId: ruleResult.value.id,
            triggerType: ruleResult.value.triggerType,
            actionType: ruleResult.value.actionType,
            enabled: ruleResult.value.enabled,
            termCount: getStringArray(ruleResult.value.config.terms).length,
            ignoredChannelCount: getStringArray(ruleResult.value.config.ignoredChannelIds).length,
            ignoredRoleCount: getStringArray(ruleResult.value.config.ignoredRoleIds).length,
            ignoredUserCount: getStringArray(ruleResult.value.config.ignoredUserIds).length,
            source: 'dashboard',
            ...actorResult.metadata,
        },
    });

    if (auditResult.isErr()) {
        return { type: 'database-error' };
    }

    return {
        type: 'updated',
        rule: toDashboardAutomodRule(ruleResult.value),
    };
}

export async function deleteDashboardAutomodRule(
    request: Request,
    input: DashboardAutomodRuleDeleteInput
): Promise<DashboardAutomodRuleDeleteResult> {
    const guildPageData = await loadDashboardGuildPageData(request, input.guildId);

    if (guildPageData.type !== 'guild') {
        return mapDashboardGuildPageError(guildPageData);
    }

    const actorResult = await resolveAutomodActor(request);

    if (actorResult.type !== 'actor') {
        return actorResult;
    }

    const database = getWebDatabaseClient();
    const ruleResult = await deleteAutomodRule(database.db, {
        guildId: guildPageData.guild.id,
        ruleId: input.ruleId,
    });

    if (ruleResult.isErr()) {
        return ruleResult.error.type === 'missing-input'
            ? { type: 'invalid-input', field: ruleResult.error.field }
            : { type: ruleResult.error.type === 'not-found' ? 'not-found' : 'database-error' };
    }

    const auditResult = await recordBotActionEvent(database.db, {
        guildId: guildPageData.guild.id,
        feature: dashboardAutomodFeature,
        action: 'rule.deleted',
        actorUserId: actorResult.actorUserId,
        targetId: ruleResult.value.id,
        metadata: {
            ruleId: ruleResult.value.id,
            triggerType: ruleResult.value.triggerType,
            source: 'dashboard',
            ...actorResult.metadata,
        },
    });

    if (auditResult.isErr()) {
        return { type: 'database-error' };
    }

    return {
        type: 'deleted',
        rule: toDashboardAutomodRule(ruleResult.value),
    };
}

function toDashboardAutomodRule(rule: AutomodRuleRecord): DashboardAutomodRule {
    return {
        id: rule.id,
        name: rule.name,
        triggerType: rule.triggerType,
        actionType: rule.actionType,
        enabled: rule.enabled,
        terms: getStringArray(rule.config.terms),
        ...(rule.config.timeoutDurationSeconds ? { timeoutDurationSeconds: rule.config.timeoutDurationSeconds } : {}),
        ignoredChannelIds: getStringArray(rule.config.ignoredChannelIds),
        ignoredRoleIds: getStringArray(rule.config.ignoredRoleIds),
        ignoredUserIds: getStringArray(rule.config.ignoredUserIds),
        updatedAt: rule.updatedAt.toISOString(),
    };
}

function toDashboardAutomodEvent(event: AutomodEventRecord): DashboardAutomodEvent {
    return {
        id: event.id,
        ...(event.ruleId ? { ruleId: event.ruleId } : {}),
        messageId: event.messageId,
        channelId: event.channelId,
        authorUserId: event.authorUserId,
        triggerType: event.triggerType,
        actionType: event.actionType,
        status: event.status,
        matchedTerms: getStringArray(event.details.matchedTerms),
        matchedTermCount: getNumber(event.details.matchedTermCount),
        inviteLinkCount: getNumber(event.details.inviteLinkCount),
        ...(typeof event.details.contentLength === 'number' ? { contentLength: event.details.contentLength } : {}),
        createdAt: event.createdAt.toISOString(),
    };
}

function mapDashboardGuildPageError(
    guildPageData: Exclude<DashboardGuildPageDataResult, AuthorizedGuildPageData>
): DashboardAutomodErrorResult {
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

type AutomodActor =
    | {
          type: 'actor';
          actorUserId: string;
          metadata: Record<string, string>;
      }
    | { type: 'auth-required' }
    | { type: 'database-error' };

async function resolveAutomodActor(request: Request): Promise<AutomodActor> {
    const authContextResult = await readAuthenticatedFluxerContext(request);

    if (authContextResult.isErr()) {
        return authContextResult.error === 'database-error' ? { type: 'database-error' } : { type: 'auth-required' };
    }

    const currentUserResult = await getFluxerCurrentUser({ accessToken: authContextResult.value.accessToken });

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

function normalizeTerms(terms: readonly string[]): string[] {
    return [...new Set(terms.map((term) => term.trim()).filter(Boolean))];
}

function getStringArray(value: unknown): string[] {
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function getNumber(value: unknown): number {
    return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

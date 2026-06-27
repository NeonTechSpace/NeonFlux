import '@tanstack/react-start/server-only';

import {
    findGuildModerationPolicyByGuildId,
    listModerationCasesByGuildId,
    recordBotActionEvent,
    upsertGuildModerationPolicy,
} from '@neonflux/db';
import type { GuildModerationPolicyRecord, ModerationCaseRecord } from '@neonflux/db';
import { getFluxerCurrentUser } from '@neonflux/fluxer/users';

import { getWebDatabaseClient } from './database.server.js';
import type { DashboardGuildPageDataResult } from './dashboard-guild-page.server.js';
import { loadDashboardGuildPageData } from './dashboard-guild-page.server.js';
import { readAuthenticatedFluxerContext } from './fluxer-auth-context.server.js';

export type DashboardModerationCase = {
    caseNumber: number;
    action: string;
    status: string;
    targetType: string;
    targetUserId?: string;
    targetChannelId?: string;
    actorUserId?: string;
    reason?: string;
    createdAt: string;
    updatedAt: string;
};

export type DashboardModerationCasesResult =
    | {
          type: 'cases';
          cases: DashboardModerationCase[];
      }
    | DashboardModerationErrorResult;

export type DashboardModerationPolicy = {
    protectedUserIds: string[];
    protectedRoleIds: string[];
    updatedAt?: string;
};

export type DashboardModerationPolicyResult =
    | {
          type: 'policy';
          policy: DashboardModerationPolicy;
      }
    | DashboardModerationErrorResult;

export type DashboardModerationPolicyUpdateInput = {
    guildId: string;
    protectedUserIds?: readonly string[];
    protectedRoleIds?: readonly string[];
};

export type DashboardModerationPolicyUpdateResult =
    | {
          type: 'updated';
          policy: DashboardModerationPolicy;
      }
    | DashboardModerationErrorResult;

type DashboardModerationErrorResult =
    | { type: 'auth-required' }
    | { type: 'not-found' }
    | { type: 'deployment-config-not-found' }
    | { type: 'database-error' }
    | { type: 'guild-lookup-failed' };

type AuthorizedGuildPageData = Extract<DashboardGuildPageDataResult, { type: 'guild' }>;

const recentModerationCaseLimit = 50;
const dashboardModerationFeature = 'moderation';
const moderationPolicyUpdatedAction = 'policy.updated';

export async function loadDashboardModerationCases(
    request: Request,
    guildId: string
): Promise<DashboardModerationCasesResult> {
    const guildPageData = await loadDashboardGuildPageData(request, guildId);

    if (guildPageData.type !== 'guild') {
        return mapDashboardGuildPageError(guildPageData);
    }

    const casesResult = await listModerationCasesByGuildId(getWebDatabaseClient().db, {
        guildId: guildPageData.guild.id,
        limit: recentModerationCaseLimit,
    });

    if (casesResult.isErr()) {
        return { type: 'database-error' };
    }

    return {
        type: 'cases',
        cases: casesResult.value.map(toDashboardModerationCase),
    };
}

export async function loadDashboardModerationPolicy(
    request: Request,
    guildId: string
): Promise<DashboardModerationPolicyResult> {
    const guildPageData = await loadDashboardGuildPageData(request, guildId);

    if (guildPageData.type !== 'guild') {
        return mapDashboardGuildPageError(guildPageData);
    }

    const policyResult = await findGuildModerationPolicyByGuildId(getWebDatabaseClient().db, {
        guildId: guildPageData.guild.id,
    });

    if (policyResult.isOk()) {
        return {
            type: 'policy',
            policy: toDashboardModerationPolicy(policyResult.value),
        };
    }

    if (policyResult.error.type === 'not-found') {
        return {
            type: 'policy',
            policy: {
                protectedUserIds: [],
                protectedRoleIds: [],
            },
        };
    }

    return { type: 'database-error' };
}

export async function updateDashboardModerationPolicy(
    request: Request,
    input: DashboardModerationPolicyUpdateInput
): Promise<DashboardModerationPolicyUpdateResult> {
    const guildPageData = await loadDashboardGuildPageData(request, input.guildId);

    if (guildPageData.type !== 'guild') {
        return mapDashboardGuildPageError(guildPageData);
    }

    const actorResult = await resolveModerationPolicyActor(request);

    if (actorResult.type !== 'actor') {
        return actorResult;
    }

    const protectedUserIds = normalizeIdList(input.protectedUserIds ?? []);
    const protectedRoleIds = normalizeIdList(input.protectedRoleIds ?? []);
    const database = getWebDatabaseClient();
    const policyResult = await upsertGuildModerationPolicy(database.db, {
        guildId: guildPageData.guild.id,
        protectedUserIds,
        protectedRoleIds,
    });

    if (policyResult.isErr()) {
        return { type: 'database-error' };
    }

    const auditResult = await recordBotActionEvent(database.db, {
        guildId: guildPageData.guild.id,
        feature: dashboardModerationFeature,
        action: moderationPolicyUpdatedAction,
        actorUserId: actorResult.actorUserId,
        targetId: guildPageData.guild.id,
        metadata: {
            protectedUserCount: protectedUserIds.length,
            protectedRoleCount: protectedRoleIds.length,
            source: 'dashboard',
            ...actorResult.metadata,
        },
    });

    if (auditResult.isErr()) {
        return { type: 'database-error' };
    }

    return {
        type: 'updated',
        policy: toDashboardModerationPolicy(policyResult.value),
    };
}

function toDashboardModerationCase(record: ModerationCaseRecord): DashboardModerationCase {
    return {
        caseNumber: record.caseNumber,
        action: record.action,
        status: record.status,
        targetType: record.targetType,
        ...(record.targetUserId ? { targetUserId: record.targetUserId } : {}),
        ...(record.targetChannelId ? { targetChannelId: record.targetChannelId } : {}),
        ...(record.actorUserId ? { actorUserId: record.actorUserId } : {}),
        ...(record.reason ? { reason: record.reason } : {}),
        createdAt: record.createdAt.toISOString(),
        updatedAt: record.updatedAt.toISOString(),
    };
}

function toDashboardModerationPolicy(record: GuildModerationPolicyRecord): DashboardModerationPolicy {
    return {
        protectedUserIds: record.protectedUserIds,
        protectedRoleIds: record.protectedRoleIds,
        updatedAt: record.updatedAt.toISOString(),
    };
}

function mapDashboardGuildPageError(
    guildPageData: Exclude<DashboardGuildPageDataResult, AuthorizedGuildPageData>
): DashboardModerationErrorResult {
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

type ModerationPolicyActor =
    | {
          type: 'actor';
          actorUserId: string;
          metadata: Record<string, string>;
      }
    | { type: 'auth-required' }
    | { type: 'database-error' };

async function resolveModerationPolicyActor(request: Request): Promise<ModerationPolicyActor> {
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

function normalizeIdList(values: readonly string[]): string[] {
    return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

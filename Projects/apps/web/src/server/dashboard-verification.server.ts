import '@tanstack/react-start/server-only';

import { loadWebConfig } from '@neonflux/config';
import {
    deleteVerificationFlow,
    listVerificationFlowsByGuildId,
    recordBotActionEvent,
    upsertVerificationFlow,
} from '@neonflux/db';
import type { VerificationFlowRecord } from '@neonflux/db';
import { readFluxerBotGuildStructure } from '@neonflux/fluxer';
import { getFluxerCurrentUser } from '@neonflux/fluxer/users';

import { getWebDatabaseClient } from './database.server.js';
import type { DashboardGuildPageDataResult } from './dashboard-guild-page.server.js';
import { loadDashboardGuildPageData } from './dashboard-guild-page.server.js';
import { readAuthenticatedFluxerContext } from './fluxer-auth-context.server.js';

export type DashboardVerificationRole = {
    id: string;
    name: string;
    position: number;
};

type DashboardVerificationChannel = {
    id: string;
    name: string;
    type: number;
    parentId?: string;
    parentName?: string;
    position?: number;
};

export type DashboardVerificationFlow = {
    id: string;
    channelId: string;
    channelName?: string;
    messageId: string;
    emojiKey: string;
    verifiedRoleId: string;
    verifiedRoleName?: string;
    enabled: boolean;
    updatedAt: string;
};

type DashboardVerificationReadStatus = 'available' | 'bot-token-missing' | 'fetch-failed';

export type DashboardVerificationSettingsResult =
    | {
          type: 'settings';
          roles: DashboardVerificationRole[];
          channels: DashboardVerificationChannel[];
          structureReadStatus: DashboardVerificationReadStatus;
          flows: DashboardVerificationFlow[];
      }
    | DashboardVerificationErrorResult;

export type DashboardVerificationFlowUpdateInput = {
    guildId: string;
    channelId: string;
    messageId: string;
    emojiKey: string;
    verifiedRoleId: string;
    enabled?: boolean;
};

export type DashboardVerificationFlowDeleteInput = {
    guildId: string;
    messageId: string;
};

export type DashboardVerificationFlowUpdateResult =
    | { type: 'updated'; flow: DashboardVerificationFlow }
    | { type: 'invalid-input'; field: string }
    | DashboardVerificationErrorResult;

export type DashboardVerificationFlowDeleteResult =
    | { type: 'deleted'; flow: DashboardVerificationFlow }
    | { type: 'invalid-input'; field: string }
    | DashboardVerificationErrorResult;

type DashboardVerificationErrorResult =
    | { type: 'auth-required' }
    | { type: 'not-found' }
    | { type: 'deployment-config-not-found' }
    | { type: 'database-error' }
    | { type: 'guild-lookup-failed' };
type DashboardVerificationMutationErrorResult =
    | { type: 'invalid-input'; field: string }
    | DashboardVerificationErrorResult;

type AuthorizedGuildPageData = Extract<DashboardGuildPageDataResult, { type: 'guild' }>;

const dashboardVerificationFeature = 'verification';
const textChannelTypes = new Set([0, 5]);

export async function loadDashboardVerificationSettings(
    request: Request,
    guildId: string
): Promise<DashboardVerificationSettingsResult> {
    const guildPageData = await loadDashboardGuildPageData(request, guildId);

    if (guildPageData.type !== 'guild') {
        return mapDashboardGuildPageError(guildPageData);
    }

    const flowsResult = await listVerificationFlowsByGuildId(getWebDatabaseClient().db, {
        guildId: guildPageData.guild.id,
    });

    if (flowsResult.isErr()) {
        return { type: 'database-error' };
    }

    const structureResult = await loadVerificationStructure(guildPageData.guild.id);

    return {
        type: 'settings',
        roles: structureResult.roles,
        channels: structureResult.channels,
        structureReadStatus: structureResult.status,
        flows: flowsResult.value.map((flow) =>
            toDashboardVerificationFlow(flow, structureResult.rolesById, structureResult.channelsById)
        ),
    };
}

export async function updateDashboardVerificationFlow(
    request: Request,
    input: DashboardVerificationFlowUpdateInput
): Promise<DashboardVerificationFlowUpdateResult> {
    const guildPageData = await loadDashboardGuildPageData(request, input.guildId);

    if (guildPageData.type !== 'guild') {
        return mapDashboardGuildPageError(guildPageData);
    }

    const actorResult = await resolveVerificationActor(request);

    if (actorResult.type !== 'actor') {
        return actorResult;
    }

    const database = getWebDatabaseClient();
    const flowResult = await upsertVerificationFlow(database.db, {
        guildId: guildPageData.guild.id,
        channelId: input.channelId,
        messageId: input.messageId,
        emojiKey: input.emojiKey,
        verifiedRoleId: input.verifiedRoleId,
        enabled: input.enabled ?? true,
    });

    if (flowResult.isErr()) {
        return mapVerificationRepositoryError(flowResult.error);
    }

    const structureResult = await loadVerificationStructure(guildPageData.guild.id);
    const flow = toDashboardVerificationFlow(flowResult.value, structureResult.rolesById, structureResult.channelsById);
    const auditResult = await recordVerificationAuditEvent(database.db, guildPageData, actorResult, {
        action: 'flow.updated',
        targetId: flow.messageId,
        metadata: {
            channelId: flow.channelId,
            ...(flow.channelName ? { channelName: flow.channelName } : {}),
            messageId: flow.messageId,
            emojiKey: flow.emojiKey,
            verifiedRoleId: flow.verifiedRoleId,
            ...(flow.verifiedRoleName ? { verifiedRoleName: flow.verifiedRoleName } : {}),
            enabled: flow.enabled,
        },
    });

    if (auditResult === 'database-error') {
        return { type: 'database-error' };
    }

    return {
        type: 'updated',
        flow,
    };
}

export async function deleteDashboardVerificationFlow(
    request: Request,
    input: DashboardVerificationFlowDeleteInput
): Promise<DashboardVerificationFlowDeleteResult> {
    const guildPageData = await loadDashboardGuildPageData(request, input.guildId);

    if (guildPageData.type !== 'guild') {
        return mapDashboardGuildPageError(guildPageData);
    }

    const actorResult = await resolveVerificationActor(request);

    if (actorResult.type !== 'actor') {
        return actorResult;
    }

    const database = getWebDatabaseClient();
    const flowResult = await deleteVerificationFlow(database.db, {
        guildId: guildPageData.guild.id,
        messageId: input.messageId,
    });

    if (flowResult.isErr()) {
        return mapVerificationRepositoryError(flowResult.error);
    }

    const structureResult = await loadVerificationStructure(guildPageData.guild.id);
    const flow = toDashboardVerificationFlow(flowResult.value, structureResult.rolesById, structureResult.channelsById);
    const auditResult = await recordVerificationAuditEvent(database.db, guildPageData, actorResult, {
        action: 'flow.deleted',
        targetId: flow.messageId,
        metadata: {
            channelId: flow.channelId,
            ...(flow.channelName ? { channelName: flow.channelName } : {}),
            messageId: flow.messageId,
            emojiKey: flow.emojiKey,
            verifiedRoleId: flow.verifiedRoleId,
            ...(flow.verifiedRoleName ? { verifiedRoleName: flow.verifiedRoleName } : {}),
        },
    });

    if (auditResult === 'database-error') {
        return { type: 'database-error' };
    }

    return {
        type: 'deleted',
        flow,
    };
}

async function loadVerificationStructure(guildId: string): Promise<{
    status: DashboardVerificationReadStatus;
    roles: DashboardVerificationRole[];
    channels: DashboardVerificationChannel[];
    rolesById: Map<string, DashboardVerificationRole>;
    channelsById: Map<string, DashboardVerificationChannel>;
}> {
    const botToken = loadWebConfig().fluxerBotToken;

    if (!botToken) {
        return emptyVerificationStructure('bot-token-missing');
    }

    const structureResult = await readFluxerBotGuildStructure({
        botToken,
        guildId,
    });

    if (structureResult.isErr()) {
        return emptyVerificationStructure('fetch-failed');
    }

    const roles = structureResult.value.roles
        .filter((role) => role.name !== '@everyone')
        .map((role) => ({
            id: role.id,
            name: role.name,
            position: role.position,
        }))
        .sort((left, right) => right.position - left.position || left.name.localeCompare(right.name));
    const categoryNameById = new Map(structureResult.value.categories.map((category) => [category.id, category.name]));
    const channels = structureResult.value.channels
        .filter((channel) => textChannelTypes.has(channel.type))
        .map((channel): DashboardVerificationChannel => {
            const parentName = channel.parentId ? categoryNameById.get(channel.parentId) : undefined;

            return {
                id: channel.id,
                name: channel.name ?? channel.id,
                type: channel.type,
                ...(channel.parentId ? { parentId: channel.parentId } : {}),
                ...(parentName ? { parentName } : {}),
                ...(channel.position !== null ? { position: channel.position } : {}),
            };
        })
        .sort(compareVerificationChannels);

    return {
        status: 'available',
        roles,
        channels,
        rolesById: new Map(roles.map((role) => [role.id, role])),
        channelsById: new Map(channels.map((channel) => [channel.id, channel])),
    };
}

function emptyVerificationStructure(status: Exclude<DashboardVerificationReadStatus, 'available'>) {
    return {
        status,
        roles: [],
        channels: [],
        rolesById: new Map<string, DashboardVerificationRole>(),
        channelsById: new Map<string, DashboardVerificationChannel>(),
    };
}

function toDashboardVerificationFlow(
    record: VerificationFlowRecord,
    rolesById: ReadonlyMap<string, DashboardVerificationRole>,
    channelsById: ReadonlyMap<string, DashboardVerificationChannel>
): DashboardVerificationFlow {
    const role = rolesById.get(record.verifiedRoleId);
    const channel = channelsById.get(record.channelId);

    return {
        id: record.id,
        channelId: record.channelId,
        ...(channel ? { channelName: channel.name } : {}),
        messageId: record.messageId,
        emojiKey: record.emojiKey,
        verifiedRoleId: record.verifiedRoleId,
        ...(role ? { verifiedRoleName: role.name } : {}),
        enabled: record.enabled,
        updatedAt: record.updatedAt.toISOString(),
    };
}

function compareVerificationChannels(left: DashboardVerificationChannel, right: DashboardVerificationChannel): number {
    const leftCategory = left.parentName ?? '';
    const rightCategory = right.parentName ?? '';

    if (leftCategory !== rightCategory) {
        return leftCategory.localeCompare(rightCategory);
    }

    return (left.position ?? 0) - (right.position ?? 0) || left.name.localeCompare(right.name);
}

function mapDashboardGuildPageError(
    guildPageData: Exclude<DashboardGuildPageDataResult, AuthorizedGuildPageData>
): DashboardVerificationErrorResult {
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

function mapVerificationRepositoryError(error: {
    type: string;
    field?: string;
}): DashboardVerificationMutationErrorResult {
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

type VerificationActor =
    | {
          type: 'actor';
          actorUserId: string;
          metadata: Record<string, string>;
      }
    | { type: 'auth-required' }
    | { type: 'database-error' };

async function resolveVerificationActor(request: Request): Promise<VerificationActor> {
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

async function recordVerificationAuditEvent(
    db: Parameters<typeof recordBotActionEvent>[0],
    guildPageData: AuthorizedGuildPageData,
    actor: Extract<VerificationActor, { type: 'actor' }>,
    input: {
        action: string;
        targetId: string;
        metadata: Record<string, string | number | boolean | null | undefined>;
    }
): Promise<'recorded' | 'database-error'> {
    const rawMetadata: Record<string, string | number | boolean | null | undefined> = {
        ...input.metadata,
        source: 'dashboard',
        ...actor.metadata,
    };
    const metadataEntries = Object.entries(rawMetadata).filter((entry) => entry[1] !== undefined) as Array<
        [string, string | number | boolean | null]
    >;
    const result = await recordBotActionEvent(db, {
        guildId: guildPageData.guild.id,
        feature: dashboardVerificationFeature,
        action: input.action,
        actorUserId: actor.actorUserId,
        targetId: input.targetId,
        metadata: Object.fromEntries(metadataEntries),
    });

    return result.isOk() ? 'recorded' : 'database-error';
}

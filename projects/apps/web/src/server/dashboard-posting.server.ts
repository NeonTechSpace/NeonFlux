import '@tanstack/react-start/server-only';

import {
    listDashboardPostingOperationsByGuild,
    normalizeDashboardPostingPayload as normalizeDashboardPostingPayloadForQueue,
    resolveDashboardPostingOperationUnknown,
} from '@neonflux/db';
import type { DashboardPostingOperationRecord } from '@neonflux/db';
import { hashDashboardPostingPayload, parseOutgoingMessage } from '@neonflux/messaging';
import type { DashboardPostingOperationResolution, OutgoingEmbed, OutgoingMessage } from '@neonflux/messaging';
import type { FluxerGuildChannel, FluxerGuildRole } from '@neonflux/fluxer/guild-structure';
import type { FluxerReactionRoleCatalog } from '@neonflux/fluxer/reaction-roles';
import { getFluxerCurrentUser } from '@neonflux/fluxer/users';
import type { FluxerCurrentUser } from '@neonflux/fluxer/users';

import {
    readDashboardBotGuildStructure,
    readDashboardBotReactionRoleCatalog,
    wakeDashboardBotPostingWorker,
} from './bot-internal-api-client.server.js';
import { getWebDb } from './db.server.js';
import { readAuthenticatedFluxerContext } from './fluxer-auth-context.server.js';
import type { DashboardGuildPageDataResult } from './dashboard-guild-page.server.js';
import { loadDashboardGuildPageData } from './dashboard-guild-page.server.js';
import { authorizeDashboardPostingTarget } from './dashboard-posting-authorization.server.js';
import { enqueueAuthorizedDashboardPostingOperation } from './dashboard-posting-delegation.server.js';
import { createDashboardPostingRequestTiming } from './dashboard-posting-observability.server.js';
import {
    recordDashboardPostingWakeFailure,
    recordDashboardPostingWakeSuccess,
} from './dashboard-posting-wake-observability.server.js';

export type DashboardPostMessageInput = {
    guildId: string;
    channelId: string;
    content?: string;
    embeds?: OutgoingEmbed[];
    requestKey: string;
    retryOfOperationId?: string;
};

export type DashboardPostingChannel = {
    id: string;
    name: string;
    type: number;
    parentId?: string;
    parentName?: string;
    position?: number;
};

export type DashboardPostingRole = {
    id: string;
    name: string;
    color: number;
};

export type DashboardPostingEmoji = FluxerReactionRoleCatalog['emojis'][number];

type DashboardPostingCatalog = {
    channels: DashboardPostingChannel[];
    emojis: DashboardPostingEmoji[];
    roles: DashboardPostingRole[];
};

export type DashboardPostMessageResult =
    | {
          type: 'operation';
          operation: DashboardPostingOperation;
      }
    | {
          type: 'invalid-message';
          message: string;
      }
    | { type: 'auth-required' }
    | { type: 'not-found' }
    | { type: 'deployment-config-not-found' }
    | { type: 'database-error' }
    | { type: 'guild-lookup-failed' }
    | { type: 'request-conflict' };

export type DashboardPostingOperation = {
    id: string;
    attemptCount: number;
    completedAt?: string;
    contentLength: number;
    createdAt: string;
    embedCount: number;
    errorCode?: string;
    followupOperationId?: string;
    messageId?: string;
    requestKey: string;
    requestedChannelId: string;
    resolution?: DashboardPostingOperationResolution;
    resolvedAt?: string;
    resolvedByUserId?: string;
    retryOfOperationId?: string;
    sentChannelId?: string;
    status: DashboardPostingOperationRecord['status'];
    updatedAt: string;
};

export type DashboardPostingOperationsResult =
    | { type: 'operations'; operations: DashboardPostingOperation[] }
    | { type: 'auth-required' }
    | { type: 'not-found' }
    | { type: 'deployment-config-not-found' }
    | { type: 'database-error' }
    | { type: 'guild-lookup-failed' };

export type DashboardPostingCatalogResult =
    | {
          type: 'catalog';
          catalog: DashboardPostingCatalog;
      }
    | { type: 'auth-required' }
    | { type: 'not-found' }
    | { type: 'deployment-config-not-found' }
    | { type: 'database-error' }
    | { type: 'guild-lookup-failed' }
    | { type: 'bot-token-missing' };

type AuthorizedGuildPageData = Extract<DashboardGuildPageDataResult, { type: 'guild' }>;

type DashboardGuildPageErrorResult =
    | { type: 'auth-required' }
    | { type: 'not-found' }
    | { type: 'deployment-config-not-found' }
    | { type: 'database-error' }
    | { type: 'guild-lookup-failed' };

type NormalizedPostMessagePayload = {
    channelId: string;
    message: OutgoingMessage;
};

export type DashboardPostingUnknownResolutionResult =
    | { type: 'resolved'; operation: DashboardPostingOperation }
    | { type: 'resolution-conflict' }
    | { type: 'auth-required' }
    | { type: 'not-found' }
    | { type: 'deployment-config-not-found' }
    | { type: 'database-error' }
    | { type: 'guild-lookup-failed' };

const postableChannelTypes = new Set([0]);

export async function postDashboardGuildMessage(
    request: Request,
    input: DashboardPostMessageInput
): Promise<DashboardPostMessageResult> {
    const timing = createDashboardPostingRequestTiming();
    const authContextResult = await timing.measureAsync('authContextMs', () => readAuthenticatedFluxerContext(request));

    if (authContextResult.isErr()) {
        if (authContextResult.error === 'database-error') {
            timing.finish('database_error');
            return { type: 'database-error' };
        }

        timing.finish('auth_required');
        return { type: 'auth-required' };
    }

    const targetAuthorizationResult = await timing.measureAsync('targetAuthorizationMs', () =>
        authorizeDashboardPostingTarget(authContextResult.value, input.guildId)
    );

    if (targetAuthorizationResult.isErr()) {
        timing.finish(toPostingRequestResultClass(targetAuthorizationResult.error));
        return { type: targetAuthorizationResult.error };
    }

    const validationResult = await timing.measureAsync('validationMs', () => normalizeDashboardPostingRequest(input));

    if (validationResult.type === 'invalid-message') {
        timing.finish('invalid_message');
        return validationResult;
    }

    const enqueueResult = await timing.measureAsync('enqueueMs', async () => {
        return enqueueAuthorizedDashboardPostingOperation({
            actorUserId: authContextResult.value.fluxerUserId,
            ...(validationResult.payload.message.content ? { content: validationResult.payload.message.content } : {}),
            embeds: validationResult.payload.message.embeds,
            guildId: targetAuthorizationResult.value.guild.id,
            payloadHash: validationResult.payloadHash,
            requestKey: validationResult.requestKey,
            requestedChannelId: validationResult.payload.channelId,
            ...(input.retryOfOperationId ? { retryOfOperationId: input.retryOfOperationId } : {}),
        });
    });

    if (enqueueResult.isErr()) {
        if (enqueueResult.error.type === 'conflict') {
            timing.finish('request_conflict');
            return { type: 'request-conflict' };
        }

        timing.finish('database_error');
        return { type: 'database-error' };
    }

    if (enqueueResult.value.operation.status === 'queued') {
        let wakeFailure: Parameters<typeof recordDashboardPostingWakeFailure>[0] | undefined;

        await timing.measureAsync('wakeMs', async () => {
            try {
                const wakeResult = await wakeDashboardBotPostingWorker();
                wakeResult.match(
                    () => recordDashboardPostingWakeSuccess(),
                    (error) => {
                        wakeFailure = error;
                    }
                );
            } catch {
                wakeFailure = 'unexpected-failure';
            }
        });

        if (wakeFailure) {
            recordDashboardPostingWakeFailure(wakeFailure, timing.getDuration('wakeMs') ?? 0);
        }
    }

    const operation = toDashboardPostingOperation(enqueueResult.value.operation);
    timing.finish('operation', operation.id);
    return { type: 'operation', operation };
}

async function normalizeDashboardPostingRequest(
    input: DashboardPostMessageInput
): Promise<
    | { type: 'valid'; payload: NormalizedPostMessagePayload; payloadHash: string; requestKey: string }
    | { type: 'invalid-message'; message: string }
> {
    const payloadResult = normalizePostMessagePayload(input);

    if (payloadResult.type === 'invalid-message') {
        return payloadResult;
    }

    const queuePayload = normalizeDashboardPostingPayloadForQueue(payloadResult.payload.message);
    if (queuePayload.isErr()) {
        return {
            type: 'invalid-message',
            message: 'Message content or embed fields are invalid or exceed the supported limits.',
        };
    }

    const requestKey = input.requestKey.trim();
    if (!requestKey || requestKey.length > 128) {
        return { type: 'invalid-message', message: 'Start a new posting attempt and try again.' };
    }

    const payload: NormalizedPostMessagePayload = {
        channelId: payloadResult.payload.channelId,
        message: queuePayload.value,
    };

    return {
        type: 'valid',
        payload,
        payloadHash: await hashDashboardPostingPayload(payload.channelId, payload.message),
        requestKey,
    };
}

function toPostingRequestResultClass(
    error: 'not-found' | 'deployment-config-not-found' | 'database-error' | 'guild-lookup-failed'
) {
    switch (error) {
        case 'not-found':
            return 'not_found' as const;
        case 'deployment-config-not-found':
            return 'deployment_config_not_found' as const;
        case 'database-error':
            return 'database_error' as const;
        case 'guild-lookup-failed':
            return 'guild_lookup_failed' as const;
    }
}

export async function resolveDashboardGuildPostingUnknown(
    request: Request,
    input: {
        guildId: string;
        operationId: string;
        resolution: Exclude<DashboardPostingOperationResolution, 'duplicate_risk_accepted'>;
    }
): Promise<DashboardPostingUnknownResolutionResult> {
    const guildPageData = await loadDashboardGuildPageData(request, input.guildId);
    if (guildPageData.type !== 'guild') return mapDashboardGuildPageError(guildPageData);
    const authContextResult = await readAuthenticatedFluxerContext(request);
    if (authContextResult.isErr()) {
        return authContextResult.error === 'database-error' ? { type: 'database-error' } : { type: 'auth-required' };
    }
    const actorProfile = await resolveAuthenticatedActorProfile(authContextResult.value);
    const database = await getWebDb();
    const result = await resolveDashboardPostingOperationUnknown(database.db, {
        ...(actorProfile?.displayName ? { actorDisplayName: actorProfile.displayName } : {}),
        ...(actorProfile?.username ? { actorUsername: actorProfile.username } : {}),
        actorUserId: authContextResult.value.fluxerUserId,
        guildId: guildPageData.guild.id,
        operationId: input.operationId,
        resolution: input.resolution,
    });
    if (result.isErr()) {
        return result.error.type === 'conflict' ? { type: 'resolution-conflict' } : { type: 'database-error' };
    }
    return { type: 'resolved', operation: toDashboardPostingOperation(result.value) };
}

export async function loadDashboardGuildPostingCatalog(
    request: Request,
    guildId: string
): Promise<DashboardPostingCatalogResult> {
    const guildPageData = await loadDashboardGuildPageData(request, guildId);

    if (guildPageData.type !== 'guild') {
        return mapDashboardGuildPageError(guildPageData);
    }

    const [structureResult, reactionRoleCatalogResult] = await Promise.all([
        readDashboardBotGuildStructure(guildPageData.guild.id),
        readDashboardBotReactionRoleCatalog(guildPageData.guild.id),
    ]);

    if (structureResult.isErr() || reactionRoleCatalogResult.isErr()) {
        return structureResult.isErr() && structureResult.error === 'not-configured'
            ? { type: 'bot-token-missing' }
            : { type: 'guild-lookup-failed' };
    }

    return {
        type: 'catalog',
        catalog: {
            channels: toDashboardPostingChannels(structureResult.value.channels, structureResult.value.categories),
            emojis: reactionRoleCatalogResult.value.emojis,
            roles: toDashboardPostingRoles(structureResult.value.roles),
        },
    };
}

export async function loadDashboardGuildPostingOperations(
    request: Request,
    guildId: string
): Promise<DashboardPostingOperationsResult> {
    const guildPageData = await loadDashboardGuildPageData(request, guildId);
    if (guildPageData.type !== 'guild') return mapDashboardGuildPageError(guildPageData);

    const database = await getWebDb();
    const operations = await listDashboardPostingOperationsByGuild(database.db, {
        guildId: guildPageData.guild.id,
        limit: 20,
    });
    return operations.isErr()
        ? { type: 'database-error' }
        : { type: 'operations', operations: operations.value.map(toDashboardPostingOperation) };
}

function normalizePostMessagePayload(
    input: DashboardPostMessageInput
): { type: 'valid'; payload: NormalizedPostMessagePayload } | { type: 'invalid-message'; message: string } {
    const channelId = input.channelId.trim();

    if (!channelId) {
        return {
            type: 'invalid-message',
            message: 'Choose a channel before sending.',
        };
    }

    const message = parseOutgoingMessage({
        ...(input.content === undefined ? {} : { content: input.content }),
        embeds: input.embeds ?? [],
    });
    if (message.isErr()) return { type: 'invalid-message', message: describeOutgoingMessageError(message.error.code) };

    return {
        type: 'valid',
        payload: {
            channelId,
            message: message.value,
        },
    };
}

function mapDashboardGuildPageError(
    guildPageData: Exclude<DashboardGuildPageDataResult, AuthorizedGuildPageData>
): DashboardGuildPageErrorResult {
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

type DashboardPostingActorProfile = {
    id: string;
    username: string;
    displayName?: string;
};

async function resolveAuthenticatedActorProfile(input: {
    fluxerUserId: string;
    accessToken: string;
}): Promise<DashboardPostingActorProfile | undefined> {
    const currentUserResult = await getFluxerCurrentUser({
        accessToken: input.accessToken,
    });

    if (currentUserResult.isErr() || currentUserResult.value.id !== input.fluxerUserId) {
        return undefined;
    }

    return toDashboardPostingActorProfile(currentUserResult.value);
}

function toDashboardPostingActorProfile(user: FluxerCurrentUser): DashboardPostingActorProfile {
    return {
        id: user.id,
        username: user.username,
        ...(user.globalName ? { displayName: user.globalName } : {}),
    };
}

function toDashboardPostingChannels(
    channels: FluxerGuildChannel[],
    categories: FluxerGuildChannel[]
): DashboardPostingChannel[] {
    const categoryNameById = new Map(categories.map((category) => [category.id, category.name ?? category.id]));

    return channels
        .filter((channel) => postableChannelTypes.has(channel.type))
        .map((channel) => ({
            id: channel.id,
            name: channel.name ?? channel.id,
            type: channel.type,
            ...(channel.parentId ? { parentId: channel.parentId } : {}),
            ...(channel.parentId && categoryNameById.has(channel.parentId)
                ? { parentName: categoryNameById.get(channel.parentId) }
                : {}),
            ...(channel.position !== null ? { position: channel.position } : {}),
        }))
        .sort(compareDashboardPostingChannels);
}

function toDashboardPostingRoles(roles: FluxerGuildRole[]): DashboardPostingRole[] {
    return roles.map((role) => ({
        id: role.id,
        name: role.name,
        color: role.color,
    }));
}

function toDashboardPostingOperation(operation: DashboardPostingOperationRecord): DashboardPostingOperation {
    return {
        id: operation.id,
        attemptCount: operation.attemptCount,
        ...(operation.completedAt ? { completedAt: operation.completedAt.toISOString() } : {}),
        contentLength: operation.contentLength,
        createdAt: operation.createdAt.toISOString(),
        embedCount: operation.embedCount,
        ...(operation.errorCode ? { errorCode: operation.errorCode } : {}),
        ...(operation.followupOperationId ? { followupOperationId: operation.followupOperationId } : {}),
        ...(operation.messageId ? { messageId: operation.messageId } : {}),
        requestKey: operation.requestKey,
        requestedChannelId: operation.requestedChannelId,
        ...(operation.resolution ? { resolution: operation.resolution } : {}),
        ...(operation.resolvedAt ? { resolvedAt: operation.resolvedAt.toISOString() } : {}),
        ...(operation.resolvedByUserId ? { resolvedByUserId: operation.resolvedByUserId } : {}),
        ...(operation.retryOfOperationId ? { retryOfOperationId: operation.retryOfOperationId } : {}),
        ...(operation.sentChannelId ? { sentChannelId: operation.sentChannelId } : {}),
        status: operation.status,
        updatedAt: operation.updatedAt.toISOString(),
    };
}

function compareDashboardPostingChannels(left: DashboardPostingChannel, right: DashboardPostingChannel): number {
    const leftCategory = left.parentName ?? '';
    const rightCategory = right.parentName ?? '';

    if (leftCategory !== rightCategory) {
        return leftCategory.localeCompare(rightCategory);
    }

    return (left.position ?? 0) - (right.position ?? 0) || left.name.localeCompare(right.name);
}

function describeOutgoingMessageError(code: string): string {
    switch (code) {
        case 'empty-message':
            return 'Add message content or at least one embed.';
        case 'too-long':
        case 'too-many':
        case 'payload-too-large':
            return 'The message exceeds the supported Fluxer message or embed limits.';
        default:
            return 'The message contains an unsupported or invalid embed value.';
    }
}

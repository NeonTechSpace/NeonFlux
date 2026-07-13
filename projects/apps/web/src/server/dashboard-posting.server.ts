import '@tanstack/react-start/server-only';

import { createHash } from 'node:crypto';

import { loadWebConfig } from '@neonflux/config';
import {
    enqueueDashboardPostingOperation,
    listBotActionEventPageByGuildId,
    listDashboardPostingOperationsByGuild,
    normalizeDashboardPostingPayload as normalizeDashboardPostingPayloadForQueue,
} from '@neonflux/db';
import type { BotActionEventSearchScope, DashboardPostingOperationRecord } from '@neonflux/db';
import { readFluxerBotGuildStructure } from '@neonflux/fluxer/guild-structure';
import type { FluxerGuildChannel } from '@neonflux/fluxer/guild-structure';
import { getFluxerCurrentUser } from '@neonflux/fluxer/users';
import type { FluxerCurrentUser } from '@neonflux/fluxer/users';

import { getWebDb } from './db.server.js';
import { readAuthenticatedFluxerContext } from './fluxer-auth-context.server.js';
import type { DashboardGuildPageDataResult } from './dashboard-guild-page.server.js';
import { loadDashboardGuildPageData } from './dashboard-guild-page.server.js';

export type DashboardPostMessageInput = {
    guildId: string;
    channelId: string;
    content?: string;
    embeds?: unknown[];
    requestKey: string;
};

export type DashboardPostingChannel = {
    id: string;
    name: string;
    type: number;
    parentId?: string;
    parentName?: string;
    position?: number;
};

type DashboardAuditMetadata = Record<string, string | number | boolean | null>;
export type DashboardAuditSearchScope = BotActionEventSearchScope;

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
    messageId?: string;
    requestKey: string;
    requestedChannelId: string;
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

export type DashboardAuditEvent = {
    id: string;
    feature: string;
    action: string;
    actorUserId?: string;
    actorUsername?: string;
    actorDisplayName?: string;
    targetId?: string;
    metadata: DashboardAuditMetadata;
    createdAt: string;
};

export type DashboardAuditEventsResult =
    | {
          type: 'events';
          auditEvents: DashboardAuditEvent[];
          nextCursor?: string;
      }
    | { type: 'auth-required' }
    | { type: 'not-found' }
    | { type: 'deployment-config-not-found' }
    | { type: 'database-error' }
    | { type: 'guild-lookup-failed' };

export type DashboardPostingChannelsResult =
    | {
          type: 'channels';
          channels: DashboardPostingChannel[];
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
    content?: string;
    embeds: unknown[];
};

type DashboardAuditEventsInput = {
    guildId: string;
    cursor?: string;
    limit?: number;
    search?: string;
    searchScope?: DashboardAuditSearchScope;
    searchOffsetMinutes?: number;
};

const postableChannelTypes = new Set([0]);
const dashboardAuditPageSize = 40;

export async function postDashboardGuildMessage(
    request: Request,
    input: DashboardPostMessageInput
): Promise<DashboardPostMessageResult> {
    const guildPageData = await loadDashboardGuildPageData(request, input.guildId);

    if (guildPageData.type !== 'guild') {
        return mapDashboardGuildPageError(guildPageData);
    }

    const authContextResult = await readAuthenticatedFluxerContext(request);

    if (authContextResult.isErr()) {
        return authContextResult.error === 'database-error' ? { type: 'database-error' } : { type: 'auth-required' };
    }

    const payloadResult = normalizePostMessagePayload(input);

    if (payloadResult.type === 'invalid-message') {
        return payloadResult;
    }

    const queuePayload = normalizeDashboardPostingPayloadForQueue(payloadResult.payload);
    if (queuePayload.isErr()) {
        return { type: 'invalid-message', message: 'Message content and embeds must be valid JSON under 128 KiB.' };
    }
    const payload: NormalizedPostMessagePayload = {
        channelId: payloadResult.payload.channelId,
        ...queuePayload.value,
    };
    const requestKey = input.requestKey.trim();

    if (!requestKey || requestKey.length > 128) {
        return { type: 'invalid-message', message: 'Start a new posting attempt and try again.' };
    }

    const actorProfile = await resolveAuthenticatedActorProfile(authContextResult.value);
    const database = await getWebDb();
    const payloadHash = hashDashboardPostingPayload(payload);
    const enqueueResult = await enqueueDashboardPostingOperation(database.db, {
        ...(actorProfile?.displayName ? { actorDisplayName: actorProfile.displayName } : {}),
        ...(actorProfile?.username ? { actorUsername: actorProfile.username } : {}),
        actorUserId: authContextResult.value.fluxerUserId,
        ...(payload.content ? { content: payload.content } : {}),
        embeds: payload.embeds,
        guildId: guildPageData.guild.id,
        payloadHash,
        requestKey,
        requestedChannelId: payload.channelId,
    });

    if (enqueueResult.isErr()) {
        return enqueueResult.error.type === 'conflict' ? { type: 'request-conflict' } : { type: 'database-error' };
    }

    return { type: 'operation', operation: toDashboardPostingOperation(enqueueResult.value.operation) };
}

function hashDashboardPostingPayload(payload: NormalizedPostMessagePayload): string {
    return createHash('sha256')
        .update(
            JSON.stringify({
                channelId: payload.channelId,
                content: payload.content ?? null,
                embeds: payload.embeds,
            })
        )
        .digest('hex');
}

export async function loadDashboardGuildAuditEventsPage(
    request: Request,
    input: DashboardAuditEventsInput
): Promise<DashboardAuditEventsResult> {
    const guildPageData = await loadDashboardGuildPageData(request, input.guildId);

    if (guildPageData.type !== 'guild') {
        return mapDashboardGuildPageError(guildPageData);
    }

    const cursor = normalizeDashboardAuditCursor(input.cursor);

    if (cursor === 'invalid') {
        return { type: 'database-error' };
    }

    const database = await getWebDb();
    const currentActorProfile = await resolveCurrentRequestActorProfile(request);
    const eventsResult = await listBotActionEventPageByGuildId(database.db, {
        guildId: guildPageData.guild.id,
        ...(cursor ? { cursor } : {}),
        limit: input.limit ?? dashboardAuditPageSize,
        ...(input.search ? { search: input.search } : {}),
        ...(input.searchScope ? { searchScope: input.searchScope } : {}),
        ...(typeof input.searchOffsetMinutes === 'number' ? { searchOffsetMinutes: input.searchOffsetMinutes } : {}),
    });

    if (eventsResult.isErr()) {
        return { type: 'database-error' };
    }

    return {
        type: 'events',
        auditEvents: eventsResult.value.records.map((record) => toDashboardAuditEvent(record, currentActorProfile)),
        ...(eventsResult.value.nextCursor ? { nextCursor: eventsResult.value.nextCursor } : {}),
    };
}

export async function loadDashboardGuildPostingChannels(
    request: Request,
    guildId: string
): Promise<DashboardPostingChannelsResult> {
    const guildPageData = await loadDashboardGuildPageData(request, guildId);

    if (guildPageData.type !== 'guild') {
        return mapDashboardGuildPageError(guildPageData);
    }

    const botToken = loadWebConfig().fluxerBotToken;

    if (!botToken) {
        return { type: 'bot-token-missing' };
    }

    const structureResult = await readFluxerBotGuildStructure({
        botToken,
        guildId: guildPageData.guild.id,
    });

    if (structureResult.isErr()) {
        return { type: 'guild-lookup-failed' };
    }

    return {
        type: 'channels',
        channels: toDashboardPostingChannels(structureResult.value.channels, structureResult.value.categories),
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
    const content = input.content?.trim();
    const embeds = input.embeds ?? [];

    if (!channelId) {
        return {
            type: 'invalid-message',
            message: 'Choose a channel before sending.',
        };
    }

    if (!Array.isArray(embeds) || !embeds.every(isEmbedObject)) {
        return {
            type: 'invalid-message',
            message: 'Embed JSON must be an array of embed objects.',
        };
    }

    if (!content && embeds.length === 0) {
        return {
            type: 'invalid-message',
            message: 'Add message content or at least one embed.',
        };
    }

    return {
        type: 'valid',
        payload: {
            channelId,
            ...(content ? { content } : {}),
            embeds,
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

type DashboardAuditActorProfile = {
    id: string;
    username: string;
    displayName?: string;
};

function toDashboardAuditEvent(
    record: {
        id: string;
        feature: string;
        action: string;
        actorUserId: string | null;
        targetId: string | null;
        metadata: Record<string, unknown>;
        createdAt: Date;
    },
    currentActorProfile?: DashboardAuditActorProfile
): DashboardAuditEvent {
    const metadata = toDashboardAuditMetadata(record.metadata);
    const actorUsername = resolveDashboardAuditActorUsername(record, currentActorProfile);
    const actorDisplayName = resolveDashboardAuditActorDisplayName(record, currentActorProfile);

    return {
        id: record.id,
        feature: record.feature,
        action: record.action,
        ...(record.actorUserId ? { actorUserId: record.actorUserId } : {}),
        ...(actorUsername ? { actorUsername } : {}),
        ...(actorDisplayName ? { actorDisplayName } : {}),
        ...(record.targetId ? { targetId: record.targetId } : {}),
        metadata,
        createdAt: record.createdAt.toISOString(),
    };
}

function resolveDashboardAuditActorUsername(
    record: {
        actorUserId: string | null;
        metadata: Record<string, unknown>;
    },
    currentActorProfile?: DashboardAuditActorProfile
): string | undefined {
    if (record.actorUserId && currentActorProfile?.id === record.actorUserId) {
        return currentActorProfile.username;
    }

    return getMetadataString(record.metadata.actorUsername);
}

function resolveDashboardAuditActorDisplayName(
    record: {
        actorUserId: string | null;
        metadata: Record<string, unknown>;
    },
    currentActorProfile?: DashboardAuditActorProfile
): string | undefined {
    if (record.actorUserId && currentActorProfile?.id === record.actorUserId) {
        return currentActorProfile.displayName;
    }

    return getMetadataString(record.metadata.actorDisplayName) ?? getMetadataString(record.metadata.actorGlobalName);
}

async function resolveCurrentRequestActorProfile(request: Request): Promise<DashboardAuditActorProfile | undefined> {
    const authContextResult = await readAuthenticatedFluxerContext(request);

    if (authContextResult.isErr()) {
        return undefined;
    }

    return resolveAuthenticatedActorProfile(authContextResult.value);
}

async function resolveAuthenticatedActorProfile(input: {
    fluxerUserId: string;
    accessToken: string;
}): Promise<DashboardAuditActorProfile | undefined> {
    const currentUserResult = await getFluxerCurrentUser({
        accessToken: input.accessToken,
    });

    if (currentUserResult.isErr() || currentUserResult.value.id !== input.fluxerUserId) {
        return undefined;
    }

    return toDashboardAuditActorProfile(currentUserResult.value);
}

function toDashboardAuditActorProfile(user: FluxerCurrentUser): DashboardAuditActorProfile {
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

function toDashboardPostingOperation(operation: DashboardPostingOperationRecord): DashboardPostingOperation {
    return {
        id: operation.id,
        attemptCount: operation.attemptCount,
        ...(operation.completedAt ? { completedAt: operation.completedAt.toISOString() } : {}),
        contentLength: operation.contentLength,
        createdAt: operation.createdAt.toISOString(),
        embedCount: operation.embedCount,
        ...(operation.errorCode ? { errorCode: operation.errorCode } : {}),
        ...(operation.messageId ? { messageId: operation.messageId } : {}),
        requestKey: operation.requestKey,
        requestedChannelId: operation.requestedChannelId,
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

function isEmbedObject(embed: unknown): embed is Record<string, unknown> {
    return typeof embed === 'object' && embed !== null && !Array.isArray(embed);
}

function toDashboardAuditMetadata(metadata: Record<string, unknown>): DashboardAuditMetadata {
    const serializableMetadata: DashboardAuditMetadata = {};

    for (const [key, value] of Object.entries(metadata)) {
        if (typeof value === 'string' || typeof value === 'boolean' || value === null) {
            serializableMetadata[key] = value;
            continue;
        }

        if (typeof value === 'number' && Number.isFinite(value)) {
            serializableMetadata[key] = value;
        }
    }

    return serializableMetadata;
}

function getMetadataString(value: unknown): string | undefined {
    return typeof value === 'string' && value.trim() ? value : undefined;
}

function normalizeDashboardAuditCursor(cursor: string | undefined): string | undefined | 'invalid' {
    if (!cursor) {
        return undefined;
    }

    const normalizedCursor = cursor.trim();

    return normalizedCursor ? normalizedCursor : 'invalid';
}

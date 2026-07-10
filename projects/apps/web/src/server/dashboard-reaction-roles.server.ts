import '@tanstack/react-start/server-only';

import {
    listReactionRoleMessagesByGuildId,
    listReactionRoleOperationsByGuildId,
    requestReactionRoleDeleteOperation,
    requestReactionRolePublishOperation,
    retryReactionRoleOperation,
    retryBlockedReactionRoleMemberStates,
} from '@neonflux/db';

import { getWebDb } from './db.server.js';
import { loadDashboardGuildPageData } from './dashboard-guild-page.server.js';
import { mapDashboardGuildPageError, resolveReactionRoleActor } from './dashboard-reaction-roles-audit.server.js';
import {
    createReactionRoleRequestHash,
    isValidReactionRoleIdempotencyKey,
    mapReactionRoleOperationRequestResult,
    toDashboardReactionRoleOperation,
} from './dashboard-reaction-roles-operations.server.js';
import { normalizeReactionRolePublishPayload } from './dashboard-reaction-roles-payload.js';
import {
    loadReactionRoleEmojis,
    loadReactionRoleStructure,
    toDashboardReactionRoleMessage,
} from './dashboard-reaction-roles-structure.server.js';
import type {
    DashboardReactionRoleMessageDeleteInput,
    DashboardReactionRoleMessageDeleteResult,
    DashboardReactionRoleMemberRetryResult,
    DashboardReactionRolePublishInput,
    DashboardReactionRolePublishResult,
    DashboardReactionRoleRetryResult,
    DashboardReactionRolesSettingsResult,
} from './dashboard-reaction-roles-types.js';

export { saveDashboardReactionRoleMessage } from './dashboard-reaction-roles-save.server.js';
export type * from './dashboard-reaction-roles-types.js';

export async function loadDashboardReactionRolesSettings(
    request: Request,
    guildId: string
): Promise<DashboardReactionRolesSettingsResult> {
    const guildPageData = await loadDashboardGuildPageData(request, guildId);
    if (guildPageData.type !== 'guild') return mapDashboardGuildPageError(guildPageData);
    const database = await getWebDb();
    const [messages, operations] = await Promise.all([
        listReactionRoleMessagesByGuildId(database.db, { guildId: guildPageData.guild.id }),
        listReactionRoleOperationsByGuildId(database.db, { guildId: guildPageData.guild.id, limit: 50 }),
    ]);
    if (messages.isErr() || operations.isErr()) return { type: 'database-error' };
    const structure = await loadReactionRoleStructure(guildPageData.guild.id);
    const emojiResult = await loadReactionRoleEmojis(guildPageData.guild.id);
    const emojiByKey = new Map(emojiResult.emojis.map((emoji) => [emoji.key, emoji]));
    return {
        channels: structure.channels,
        emojiReadStatus: emojiResult.status,
        emojis: emojiResult.emojis,
        messages: messages.value.map((message) =>
            toDashboardReactionRoleMessage(message, structure.rolesById, structure.channelsById, emojiByKey)
        ),
        operations: operations.value.map(toDashboardReactionRoleOperation),
        roles: structure.roles,
        structureReadStatus: structure.status,
        type: 'settings',
    };
}

export async function publishDashboardReactionRoleMessage(
    request: Request,
    input: DashboardReactionRolePublishInput
): Promise<DashboardReactionRolePublishResult> {
    const guildPageData = await loadDashboardGuildPageData(request, input.guildId);
    if (guildPageData.type !== 'guild') return mapDashboardGuildPageError(guildPageData);
    const actor = await resolveReactionRoleActor(request);
    if (actor.type !== 'actor') return actor;
    if (!isValidReactionRoleIdempotencyKey(input.idempotencyKey)) {
        return { type: 'invalid-input', field: 'idempotencyKey' };
    }
    const structure = await loadReactionRoleStructure(guildPageData.guild.id);
    if (structure.status !== 'available') {
        return structure.status === 'bot-token-missing'
            ? { type: 'bot-token-missing' }
            : { type: 'guild-lookup-failed' };
    }
    const payload = normalizeReactionRolePublishPayload(input, structure.rolesById);
    if (payload.type !== 'payload') return payload;
    if (!structure.channelsById.has(payload.channelId)) return { type: 'invalid-input', field: 'channelId' };
    const desiredConfig = {
        enabled: true,
        generateOverview: payload.generateOverview,
        messageContent: payload.content ?? null,
        messageEmbeds: payload.embeds,
        mode: payload.mode,
        options: payload.options.map(({ emojiKey, position, roleId }) => ({ emojiKey, position, roleId })),
    };
    const operation = await requestReactionRolePublishOperation((await getWebDb()).db, {
        actorMetadata: actor.metadata,
        actorUserId: actor.actorUserId,
        channelId: payload.channelId,
        desiredConfig,
        guildId: guildPageData.guild.id,
        idempotencyKey: input.idempotencyKey,
        requestHash: createReactionRoleRequestHash({
            channelId: payload.channelId,
            desiredConfig,
            type: 'publish',
        }),
    });
    return operation.isErr() ? { type: 'database-error' } : mapReactionRoleOperationRequestResult(operation.value);
}

export async function deleteDashboardReactionRoleMessage(
    request: Request,
    input: DashboardReactionRoleMessageDeleteInput
): Promise<DashboardReactionRoleMessageDeleteResult> {
    const guildPageData = await loadDashboardGuildPageData(request, input.guildId);
    if (guildPageData.type !== 'guild') return mapDashboardGuildPageError(guildPageData);
    const actor = await resolveReactionRoleActor(request);
    if (actor.type !== 'actor') return actor;
    if (!isValidReactionRoleIdempotencyKey(input.idempotencyKey)) {
        return { type: 'invalid-input', field: 'idempotencyKey' };
    }
    if (!Number.isInteger(input.expectedRevision) || input.expectedRevision < 1) {
        return { type: 'invalid-input', field: 'expectedRevision' };
    }
    const operation = await requestReactionRoleDeleteOperation((await getWebDb()).db, {
        actorMetadata: actor.metadata,
        actorUserId: actor.actorUserId,
        expectedRevision: input.expectedRevision,
        guildId: guildPageData.guild.id,
        idempotencyKey: input.idempotencyKey,
        messageId: input.messageId,
        requestHash: createReactionRoleRequestHash({
            expectedRevision: input.expectedRevision,
            messageId: input.messageId,
            type: 'delete',
        }),
    });
    return operation.isErr() ? { type: 'database-error' } : mapReactionRoleOperationRequestResult(operation.value);
}

export async function retryDashboardReactionRoleOperation(
    request: Request,
    input: { confirmUnknownPublishAbsent: boolean; guildId: string; operationId: string }
): Promise<DashboardReactionRoleRetryResult> {
    const guildPageData = await loadDashboardGuildPageData(request, input.guildId);
    if (guildPageData.type !== 'guild') return mapDashboardGuildPageError(guildPageData);
    const result = await retryReactionRoleOperation((await getWebDb()).db, {
        confirmUnknownPublishAbsent: input.confirmUnknownPublishAbsent,
        guildId: guildPageData.guild.id,
        operationId: input.operationId,
    });
    if (result.isErr()) return { type: 'database-error' };
    if (result.value.type === 'queued') {
        return { type: 'operation-accepted', operation: toDashboardReactionRoleOperation(result.value.operation) };
    }
    return result.value.type === 'confirmation-required' ? { type: 'confirmation-required' } : { type: 'not-found' };
}

export async function retryDashboardReactionRoleMembers(
    request: Request,
    input: { guildId: string; messageId: string }
): Promise<DashboardReactionRoleMemberRetryResult> {
    const guildPageData = await loadDashboardGuildPageData(request, input.guildId);
    if (guildPageData.type !== 'guild') return mapDashboardGuildPageError(guildPageData);
    const result = await retryBlockedReactionRoleMemberStates((await getWebDb()).db, {
        guildId: guildPageData.guild.id,
        messageId: input.messageId,
    });
    return result.isErr() ? { type: 'database-error' } : { type: 'member-retry-queued', ...result.value };
}

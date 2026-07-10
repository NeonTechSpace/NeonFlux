import '@tanstack/react-start/server-only';

import { findReactionRoleMessage, requestReactionRoleSaveOperation } from '@neonflux/db';

import { getWebDb } from './db.server.js';
import { loadDashboardGuildPageData } from './dashboard-guild-page.server.js';
import { mapDashboardGuildPageError, resolveReactionRoleActor } from './dashboard-reaction-roles-audit.server.js';
import { mapReactionRoleRepositoryError } from './dashboard-reaction-roles-errors.server.js';
import {
    createReactionRoleRequestHash,
    isValidReactionRoleIdempotencyKey,
    mapReactionRoleOperationRequestResult,
} from './dashboard-reaction-roles-operations.server.js';
import { normalizeReactionRolePublishPayload } from './dashboard-reaction-roles-payload.js';
import { loadReactionRoleStructure } from './dashboard-reaction-roles-structure.server.js';
import type {
    DashboardReactionRoleMessageSaveInput,
    DashboardReactionRoleMessageSaveResult,
} from './dashboard-reaction-roles-types.js';

export async function saveDashboardReactionRoleMessage(
    request: Request,
    input: DashboardReactionRoleMessageSaveInput
): Promise<DashboardReactionRoleMessageSaveResult> {
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

    const database = await getWebDb();
    const current = await findReactionRoleMessage(database.db, {
        guildId: guildPageData.guild.id,
        messageId: input.messageId,
    });
    if (current.isErr()) return mapReactionRoleRepositoryError(current.error);
    const structure = await loadReactionRoleStructure(guildPageData.guild.id);
    if (structure.status !== 'available') {
        return structure.status === 'bot-token-missing'
            ? { type: 'bot-token-missing' }
            : { type: 'guild-lookup-failed' };
    }
    const payload = normalizeReactionRolePublishPayload(
        {
            channelId: current.value.channelId,
            ...(input.content ? { content: input.content } : {}),
            embeds: input.embeds ?? [],
            generateOverview: input.generateOverview,
            guildId: guildPageData.guild.id,
            idempotencyKey: input.idempotencyKey,
            mode: input.mode,
            options: input.options,
        },
        structure.rolesById
    );
    if (payload.type !== 'payload') return payload;
    const desiredConfig = {
        enabled: current.value.enabled,
        generateOverview: payload.generateOverview,
        messageContent: payload.content ?? null,
        messageEmbeds: payload.embeds,
        mode: payload.mode,
        options: payload.options.map(({ emojiKey, position, roleId }) => ({ emojiKey, position, roleId })),
    };
    const operation = await requestReactionRoleSaveOperation(database.db, {
        actorMetadata: actor.metadata,
        actorUserId: actor.actorUserId,
        desiredConfig,
        expectedRevision: input.expectedRevision,
        guildId: guildPageData.guild.id,
        idempotencyKey: input.idempotencyKey,
        messageId: current.value.messageId,
        requestHash: createReactionRoleRequestHash({
            desiredConfig,
            expectedRevision: input.expectedRevision,
            messageId: current.value.messageId,
            type: 'save',
        }),
    });
    return operation.isErr() ? { type: 'database-error' } : mapReactionRoleOperationRequestResult(operation.value);
}

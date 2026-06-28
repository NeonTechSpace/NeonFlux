import '@tanstack/react-start/server-only';

import { loadWebConfig } from '@neonflux/config';
import {
    deleteReactionRoleMessage,
    listReactionRoleMessagesByGuildId,
    upsertReactionRoleMessage,
    upsertReactionRoleOptionByMessage,
} from '@neonflux/db';
import { sendFluxerBotGuildChannelMessage } from '@neonflux/fluxer';

import { getWebDatabaseClient } from './database.server.js';
import { loadDashboardGuildPageData } from './dashboard-guild-page.server.js';
import {
    mapDashboardGuildPageError,
    recordReactionRoleAuditEvent,
    resolveReactionRoleActor,
} from './dashboard-reaction-roles-audit.server.js';
import { mapReactionRoleRepositoryError } from './dashboard-reaction-roles-errors.server.js';
import { normalizeReactionRolePublishPayload } from './dashboard-reaction-roles-payload.js';
import { seedDashboardReactionRoleOptionReactions } from './dashboard-reaction-roles-reactions.server.js';
import {
    loadReactionRoleEmojis,
    loadReactionRoleStructure,
    toDashboardReactionRoleMessage,
} from './dashboard-reaction-roles-structure.server.js';
import type {
    DashboardReactionRoleMessageDeleteInput,
    DashboardReactionRoleMessageDeleteResult,
    DashboardReactionRolePublishInput,
    DashboardReactionRolePublishResult,
    DashboardReactionRolesSettingsResult,
} from './dashboard-reaction-roles-types.js';

export { saveDashboardReactionRoleMessage } from './dashboard-reaction-roles-save.server.js';
export type * from './dashboard-reaction-roles-types.js';

export async function loadDashboardReactionRolesSettings(
    request: Request,
    guildId: string
): Promise<DashboardReactionRolesSettingsResult> {
    const guildPageData = await loadDashboardGuildPageData(request, guildId);

    if (guildPageData.type !== 'guild') {
        return mapDashboardGuildPageError(guildPageData);
    }

    const messagesResult = await listReactionRoleMessagesByGuildId(getWebDatabaseClient().db, {
        guildId: guildPageData.guild.id,
    });

    if (messagesResult.isErr()) {
        return { type: 'database-error' };
    }

    const structureResult = await loadReactionRoleStructure(guildPageData.guild.id);
    const emojiResult = await loadReactionRoleEmojis(guildPageData.guild.id);
    const emojiByKey = new Map(emojiResult.emojis.map((emoji) => [emoji.key, emoji]));

    return {
        type: 'settings',
        roles: structureResult.roles,
        channels: structureResult.channels,
        emojis: emojiResult.emojis,
        structureReadStatus: structureResult.status,
        emojiReadStatus: emojiResult.status,
        messages: messagesResult.value.map((message) =>
            toDashboardReactionRoleMessage(message, structureResult.rolesById, structureResult.channelsById, emojiByKey)
        ),
    };
}

export async function publishDashboardReactionRoleMessage(
    request: Request,
    input: DashboardReactionRolePublishInput
): Promise<DashboardReactionRolePublishResult> {
    const guildPageData = await loadDashboardGuildPageData(request, input.guildId);

    if (guildPageData.type !== 'guild') {
        return mapDashboardGuildPageError(guildPageData);
    }

    const actorResult = await resolveReactionRoleActor(request);

    if (actorResult.type !== 'actor') {
        return actorResult;
    }

    const botToken = loadWebConfig().fluxerBotToken;

    if (!botToken) {
        return { type: 'bot-token-missing' };
    }

    const structureResult = await loadReactionRoleStructure(guildPageData.guild.id);

    if (structureResult.status !== 'available') {
        return structureResult.status === 'bot-token-missing'
            ? { type: 'bot-token-missing' }
            : { type: 'guild-lookup-failed' };
    }

    const payloadResult = normalizeReactionRolePublishPayload(input, structureResult.rolesById);

    if (payloadResult.type !== 'payload') {
        return payloadResult;
    }

    const sendResult = await sendFluxerBotGuildChannelMessage({
        botToken,
        guildId: guildPageData.guild.id,
        channelId: payloadResult.channelId,
        ...(payloadResult.content ? { content: payloadResult.content } : {}),
        ...(payloadResult.embeds.length > 0 ? { embeds: payloadResult.embeds } : {}),
    });

    if (sendResult.isErr()) {
        return { type: 'send-failed' };
    }

    const database = getWebDatabaseClient();
    const messageResult = await upsertReactionRoleMessage(database.db, {
        guildId: guildPageData.guild.id,
        channelId: sendResult.value.channelId,
        messageId: sendResult.value.id,
        mode: payloadResult.mode,
        source: 'dashboard',
        messageContent: payloadResult.content,
        messageEmbeds: payloadResult.embeds,
        generateOverview: payloadResult.generateOverview,
        enabled: true,
    });

    if (messageResult.isErr()) {
        return mapReactionRoleRepositoryError(messageResult.error);
    }

    for (const option of payloadResult.options) {
        const optionResult = await upsertReactionRoleOptionByMessage(database.db, {
            guildId: guildPageData.guild.id,
            messageId: sendResult.value.id,
            emojiKey: option.emojiKey,
            roleId: option.roleId,
            position: option.position,
        });

        if (optionResult.isErr()) {
            return mapReactionRoleRepositoryError(optionResult.error);
        }
    }

    const seedFailures = await seedDashboardReactionRoleOptionReactions({
        botToken,
        guildId: guildPageData.guild.id,
        channelId: sendResult.value.channelId,
        messageId: sendResult.value.id,
        emojiKeys: payloadResult.options.map((option) => option.emojiKey),
    });

    const channel = structureResult.channelsById.get(sendResult.value.channelId);
    const auditResult = await recordReactionRoleAuditEvent(database.db, guildPageData, actorResult, {
        action: 'message.created',
        targetId: sendResult.value.id,
        metadata: {
            channelId: sendResult.value.channelId,
            ...(channel ? { channelName: channel.name } : {}),
            messageId: sendResult.value.id,
            mode: payloadResult.mode,
            optionCount: payloadResult.options.length,
            generateOverview: payloadResult.generateOverview,
            seedFailureCount: seedFailures.length,
        },
    });

    if (auditResult === 'database-error') {
        return { type: 'database-error' };
    }

    if (seedFailures.length > 0) {
        await recordReactionRoleAuditEvent(database.db, guildPageData, actorResult, {
            action: 'reaction_seed.failed',
            targetId: sendResult.value.id,
            metadata: {
                channelId: sendResult.value.channelId,
                messageId: sendResult.value.id,
                failedEmojiKeys: seedFailures.join(','),
            },
        });
    }

    const savedMessages = await listReactionRoleMessagesByGuildId(database.db, { guildId: guildPageData.guild.id });

    if (savedMessages.isErr()) {
        return { type: 'database-error' };
    }

    const savedMessage = savedMessages.value.find((message) => message.messageId === sendResult.value.id) ?? {
        ...messageResult.value,
        options: [],
    };
    const message = toDashboardReactionRoleMessage(
        savedMessage,
        structureResult.rolesById,
        structureResult.channelsById,
        new Map()
    );

    return {
        type: seedFailures.length > 0 ? 'published-with-seed-errors' : 'published',
        message,
        seedFailures,
    };
}

export async function deleteDashboardReactionRoleMessage(
    request: Request,
    input: DashboardReactionRoleMessageDeleteInput
): Promise<DashboardReactionRoleMessageDeleteResult> {
    const guildPageData = await loadDashboardGuildPageData(request, input.guildId);

    if (guildPageData.type !== 'guild') {
        return mapDashboardGuildPageError(guildPageData);
    }

    const actorResult = await resolveReactionRoleActor(request);

    if (actorResult.type !== 'actor') {
        return actorResult;
    }

    const database = getWebDatabaseClient();
    const messageResult = await deleteReactionRoleMessage(database.db, {
        guildId: guildPageData.guild.id,
        messageId: input.messageId,
    });

    if (messageResult.isErr()) {
        return mapReactionRoleRepositoryError(messageResult.error);
    }

    const structureResult = await loadReactionRoleStructure(guildPageData.guild.id);
    const message = toDashboardReactionRoleMessage(
        messageResult.value,
        structureResult.rolesById,
        structureResult.channelsById,
        new Map()
    );
    const auditResult = await recordReactionRoleAuditEvent(database.db, guildPageData, actorResult, {
        action: 'message.deleted',
        targetId: message.messageId,
        metadata: {
            channelId: message.channelId,
            ...(message.channelName ? { channelName: message.channelName } : {}),
            messageId: message.messageId,
        },
    });

    if (auditResult === 'database-error') {
        return { type: 'database-error' };
    }

    return {
        type: 'deleted',
        message,
    };
}

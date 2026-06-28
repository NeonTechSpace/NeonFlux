import '@tanstack/react-start/server-only';

import { loadWebConfig } from '@neonflux/config';
import {
    deleteReactionRoleOptionByMessage,
    findReactionRoleMessage,
    listReactionRoleMessagesByGuildId,
    upsertReactionRoleMessage,
    upsertReactionRoleOptionByMessage,
} from '@neonflux/db';
import type { ReactionRoleMessageRecord, ReactionRoleMessageWithOptions } from '@neonflux/db';
import { editFluxerBotGuildChannelMessage } from '@neonflux/fluxer';

import { getWebDatabaseClient } from './database.server.js';
import { loadDashboardGuildPageData } from './dashboard-guild-page.server.js';
import {
    mapDashboardGuildPageError,
    recordReactionRoleAuditEvent,
    resolveReactionRoleActor,
} from './dashboard-reaction-roles-audit.server.js';
import { mapReactionRoleRepositoryError } from './dashboard-reaction-roles-errors.server.js';
import { normalizeReactionRolePublishPayload } from './dashboard-reaction-roles-payload.js';
import {
    removeDashboardReactionRoleOptionReaction,
    seedDashboardReactionRoleOptionReactions,
} from './dashboard-reaction-roles-reactions.server.js';
import {
    loadReactionRoleStructure,
    toDashboardReactionRoleMessage,
} from './dashboard-reaction-roles-structure.server.js';
import type {
    DashboardReactionRoleMessageSaveInput,
    DashboardReactionRoleMessageSaveResult,
} from './dashboard-reaction-roles-types.js';

export async function saveDashboardReactionRoleMessage(
    request: Request,
    input: DashboardReactionRoleMessageSaveInput
): Promise<DashboardReactionRoleMessageSaveResult> {
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

    const database = getWebDatabaseClient();
    const currentMessageResult = await findReactionRoleMessage(database.db, {
        guildId: guildPageData.guild.id,
        messageId: input.messageId,
    });

    if (currentMessageResult.isErr()) {
        return mapReactionRoleRepositoryError(currentMessageResult.error);
    }

    const currentMessagesResult = await listReactionRoleMessagesByGuildId(database.db, {
        guildId: guildPageData.guild.id,
    });

    if (currentMessagesResult.isErr()) {
        return { type: 'database-error' };
    }

    const currentMessage =
        currentMessagesResult.value.find((message) => message.messageId === currentMessageResult.value.messageId) ??
        ({
            ...currentMessageResult.value,
            options: [],
        } satisfies ReactionRoleMessageWithOptions);
    const structureResult = await loadReactionRoleStructure(guildPageData.guild.id);

    if (structureResult.status !== 'available') {
        return structureResult.status === 'bot-token-missing'
            ? { type: 'bot-token-missing' }
            : { type: 'guild-lookup-failed' };
    }

    const payloadResult = normalizeReactionRolePublishPayload(
        {
            guildId: guildPageData.guild.id,
            channelId: currentMessage.channelId,
            ...(input.content ? { content: input.content } : {}),
            embeds: input.embeds ?? [],
            mode: input.mode,
            generateOverview: input.generateOverview,
            options: input.options,
        },
        structureResult.rolesById
    );

    if (payloadResult.type !== 'payload') {
        return payloadResult;
    }

    const editResult = await editFluxerBotGuildChannelMessage({
        botToken,
        guildId: guildPageData.guild.id,
        channelId: currentMessage.channelId,
        messageId: currentMessage.messageId,
        ...(payloadResult.content ? { content: payloadResult.content } : {}),
        ...(payloadResult.embeds.length > 0 ? { embeds: payloadResult.embeds } : {}),
    });

    if (editResult.isErr()) {
        return { type: 'edit-failed' };
    }

    const saveResult = await persistReactionRoleMessageSave({
        database,
        guildPageData,
        currentMessage,
        payload: payloadResult,
        actor: actorResult,
        rolesById: structureResult.rolesById,
        channelsById: structureResult.channelsById,
        botToken,
    });

    if (saveResult.type !== 'persisted') {
        return saveResult;
    }

    const savedMessages = await listReactionRoleMessagesByGuildId(database.db, { guildId: guildPageData.guild.id });

    if (savedMessages.isErr()) {
        return { type: 'database-error' };
    }

    const savedMessage =
        savedMessages.value.find((message) => message.messageId === currentMessage.messageId) ??
        ({
            ...saveResult.message,
            options: [],
        } satisfies ReactionRoleMessageWithOptions);
    const message = toDashboardReactionRoleMessage(
        savedMessage,
        structureResult.rolesById,
        structureResult.channelsById,
        new Map()
    );

    return {
        type:
            saveResult.seedFailures.length > 0 || saveResult.cleanupFailures.length > 0
                ? 'saved-with-reaction-errors'
                : 'saved',
        message,
        seedFailures: saveResult.seedFailures,
        cleanupFailures: saveResult.cleanupFailures,
    };
}

async function persistReactionRoleMessageSave(input: {
    database: ReturnType<typeof getWebDatabaseClient>;
    guildPageData: Extract<Awaited<ReturnType<typeof loadDashboardGuildPageData>>, { type: 'guild' }>;
    currentMessage: ReactionRoleMessageWithOptions;
    payload: Extract<ReturnType<typeof normalizeReactionRolePublishPayload>, { type: 'payload' }>;
    actor: Extract<Awaited<ReturnType<typeof resolveReactionRoleActor>>, { type: 'actor' }>;
    rolesById: ReadonlyMap<string, { name: string }>;
    channelsById: ReadonlyMap<string, { name: string }>;
    botToken: string;
}): Promise<
    | {
          type: 'persisted';
          message: ReactionRoleMessageRecord;
          seedFailures: string[];
          cleanupFailures: string[];
      }
    | DashboardReactionRoleMessageSaveResult
> {
    const { currentMessage, database, guildPageData, payload } = input;
    const currentOptionsByEmoji = new Map(currentMessage.options.map((option) => [option.emojiKey, option]));
    const messageResult = await upsertReactionRoleMessage(database.db, {
        guildId: guildPageData.guild.id,
        channelId: currentMessage.channelId,
        messageId: currentMessage.messageId,
        mode: payload.mode,
        source: currentMessage.source === 'dashboard' ? 'dashboard' : 'existing',
        messageContent: payload.content,
        messageEmbeds: payload.embeds,
        generateOverview: payload.generateOverview,
        enabled: currentMessage.enabled,
    });

    if (messageResult.isErr()) {
        return mapReactionRoleRepositoryError(messageResult.error);
    }

    const nextEmojiKeys = new Set(payload.options.map((option) => option.emojiKey));
    const removedOptions = currentMessage.options.filter((option) => !nextEmojiKeys.has(option.emojiKey));
    const addedOptions = payload.options.filter((option) => !currentOptionsByEmoji.has(option.emojiKey));
    const changedOptions = payload.options.filter((option) => {
        const currentOption = currentOptionsByEmoji.get(option.emojiKey);

        return !currentOption || currentOption.roleId !== option.roleId || currentOption.position !== option.position;
    });

    for (const option of payload.options) {
        const optionResult = await upsertReactionRoleOptionByMessage(database.db, {
            guildId: guildPageData.guild.id,
            messageId: currentMessage.messageId,
            emojiKey: option.emojiKey,
            roleId: option.roleId,
            position: option.position,
        });

        if (optionResult.isErr()) {
            return mapReactionRoleRepositoryError(optionResult.error);
        }
    }

    for (const option of removedOptions) {
        const deleteResult = await deleteReactionRoleOptionByMessage(database.db, {
            guildId: guildPageData.guild.id,
            messageId: currentMessage.messageId,
            emojiKey: option.emojiKey,
        });

        if (deleteResult.isErr()) {
            return mapReactionRoleRepositoryError(deleteResult.error);
        }
    }

    const seedFailures =
        addedOptions.length > 0
            ? await seedDashboardReactionRoleOptionReactions({
                  botToken: input.botToken,
                  guildId: guildPageData.guild.id,
                  channelId: currentMessage.channelId,
                  messageId: currentMessage.messageId,
                  emojiKeys: addedOptions.map((option) => option.emojiKey),
              })
            : [];
    const cleanupFailures: string[] = [];

    for (const option of removedOptions) {
        const failures = await removeDashboardReactionRoleOptionReaction({
            botToken: input.botToken,
            guildId: guildPageData.guild.id,
            channelId: currentMessage.channelId,
            messageId: currentMessage.messageId,
            emojiKey: option.emojiKey,
        });
        cleanupFailures.push(...failures);
    }

    const auditResult = await recordReactionRoleSaveAudit({
        ...input,
        messageId: currentMessage.messageId,
        removedOptions,
        changedOptions,
        seedFailures,
        cleanupFailures,
    });

    if (auditResult === 'database-error') {
        return { type: 'database-error' };
    }

    return {
        type: 'persisted',
        message: messageResult.value,
        seedFailures,
        cleanupFailures,
    };
}

async function recordReactionRoleSaveAudit(input: {
    database: ReturnType<typeof getWebDatabaseClient>;
    guildPageData: Extract<Awaited<ReturnType<typeof loadDashboardGuildPageData>>, { type: 'guild' }>;
    currentMessage: ReactionRoleMessageWithOptions;
    payload: Extract<ReturnType<typeof normalizeReactionRolePublishPayload>, { type: 'payload' }>;
    actor: Extract<Awaited<ReturnType<typeof resolveReactionRoleActor>>, { type: 'actor' }>;
    rolesById: ReadonlyMap<string, { name: string }>;
    channelsById: ReadonlyMap<string, { name: string }>;
    messageId: string;
    removedOptions: Array<{ emojiKey: string; roleId: string }>;
    changedOptions: Array<{ emojiKey: string; roleId: string; position: number }>;
    seedFailures: string[];
    cleanupFailures: string[];
}): Promise<'recorded' | 'database-error'> {
    const channel = input.channelsById.get(input.currentMessage.channelId);
    const messageAuditResult = await recordReactionRoleAuditEvent(input.database.db, input.guildPageData, input.actor, {
        action: 'message.updated',
        targetId: input.messageId,
        metadata: {
            channelId: input.currentMessage.channelId,
            ...(channel ? { channelName: channel.name } : {}),
            messageId: input.messageId,
            mode: input.payload.mode,
            enabled: input.currentMessage.enabled,
            optionCount: input.payload.options.length,
            generateOverview: input.payload.generateOverview,
        },
    });

    if (messageAuditResult === 'database-error') {
        return 'database-error';
    }

    for (const option of input.changedOptions) {
        const role = input.rolesById.get(option.roleId);
        const optionAuditResult = await recordReactionRoleAuditEvent(
            input.database.db,
            input.guildPageData,
            input.actor,
            {
                action: 'option.updated',
                targetId: input.messageId,
                metadata: {
                    channelId: input.currentMessage.channelId,
                    messageId: input.messageId,
                    emojiKey: option.emojiKey,
                    roleId: option.roleId,
                    ...(role ? { roleName: role.name } : {}),
                    position: option.position,
                },
            }
        );

        if (optionAuditResult === 'database-error') {
            return 'database-error';
        }
    }

    for (const option of input.removedOptions) {
        const role = input.rolesById.get(option.roleId);
        const optionAuditResult = await recordReactionRoleAuditEvent(
            input.database.db,
            input.guildPageData,
            input.actor,
            {
                action: 'option.deleted',
                targetId: input.messageId,
                metadata: {
                    channelId: input.currentMessage.channelId,
                    messageId: input.messageId,
                    emojiKey: option.emojiKey,
                    roleId: option.roleId,
                    ...(role ? { roleName: role.name } : {}),
                },
            }
        );

        if (optionAuditResult === 'database-error') {
            return 'database-error';
        }
    }

    return recordReactionRoleSyncFailureAudit(input);
}

async function recordReactionRoleSyncFailureAudit(input: {
    database: ReturnType<typeof getWebDatabaseClient>;
    guildPageData: Extract<Awaited<ReturnType<typeof loadDashboardGuildPageData>>, { type: 'guild' }>;
    actor: Extract<Awaited<ReturnType<typeof resolveReactionRoleActor>>, { type: 'actor' }>;
    currentMessage: ReactionRoleMessageWithOptions;
    messageId: string;
    seedFailures: string[];
    cleanupFailures: string[];
}): Promise<'recorded' | 'database-error'> {
    if (input.seedFailures.length > 0) {
        const seedAuditResult = await recordReactionRoleAuditEvent(
            input.database.db,
            input.guildPageData,
            input.actor,
            {
                action: 'reaction_seed.failed',
                targetId: input.messageId,
                metadata: {
                    channelId: input.currentMessage.channelId,
                    messageId: input.messageId,
                    failedEmojiKeys: input.seedFailures.join(','),
                    failureSource: 'fluxer',
                },
            }
        );

        if (seedAuditResult === 'database-error') {
            return 'database-error';
        }
    }

    if (input.cleanupFailures.length > 0) {
        const cleanupAuditResult = await recordReactionRoleAuditEvent(
            input.database.db,
            input.guildPageData,
            input.actor,
            {
                action: 'reaction_cleanup.failed',
                targetId: input.messageId,
                metadata: {
                    channelId: input.currentMessage.channelId,
                    messageId: input.messageId,
                    failedEmojiKeys: input.cleanupFailures.join(','),
                    failureSource: 'fluxer',
                },
            }
        );

        if (cleanupAuditResult === 'database-error') {
            return 'database-error';
        }
    }

    return 'recorded';
}

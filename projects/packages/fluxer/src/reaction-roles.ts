import { PermissionFlags, type MessageSendOptions } from '@fluxerjs/core';
import type { OutgoingMessage } from '@neonflux/messaging';
import {
    evaluateReactionRoleRoleEligibility,
    getReactionRoleEmojiIdentifier,
    type ReactionRoleEmoji,
} from '@neonflux/reaction-roles';
import { err, ok, type Result } from 'neverthrow';

import type { FluxerBot } from './client.js';
import { isFluxerGuildUnavailable } from './guild-availability.js';
import { readFluxerGuildStructure } from './guild-structure.js';
import { mapPlatformError, type FluxerPlatformError } from './platform-shared.js';

const POSTABLE_CHANNEL_TYPES = new Set([0]);

export type FluxerReactionRoleCatalog = {
    channels: Array<{
        eligible: boolean;
        id: string;
        name: string;
        parentId: string | null;
        parentName: string | null;
        position: number | null;
        reason?: 'missing-permissions' | 'unsupported-channel';
    }>;
    emojis: Array<{
        animated: boolean;
        id: string;
        markup: string;
        name: string;
        url: string;
    }>;
    guildId: string;
    guildName: string;
    roles: Array<{
        color: number;
        eligible: boolean;
        id: string;
        name: string;
        reason?: 'hierarchy' | 'invalid-permissions' | 'missing-permissions' | 'privileged' | 'protected';
    }>;
};

export type ReadFluxerReactionRoleCatalogError =
    | { type: 'missing-input'; field: 'guildId' }
    | { type: 'unavailable-or-not-found' }
    | { type: 'fetch-failed'; error: unknown }
    | { type: 'invalid-response' };

export type FluxerReactionRolePreflight = {
    channelName: string;
};

export function createFluxerReactionRolePlatform(client: FluxerBot['client']) {
    return {
        preflight: (input: {
            channelId: string;
            customEmojiIds: readonly string[];
            guildId: string;
            roleIds: readonly string[];
        }) => preflightReactionRolePanel(client, input),
        send: (input: { channelId: string; message: OutgoingMessage; nonce: string }) =>
            sendReactionRoleMessage(client, input),
        edit: (input: { channelId: string; message: OutgoingMessage; messageId: string }) =>
            editReactionRoleMessage(client, input),
        delete: (input: { channelId: string; messageId: string }) =>
            withMessage(client, input, async (message) => {
                await message.delete();
            }),
        react: (input: { channelId: string; emoji: ReactionRoleEmoji; messageId: string }) =>
            withMessage(client, input, async (message) => {
                await message.react(getReactionRoleEmojiIdentifier(input.emoji));
            }),
        removeUserReaction: (input: {
            channelId: string;
            emoji: ReactionRoleEmoji;
            messageId: string;
            userId: string;
        }) =>
            withMessage(client, input, async (message) => {
                await message.removeReaction(getReactionRoleEmojiIdentifier(input.emoji), input.userId);
            }),
        removeReactionEmoji: (input: { channelId: string; emoji: ReactionRoleEmoji; messageId: string }) =>
            withMessage(client, input, async (message) => {
                await message.removeReactionEmoji(getReactionRoleEmojiIdentifier(input.emoji));
            }),
        removeAllReactions: (input: { channelId: string; messageId: string }) =>
            withMessage(client, input, async (message) => {
                await message.removeAllReactions();
            }),
        fetchReactionUsersPage: (input: {
            after?: string;
            channelId: string;
            emoji: ReactionRoleEmoji;
            limit?: number;
            messageId: string;
        }) =>
            withMessage(client, input, async (message) => {
                const page = await message.fetchReactionUsersPage(getReactionRoleEmojiIdentifier(input.emoji), {
                    ...(input.after ? { after: input.after } : {}),
                    ...(input.limit ? { limit: input.limit } : {}),
                });
                return {
                    hasMore: page.hasMore,
                    nextAfter: page.nextAfter,
                    users: page.users.map((user) => ({ bot: user.bot, id: user.id })),
                };
            }),
        readMemberRoleIds: (input: { guildId: string; userId: string }) =>
            withGuild(client, input.guildId, async (guild) => {
                const member = await guild.fetchMember(input.userId);
                return [...member.roles.roleIds];
            }),
        addMemberRole: (input: { guildId: string; roleId: string; userId: string }) =>
            withGuild(client, input.guildId, async (guild) => {
                const [member, roles, botMember] = await Promise.all([
                    guild.fetchMember(input.userId),
                    guild.fetchRoles(),
                    guild.fetchMe(),
                ]);
                const role = roles.find((candidate) => candidate.id === input.roleId);
                const highestBotRolePosition = Math.max(
                    0,
                    ...botMember.roles.cache.map((candidate) => candidate.position)
                );
                const eligibility = role
                    ? evaluateReactionRoleRoleEligibility({
                          botHighestRolePosition: highestBotRolePosition,
                          role: {
                              id: role.id,
                              name: role.name,
                              permissions: role._permissions,
                              position: role.position,
                              protected: role.id === guild.id,
                          },
                      })
                    : undefined;
                if (!botMember.permissions.has(PermissionFlags.ManageRoles) || !role || !eligibility?.eligible) {
                    throw permissionError();
                }
                await member.roles.add(input.roleId);
            }),
        removeMemberRole: (input: { guildId: string; roleId: string; userId: string }) =>
            withGuild(client, input.guildId, async (guild) => {
                const member = await guild.fetchMember(input.userId);
                await member.roles.remove(input.roleId);
            }),
    };
}

export async function readFluxerReactionRoleCatalog(input: {
    botUserId?: string;
    client: FluxerBot['client'];
    guildId: string;
}): Promise<Result<FluxerReactionRoleCatalog, ReadFluxerReactionRoleCatalogError>> {
    const structureResult = await readFluxerGuildStructure(input);
    if (structureResult.isErr()) return err(structureResult.error);

    try {
        const guild = await input.client.guilds.fetch(structureResult.value.guildId);
        if (isFluxerGuildUnavailable(guild)) return err({ type: 'unavailable-or-not-found' });
        const [emojis, botMember] = await Promise.all([guild.fetchEmojis(), guild.fetchMe()]);
        const botCanManageRoles = botMember.permissions.has(PermissionFlags.ManageRoles);
        const categoryNameById = new Map(
            structureResult.value.categories.map((category) => [category.id, category.name ?? 'Untitled category'])
        );

        return ok({
            guildId: structureResult.value.guildId,
            guildName: structureResult.value.guildName,
            channels: structureResult.value.channels
                .map((channel) => {
                    const guildChannel = guild.channels.get(channel.id);
                    const hasPermissions =
                        guildChannel !== undefined &&
                        botMember
                            .permissionsIn(guildChannel)
                            .has([
                                PermissionFlags.ViewChannel,
                                PermissionFlags.SendMessages,
                                PermissionFlags.ReadMessageHistory,
                                PermissionFlags.AddReactions,
                                PermissionFlags.ManageMessages,
                            ]);
                    const channelTypeEligible = POSTABLE_CHANNEL_TYPES.has(channel.type);
                    return {
                        id: channel.id,
                        name: channel.name ?? 'Untitled channel',
                        parentId: channel.parentId,
                        parentName: channel.parentId ? (categoryNameById.get(channel.parentId) ?? null) : null,
                        position: channel.position,
                        eligible: channelTypeEligible && hasPermissions,
                        ...(!channelTypeEligible
                            ? { reason: 'unsupported-channel' as const }
                            : !hasPermissions
                              ? { reason: 'missing-permissions' as const }
                              : {}),
                    };
                })
                .sort(compareCatalogItems),
            roles: structureResult.value.roles
                .map((role) => {
                    const eligibility = botCanManageRoles
                        ? evaluateReactionRoleRoleEligibility({
                              ...(structureResult.value.botHighestRoleHierarchyRank === undefined
                                  ? {}
                                  : { botHighestRoleHierarchyRank: structureResult.value.botHighestRoleHierarchyRank }),
                              ...(structureResult.value.botHighestRolePosition === undefined
                                  ? {}
                                  : { botHighestRolePosition: structureResult.value.botHighestRolePosition }),
                              role,
                          })
                        : ({ eligible: false, reason: 'missing-permissions' } as const);
                    return {
                        color: role.color,
                        id: role.id,
                        name: role.name,
                        eligible: eligibility.eligible,
                        ...(eligibility.eligible ? {} : { reason: eligibility.reason }),
                    };
                })
                .sort((left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id)),
            emojis: emojis
                .map((emoji) => ({
                    animated: emoji.animated,
                    id: emoji.id,
                    markup: `<${emoji.animated ? 'a' : ''}:${emoji.name}:${emoji.id}>`,
                    name: emoji.name,
                    url: emoji.url,
                }))
                .sort((left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id)),
        });
    } catch (error) {
        return err({ type: 'fetch-failed', error });
    }
}

async function preflightReactionRolePanel(
    client: FluxerBot['client'],
    input: {
        channelId: string;
        customEmojiIds: readonly string[];
        guildId: string;
        roleIds: readonly string[];
    }
): Promise<Result<FluxerReactionRolePreflight, FluxerPlatformError>> {
    const catalog = await readFluxerReactionRoleCatalog({ client, guildId: input.guildId });
    if (catalog.isErr()) {
        return catalog.error.type === 'unavailable-or-not-found'
            ? err({ type: 'not-found' })
            : err({ type: 'operation-failed', error: catalog.error });
    }
    const channel = catalog.value.channels.find((candidate) => candidate.id === input.channelId);
    if (!channel) return err({ type: 'not-found' });
    if (!channel.eligible) return err({ type: 'permission-denied' });
    const roleById = new Map(catalog.value.roles.map((role) => [role.id, role]));
    if (input.roleIds.some((roleId) => !roleById.get(roleId)?.eligible)) {
        return err({ type: 'permission-denied' });
    }
    const customEmojiIds = new Set(catalog.value.emojis.map((emoji) => emoji.id));
    if (input.customEmojiIds.some((emojiId) => !customEmojiIds.has(emojiId))) {
        return err({ type: 'not-found' });
    }
    return ok({ channelName: channel.name });
}

async function sendReactionRoleMessage(
    client: FluxerBot['client'],
    input: { channelId: string; message: OutgoingMessage; nonce: string }
): Promise<Result<{ channelId: string; id: string }, FluxerPlatformError>> {
    try {
        const sent = await client.channels.send(input.channelId, {
            ...toMessagePayload(input.message),
            nonce: input.nonce,
        });
        return ok({ channelId: sent.channelId, id: sent.id });
    } catch (error) {
        return err(mapPlatformError(error));
    }
}

async function editReactionRoleMessage(
    client: FluxerBot['client'],
    input: { channelId: string; message: OutgoingMessage; messageId: string }
): Promise<Result<{ channelId: string; id: string }, FluxerPlatformError>> {
    return withMessage(client, input, async (message) => {
        const edited = await message.edit(toMessagePayload(input.message));
        return { channelId: edited.channelId, id: edited.id };
    });
}

function toMessagePayload(message: OutgoingMessage): MessageSendOptions {
    return {
        allowedMentions: { parse: [] },
        ...(message.content ? { content: message.content } : {}),
        ...(message.embeds.length > 0 ? { embeds: message.embeds } : {}),
    };
}

async function withMessage<T>(
    client: FluxerBot['client'],
    input: { channelId: string; messageId: string },
    action: (message: Awaited<ReturnType<FluxerBot['client']['channels']['fetchMessage']>>) => Promise<T>
): Promise<Result<T, FluxerPlatformError>> {
    try {
        return ok(await action(await client.channels.fetchMessage(input.channelId, input.messageId)));
    } catch (error) {
        return err(mapPlatformError(error));
    }
}

async function withGuild<T>(
    client: FluxerBot['client'],
    guildId: string,
    action: (guild: NonNullable<Awaited<ReturnType<FluxerBot['client']['guilds']['fetch']>>>) => Promise<T>
): Promise<Result<T, FluxerPlatformError>> {
    try {
        const guild = await client.guilds.fetch(guildId);
        if (isFluxerGuildUnavailable(guild)) return err({ type: 'not-found' });
        return ok(await action(guild));
    } catch (error) {
        return err(mapPlatformError(error));
    }
}

function compareCatalogItems(
    left: { name: string; position: number | null },
    right: { name: string; position: number | null }
) {
    return (
        (left.position ?? Number.MAX_SAFE_INTEGER) - (right.position ?? Number.MAX_SAFE_INTEGER) ||
        left.name.localeCompare(right.name)
    );
}

function permissionError(): Error & { status: number } {
    return Object.assign(new Error('permission denied'), { status: 403 });
}

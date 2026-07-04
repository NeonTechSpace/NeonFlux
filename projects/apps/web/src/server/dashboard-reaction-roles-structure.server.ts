import '@tanstack/react-start/server-only';

import { loadWebConfig } from '@neonflux/config';
import type { ReactionRoleMessageWithOptions } from '@neonflux/db';
import { readFluxerBotGuildEmojis, readFluxerBotGuildStructure } from '@neonflux/fluxer';

import type {
    DashboardReactionRoleChannel,
    DashboardReactionRoleEmoji,
    DashboardReactionRoleMessage,
    DashboardReactionRoleReadStatus,
    DashboardReactionRoleRole,
} from './dashboard-reaction-roles-types.js';
import type {
    DashboardReactionRoleEmbedPayload,
    DashboardReactionRoleJsonValue,
} from './dashboard-reaction-roles-payload.js';

const textChannelTypes = new Set([0, 5]);

export async function loadReactionRoleStructure(guildId: string): Promise<{
    status: DashboardReactionRoleReadStatus;
    roles: DashboardReactionRoleRole[];
    channels: DashboardReactionRoleChannel[];
    rolesById: Map<string, DashboardReactionRoleRole>;
    channelsById: Map<string, DashboardReactionRoleChannel>;
}> {
    const botToken = loadWebConfig().fluxerBotToken;

    if (!botToken) {
        return emptyReactionRoleStructure('bot-token-missing');
    }

    const structureResult = await readFluxerBotGuildStructure({
        botToken,
        guildId,
    });

    if (structureResult.isErr()) {
        return emptyReactionRoleStructure('fetch-failed');
    }

    const roles = structureResult.value.roles
        .filter((role) => role.name !== '@everyone')
        .map((role) => ({
            id: role.id,
            name: role.name,
            position: role.position,
            color: role.color,
        }))
        .sort((left, right) => right.position - left.position || left.name.localeCompare(right.name));
    const categoryNameById = new Map(structureResult.value.categories.map((category) => [category.id, category.name]));
    const channels = structureResult.value.channels
        .filter((channel) => textChannelTypes.has(channel.type))
        .map((channel): DashboardReactionRoleChannel => {
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
        .sort(compareReactionRoleChannels);

    return {
        status: 'available',
        roles,
        channels,
        rolesById: new Map(roles.map((role) => [role.id, role])),
        channelsById: new Map(channels.map((channel) => [channel.id, channel])),
    };
}

export async function loadReactionRoleEmojis(guildId: string): Promise<{
    status: DashboardReactionRoleReadStatus;
    emojis: DashboardReactionRoleEmoji[];
}> {
    const botToken = loadWebConfig().fluxerBotToken;

    if (!botToken) {
        return { status: 'bot-token-missing', emojis: [] };
    }

    const emojiResult = await readFluxerBotGuildEmojis({ botToken, guildId });

    if (emojiResult.isErr()) {
        return { status: 'fetch-failed', emojis: [] };
    }

    return {
        status: 'available',
        emojis: emojiResult.value.map((emoji) => ({
            key: emoji.identifier,
            label: `:${emoji.name}:`,
            name: emoji.name,
            custom: true,
            animated: emoji.animated,
            id: emoji.id,
            ...(emoji.url ? { url: emoji.url } : {}),
        })),
    };
}

export function toDashboardReactionRoleMessage(
    record: ReactionRoleMessageWithOptions | Omit<ReactionRoleMessageWithOptions, 'options'>,
    rolesById: ReadonlyMap<string, DashboardReactionRoleRole>,
    channelsById: ReadonlyMap<string, DashboardReactionRoleChannel>,
    emojisByKey: ReadonlyMap<string, DashboardReactionRoleEmoji>
): DashboardReactionRoleMessage {
    const channel = channelsById.get(record.channelId);
    const options = 'options' in record ? record.options : [];

    return {
        id: record.id,
        channelId: record.channelId,
        ...(channel ? { channelName: channel.name } : {}),
        messageId: record.messageId,
        mode: record.mode === 'exclusive' ? 'exclusive' : 'normal',
        source: record.source === 'dashboard' ? 'dashboard' : 'existing',
        ...(record.messageContent ? { messageContent: record.messageContent } : {}),
        messageEmbeds: Array.isArray(record.messageEmbeds)
            ? record.messageEmbeds.map(toJsonValue).filter(isSerializableRecord)
            : [],
        generateOverview: record.generateOverview,
        enabled: record.enabled,
        ...(record.staleAt ? { staleAt: record.staleAt.toISOString() } : {}),
        updatedAt: record.updatedAt.toISOString(),
        options: options.map((option) => toDashboardReactionRoleOption(option, rolesById, emojisByKey)),
    };
}

function toDashboardReactionRoleOption(
    record: { id: string; emojiKey: string; roleId: string; position: number },
    rolesById: ReadonlyMap<string, DashboardReactionRoleRole>,
    emojisByKey: ReadonlyMap<string, DashboardReactionRoleEmoji>
) {
    const role = rolesById.get(record.roleId);
    const emoji = emojisByKey.get(record.emojiKey);

    return {
        id: record.id,
        emojiKey: record.emojiKey,
        ...(emoji ? { emojiLabel: emoji.label } : {}),
        roleId: record.roleId,
        ...(role ? { roleName: role.name, roleColor: role.color } : {}),
        position: record.position,
    };
}

function emptyReactionRoleStructure(status: Exclude<DashboardReactionRoleReadStatus, 'available'>) {
    return {
        status,
        roles: [],
        channels: [],
        rolesById: new Map<string, DashboardReactionRoleRole>(),
        channelsById: new Map<string, DashboardReactionRoleChannel>(),
    };
}

function compareReactionRoleChannels(left: DashboardReactionRoleChannel, right: DashboardReactionRoleChannel): number {
    const leftCategory = left.parentName ?? '';
    const rightCategory = right.parentName ?? '';

    if (leftCategory !== rightCategory) {
        return leftCategory.localeCompare(rightCategory);
    }

    return (left.position ?? 0) - (right.position ?? 0) || left.name.localeCompare(right.name);
}

function isSerializableRecord(
    value: DashboardReactionRoleJsonValue | undefined
): value is DashboardReactionRoleEmbedPayload {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function toJsonValue(value: unknown): DashboardReactionRoleJsonValue | undefined {
    if (value === null || typeof value === 'string' || typeof value === 'boolean') {
        return value;
    }

    if (typeof value === 'number') {
        return Number.isFinite(value) ? value : undefined;
    }

    if (Array.isArray(value)) {
        return value.map(toJsonValue).filter((item) => item !== undefined);
    }

    if (typeof value === 'object') {
        const output: { [key: string]: DashboardReactionRoleJsonValue } = {};

        for (const [key, child] of Object.entries(value)) {
            const jsonValue = toJsonValue(child);

            if (jsonValue !== undefined) {
                output[key] = jsonValue;
            }
        }

        return output;
    }

    return undefined;
}

import '@tanstack/react-start/server-only';

import { loadWebConfig } from '@neonflux/config';
import { readFluxerBotGuildStructure } from '@neonflux/fluxer';
import type { FluxerGuildChannel } from '@neonflux/fluxer';

export type DashboardGiveawayChannel = {
    id: string;
    name: string;
    type: number;
    position: number;
    parentId?: string;
    parentName?: string;
};

export type DashboardGiveawaysStructureReadStatus = 'available' | 'bot-token-missing' | 'fetch-failed';

const textChannelTypes = new Set([0, 5]);

export async function loadGiveawaysStructure(guildId: string) {
    const botToken = loadWebConfig().fluxerBotToken;

    if (!botToken) return emptyStructureResult('bot-token-missing');

    const structureResult = await readFluxerBotGuildStructure({ botToken, guildId });

    if (structureResult.isErr()) return emptyStructureResult('fetch-failed');

    const categories = structureResult.value.categories.map((category) => ({
        id: category.id,
        name: category.name ?? category.id,
        position: category.position ?? 0,
    }));
    const categoriesById = new Map(categories.map((category) => [category.id, category]));
    const channels = toDashboardChannels(structureResult.value.channels, categoriesById);

    return {
        status: 'available' as const,
        channels,
        channelsById: new Map(channels.map((channel) => [channel.id, channel])),
    };
}

function emptyStructureResult(status: Exclude<DashboardGiveawaysStructureReadStatus, 'available'>) {
    return {
        status,
        channels: [],
        channelsById: new Map<string, DashboardGiveawayChannel>(),
    };
}

function toDashboardChannels(
    channels: FluxerGuildChannel[],
    categoriesById: ReadonlyMap<string, { id: string; name: string; position: number }>
): DashboardGiveawayChannel[] {
    return channels
        .filter((channel) => textChannelTypes.has(channel.type))
        .map((channel) => ({
            id: channel.id,
            name: channel.name ?? channel.id,
            type: channel.type,
            position: channel.position ?? 0,
            ...(channel.parentId ? { parentId: channel.parentId } : {}),
            ...(channel.parentId && categoriesById.get(channel.parentId)
                ? { parentName: categoriesById.get(channel.parentId)?.name }
                : {}),
        }))
        .sort((left, right) => left.position - right.position || left.name.localeCompare(right.name));
}

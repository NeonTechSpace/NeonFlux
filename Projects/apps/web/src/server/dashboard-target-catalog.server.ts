import '@tanstack/react-start/server-only';

import { loadWebConfig } from '@neonflux/config';
import { readFluxerBotGuildStructure } from '@neonflux/fluxer';
import type { FluxerGuildChannel, FluxerGuildRole } from '@neonflux/fluxer';

export type DashboardTargetCatalogStatus = 'available' | 'bot-token-missing' | 'fetch-failed';

export type DashboardTargetChannel = {
    id: string;
    name: string;
    type: number;
    position: number;
    parentId?: string;
    parentName?: string;
};

export type DashboardTargetRole = {
    id: string;
    name: string;
    position: number;
    color: number;
};

export type DashboardTargetCatalog = {
    status: DashboardTargetCatalogStatus;
    channels: DashboardTargetChannel[];
    roles: DashboardTargetRole[];
};

type DashboardTargetCategory = {
    id: string;
    name: string;
};

const textChannelTypes = new Set([0, 5]);

export async function loadDashboardTargetCatalog(guildId: string): Promise<DashboardTargetCatalog> {
    const botToken = loadWebConfig().fluxerBotToken;

    if (!botToken) {
        return emptyTargetCatalog('bot-token-missing');
    }

    const structureResult = await readFluxerBotGuildStructure({
        botToken,
        guildId,
    });

    if (structureResult.isErr()) {
        return emptyTargetCatalog('fetch-failed');
    }

    const categoriesById = new Map(toDashboardTargetCategories(structureResult.value.categories).map((category) => [category.id, category]));

    return {
        status: 'available',
        channels: toDashboardTargetChannels(structureResult.value.channels, categoriesById),
        roles: toDashboardTargetRoles(structureResult.value.roles),
    };
}

function emptyTargetCatalog(status: Exclude<DashboardTargetCatalogStatus, 'available'>): DashboardTargetCatalog {
    return {
        status,
        channels: [],
        roles: [],
    };
}

function toDashboardTargetCategories(categories: FluxerGuildChannel[]): DashboardTargetCategory[] {
    return categories.map((category) => ({
        id: category.id,
        name: category.name ?? category.id,
    }));
}

function toDashboardTargetChannels(
    channels: FluxerGuildChannel[],
    categoriesById: ReadonlyMap<string, DashboardTargetCategory>
): DashboardTargetChannel[] {
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

function toDashboardTargetRoles(roles: FluxerGuildRole[]): DashboardTargetRole[] {
    return roles
        .map((role) => ({
            id: role.id,
            name: role.name,
            position: role.position,
            color: role.color,
        }))
        .sort((left, right) => right.position - left.position || left.name.localeCompare(right.name));
}

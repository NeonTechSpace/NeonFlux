import type { FluxerGuildChannel, FluxerGuildRole } from '@neonflux/fluxer';

import type { DashboardStructureImportAction } from '../server/dashboard-structure-model.js';

export type DashboardStructureExplorerSnapshot = {
    version?: 1;
    guildId?: string;
    guildName?: string;
    exportedAt?: string;
    roles: FluxerGuildRole[];
    categories: FluxerGuildChannel[];
    channels: FluxerGuildChannel[];
};

export type DashboardStructureExplorerEntityKey = `role:${string}` | `category:${string}` | `channel:${string}`;

export type DashboardStructureExplorerSection = 'channels' | 'roles';

export function parseDashboardStructureExplorerSnapshot(value: string): DashboardStructureExplorerSnapshot | undefined {
    try {
        return normalizeDashboardStructureExplorerSnapshot(JSON.parse(value));
    } catch {
        return undefined;
    }
}

export function readDashboardStructureExplorerEntityKey(
    action: Pick<DashboardStructureImportAction, 'targetId' | 'targetType'>
): DashboardStructureExplorerEntityKey | undefined {
    if (!action.targetId) return undefined;
    if (action.targetType !== 'role' && action.targetType !== 'category' && action.targetType !== 'channel') {
        return undefined;
    }

    return `${action.targetType}:${action.targetId}`;
}

export function readDashboardStructureExplorerSection(
    key: DashboardStructureExplorerEntityKey
): DashboardStructureExplorerSection {
    return key.startsWith('role:') ? 'roles' : 'channels';
}

function normalizeDashboardStructureExplorerSnapshot(value: unknown): DashboardStructureExplorerSnapshot | undefined {
    if (!isObject(value)) return undefined;
    if (!Array.isArray(value.roles) || !Array.isArray(value.categories) || !Array.isArray(value.channels)) {
        return undefined;
    }

    const roles = value.roles.filter(isRole);
    const categories = value.categories.filter(isChannel);
    const channels = value.channels.filter(isChannel);

    if (
        roles.length !== value.roles.length ||
        categories.length !== value.categories.length ||
        channels.length !== value.channels.length
    ) {
        return undefined;
    }

    return {
        version: 1,
        ...(typeof value.guildId === 'string' && value.guildId.trim() ? { guildId: value.guildId.trim() } : {}),
        ...(typeof value.guildName === 'string' && value.guildName.trim() ? { guildName: value.guildName.trim() } : {}),
        ...(typeof value.exportedAt === 'string' && value.exportedAt.trim()
            ? { exportedAt: value.exportedAt.trim() }
            : {}),
        roles,
        categories,
        channels,
    };
}

function isRole(value: unknown): value is FluxerGuildRole {
    return (
        isObject(value) &&
        typeof value.id === 'string' &&
        typeof value.name === 'string' &&
        typeof value.position === 'number' &&
        typeof value.color === 'number' &&
        typeof value.permissions === 'string' &&
        typeof value.hoist === 'boolean' &&
        typeof value.mentionable === 'boolean'
    );
}

function isChannel(value: unknown): value is FluxerGuildChannel {
    return (
        isObject(value) &&
        typeof value.id === 'string' &&
        (typeof value.name === 'string' || value.name === null) &&
        typeof value.type === 'number' &&
        (typeof value.parentId === 'string' || value.parentId === null || value.parentId === undefined) &&
        (typeof value.position === 'number' || value.position === null || value.position === undefined) &&
        Array.isArray(value.permissionOverwrites)
    );
}

function isObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

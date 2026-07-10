import type { FluxerGuildChannel, FluxerGuildRole, FluxerGuildStructure } from './guild-structure.js';

export type FluxerGuildStructureSnapshot = {
    version: 1;
    guildId?: string;
    guildName?: string;
    botHighestRolePosition?: number;
    botHighestRoleHierarchyRank?: number;
    exportedAt?: string;
    roles: FluxerGuildRole[];
    categories: FluxerGuildChannel[];
    channels: FluxerGuildChannel[];
};

export type FluxerGuildStructureSnapshotValidationResult =
    | { type: 'valid'; snapshot: FluxerGuildStructureSnapshot }
    | { type: 'invalid'; message: string };

export function toFluxerGuildStructureSnapshot(
    structure: FluxerGuildStructure,
    exportedAt = new Date().toISOString()
): FluxerGuildStructureSnapshot {
    return {
        version: 1,
        guildId: structure.guildId,
        ...(typeof structure.guildName === 'string' && structure.guildName.trim()
            ? { guildName: structure.guildName.trim() }
            : {}),
        ...(typeof structure.botHighestRolePosition === 'number' && Number.isFinite(structure.botHighestRolePosition)
            ? { botHighestRolePosition: structure.botHighestRolePosition }
            : {}),
        ...(typeof structure.botHighestRoleHierarchyRank === 'number' &&
        Number.isFinite(structure.botHighestRoleHierarchyRank)
            ? { botHighestRoleHierarchyRank: structure.botHighestRoleHierarchyRank }
            : {}),
        exportedAt,
        roles: structure.roles,
        categories: structure.categories,
        channels: structure.channels,
    };
}

export function normalizeFluxerGuildStructureSnapshot(value: unknown): FluxerGuildStructureSnapshotValidationResult {
    if (!isObject(value)) {
        return { type: 'invalid', message: 'Server blueprint JSON must be an object.' };
    }

    const roles = normalizeRoles(value.roles);
    const categories = normalizeChannels(value.categories);
    const channels = normalizeChannels(value.channels);

    if (!roles || !categories || !channels) {
        return {
            type: 'invalid',
            message: 'Server blueprint JSON must include valid roles, categories, and channels arrays.',
        };
    }

    const guildId = normalizeOptionalText(value.guildId);
    const guildName = normalizeOptionalText(value.guildName);
    const exportedAt = normalizeOptionalText(value.exportedAt);
    const relationshipError = validateSnapshotRelationships({
        ...(guildId ? { guildId } : {}),
        roles,
        categories,
        channels,
    });

    if (relationshipError) return { type: 'invalid', message: relationshipError };

    return {
        type: 'valid',
        snapshot: {
            version: 1,
            ...(guildId ? { guildId } : {}),
            ...(guildName ? { guildName } : {}),
            ...(isNonNegativeNumber(value.botHighestRolePosition)
                ? { botHighestRolePosition: value.botHighestRolePosition }
                : {}),
            ...(isNonNegativeNumber(value.botHighestRoleHierarchyRank)
                ? { botHighestRoleHierarchyRank: value.botHighestRoleHierarchyRank }
                : {}),
            ...(exportedAt ? { exportedAt } : {}),
            roles,
            categories,
            channels,
        },
    };
}

function normalizeRoles(value: unknown): FluxerGuildRole[] | undefined {
    if (!Array.isArray(value)) return undefined;

    const roles: FluxerGuildRole[] = [];

    for (const role of value) {
        if (!isObject(role)) return undefined;
        if (
            !isNonEmptyText(role.id) ||
            !isNonEmptyText(role.name) ||
            !isNonNegativeInteger(role.position) ||
            !isRoleColor(role.color) ||
            typeof role.permissions !== 'string' ||
            typeof role.hoist !== 'boolean' ||
            typeof role.mentionable !== 'boolean' ||
            (role.hierarchyRank !== undefined && !isNonNegativeInteger(role.hierarchyRank))
        ) {
            return undefined;
        }

        roles.push({
            id: role.id.trim(),
            name: role.name,
            position: role.position,
            ...(role.hierarchyRank !== undefined ? { hierarchyRank: role.hierarchyRank } : {}),
            color: role.color,
            permissions: role.permissions,
            hoist: role.hoist,
            mentionable: role.mentionable,
            ...(role.protected === true ? { protected: true } : {}),
            ...(isRoleProtectionReason(role.protectionReason) ? { protectionReason: role.protectionReason } : {}),
        });
    }

    return roles;
}

function normalizeChannels(value: unknown): FluxerGuildChannel[] | undefined {
    if (!Array.isArray(value)) return undefined;

    const channels: FluxerGuildChannel[] = [];

    for (const channel of value) {
        if (!isObject(channel)) return undefined;

        const permissionOverwrites = normalizePermissionOverwrites(channel.permissionOverwrites);

        if (
            !isNonEmptyText(channel.id) ||
            (typeof channel.name !== 'string' && channel.name !== null) ||
            !isNonNegativeInteger(channel.type) ||
            (typeof channel.parentId !== 'string' && channel.parentId !== null && channel.parentId !== undefined) ||
            (channel.position !== null && channel.position !== undefined && !isNonNegativeInteger(channel.position)) ||
            !permissionOverwrites
        ) {
            return undefined;
        }

        const parentId = typeof channel.parentId === 'string' ? channel.parentId.trim() : null;
        if (typeof channel.parentId === 'string' && !parentId) return undefined;

        channels.push({
            id: channel.id.trim(),
            name: channel.name,
            type: channel.type,
            ...(typeof channel.url === 'string' || channel.url === null ? { url: channel.url } : {}),
            parentId,
            position: channel.position ?? null,
            permissionOverwrites,
        });
    }

    return channels;
}

function normalizePermissionOverwrites(value: unknown): FluxerGuildChannel['permissionOverwrites'] | undefined {
    if (!Array.isArray(value)) return undefined;

    const permissionOverwrites: FluxerGuildChannel['permissionOverwrites'] = [];

    for (const overwrite of value) {
        if (
            !isObject(overwrite) ||
            !isNonEmptyText(overwrite.id) ||
            (overwrite.type !== 0 && overwrite.type !== 1) ||
            typeof overwrite.allow !== 'string' ||
            typeof overwrite.deny !== 'string'
        ) {
            return undefined;
        }

        permissionOverwrites.push({
            id: overwrite.id.trim(),
            type: overwrite.type,
            allow: overwrite.allow,
            deny: overwrite.deny,
        });
    }

    return permissionOverwrites;
}

function validateSnapshotRelationships(input: {
    guildId?: string;
    roles: FluxerGuildRole[];
    categories: FluxerGuildChannel[];
    channels: FluxerGuildChannel[];
}): string | undefined {
    const ids = new Set<string>();

    for (const item of [...input.roles, ...input.categories, ...input.channels]) {
        if (ids.has(item.id)) return `Server blueprint JSON contains duplicate object id "${item.id}".`;
        ids.add(item.id);
    }

    const categoryIds = new Set(input.categories.map((category) => category.id));
    const roleIds = new Set(input.roles.map((role) => role.id));

    for (const category of input.categories) {
        if (category.type !== 4) return `Category "${category.id}" must use channel type 4.`;
        if (category.parentId !== null) return `Category "${category.id}" cannot have a parent category.`;
    }

    for (const channel of input.channels) {
        if (channel.type === 4) return `Channel "${channel.id}" cannot use category type 4.`;
        if (channel.parentId && !categoryIds.has(channel.parentId)) {
            return `Channel "${channel.id}" references missing parent category "${channel.parentId}".`;
        }
    }

    for (const channel of [...input.categories, ...input.channels]) {
        const overwriteKeys = new Set<string>();

        for (const overwrite of channel.permissionOverwrites) {
            const key = `${String(overwrite.type)}:${overwrite.id}`;
            if (overwriteKeys.has(key)) {
                return `Channel "${channel.id}" contains duplicate permission overwrite "${key}".`;
            }
            overwriteKeys.add(key);

            if (overwrite.type === 0 && overwrite.id !== input.guildId && !roleIds.has(overwrite.id)) {
                return `Channel "${channel.id}" references missing overwrite role "${overwrite.id}".`;
            }
        }
    }

    return undefined;
}

function normalizeOptionalText(value: unknown): string | undefined {
    return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function isNonEmptyText(value: unknown): value is string {
    return typeof value === 'string' && value.trim().length > 0;
}

function isNonNegativeInteger(value: unknown): value is number {
    return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function isNonNegativeNumber(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function isRoleColor(value: unknown): value is number {
    return isNonNegativeInteger(value) && value <= 0xffffff;
}

function isRoleProtectionReason(value: unknown): value is NonNullable<FluxerGuildRole['protectionReason']> {
    return value === 'everyone' || value === 'bot' || value === 'integration' || value === 'managed';
}

function isObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}

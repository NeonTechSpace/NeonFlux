import type { BlueprintChannel, BlueprintRole, BlueprintStructure } from './contracts.js';

export const BLUEPRINT_SNAPSHOT_LIMITS = {
    maxJsonBytes: 4 * 1024 * 1024,
    maxRoles: 250,
    maxCategories: 500,
    maxChannels: 500,
    maxTotalChannels: 500,
    maxPermissionOverwritesPerChannel: 1_000,
    maxIdLength: 64,
    maxGuildNameLength: 100,
    maxRoleNameLength: 100,
    maxChannelNameLength: 100,
    maxChannelUrlLength: 2_048,
    maxExportedAtLength: 64,
    maxPermissionBitfieldLength: 32,
} as const;

export type BlueprintSnapshot = {
    version: 1;
    guildId?: string;
    guildName?: string;
    botHighestRolePosition?: number;
    botHighestRoleHierarchyRank?: number;
    exportedAt?: string;
    roles: BlueprintRole[];
    categories: BlueprintChannel[];
    channels: BlueprintChannel[];
};

export type BlueprintSnapshotFingerprintInput = Omit<BlueprintSnapshot, 'exportedAt'>;

export type BlueprintSnapshotValidationResult =
    | { type: 'valid'; snapshot: BlueprintSnapshot }
    | { type: 'invalid'; message: string };

export function toBlueprintSnapshot(
    structure: BlueprintStructure,
    exportedAt = new Date().toISOString()
): BlueprintSnapshot {
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

export function toPortableBlueprintSnapshot(
    structure: BlueprintStructure,
    exportedAt = new Date().toISOString()
): BlueprintSnapshot {
    return toPortableBlueprintRestoreSnapshot(toBlueprintSnapshot(structure, exportedAt));
}

/**
 * Derives the durable recovery snapshot from one already-normalized full
 * observation. This is intentionally deterministic: callers must not supply a
 * second independently-built portable snapshot alongside the full snapshot.
 */
export function toPortableBlueprintRestoreSnapshot(snapshot: BlueprintSnapshot): BlueprintSnapshot {
    const botRoleIds = new Set(snapshot.roles.filter((role) => role.protectionReason === 'bot').map((role) => role.id));

    if (botRoleIds.size === 0) return snapshot;

    const omitBotRoleOverwrites = (channel: BlueprintChannel): BlueprintChannel => ({
        ...channel,
        permissionOverwrites: channel.permissionOverwrites.filter(
            (overwrite) => overwrite.type !== 0 || !botRoleIds.has(overwrite.id)
        ),
    });

    return {
        ...snapshot,
        roles: snapshot.roles.filter((role) => !botRoleIds.has(role.id)),
        categories: snapshot.categories.map(omitBotRoleOverwrites),
        channels: snapshot.channels.map(omitBotRoleOverwrites),
    };
}

export function createBlueprintSnapshotFingerprintInput(
    snapshot: BlueprintSnapshot
): BlueprintSnapshotFingerprintInput {
    return {
        version: snapshot.version,
        ...(snapshot.guildId !== undefined ? { guildId: snapshot.guildId } : {}),
        ...(snapshot.guildName !== undefined ? { guildName: snapshot.guildName } : {}),
        ...(snapshot.botHighestRolePosition !== undefined
            ? { botHighestRolePosition: snapshot.botHighestRolePosition }
            : {}),
        ...(snapshot.botHighestRoleHierarchyRank !== undefined
            ? { botHighestRoleHierarchyRank: snapshot.botHighestRoleHierarchyRank }
            : {}),
        roles: snapshot.roles,
        categories: snapshot.categories,
        channels: snapshot.channels,
    };
}

export function isBlueprintSnapshotJsonWithinByteLimit(value: string): boolean {
    const maximum = BLUEPRINT_SNAPSHOT_LIMITS.maxJsonBytes;
    let bytes = 0;

    for (let index = 0; index < value.length; index += 1) {
        const codeUnit = value.charCodeAt(index);
        if (codeUnit <= 0x7f) bytes += 1;
        else if (codeUnit <= 0x7ff) bytes += 2;
        else if (codeUnit >= 0xd800 && codeUnit <= 0xdbff && isLowSurrogate(value.charCodeAt(index + 1))) {
            bytes += 4;
            index += 1;
        } else bytes += 3;

        if (bytes > maximum) return false;
    }

    return true;
}

function isLowSurrogate(value: number): boolean {
    return value >= 0xdc00 && value <= 0xdfff;
}

export function normalizeBlueprintSnapshot(value: unknown): BlueprintSnapshotValidationResult {
    if (!isObject(value)) {
        return { type: 'invalid', message: 'Server blueprint JSON must be an object.' };
    }

    const boundsError = validateSnapshotBounds(value);
    if (boundsError) return { type: 'invalid', message: boundsError };

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

function validateSnapshotBounds(value: Record<string, unknown>): string | undefined {
    const limits = BLUEPRINT_SNAPSHOT_LIMITS;

    const topLevelTextError =
        validateOptionalTextLength(value.guildId, limits.maxIdLength, 'Server id') ??
        validateOptionalTextLength(value.guildName, limits.maxGuildNameLength, 'Server name') ??
        validateOptionalTextLength(value.exportedAt, limits.maxExportedAtLength, 'Export timestamp');
    if (topLevelTextError) return topLevelTextError;

    if (Array.isArray(value.roles) && value.roles.length > limits.maxRoles) {
        return `Server blueprint JSON cannot contain more than ${String(limits.maxRoles)} roles.`;
    }
    if (Array.isArray(value.categories) && value.categories.length > limits.maxCategories) {
        return `Server blueprint JSON cannot contain more than ${String(limits.maxCategories)} categories.`;
    }
    if (Array.isArray(value.channels) && value.channels.length > limits.maxChannels) {
        return `Server blueprint JSON cannot contain more than ${String(limits.maxChannels)} channels.`;
    }
    if (
        Array.isArray(value.categories) &&
        Array.isArray(value.channels) &&
        value.categories.length + value.channels.length > limits.maxTotalChannels
    ) {
        return `Server blueprint JSON cannot contain more than ${String(limits.maxTotalChannels)} total categories and channels.`;
    }

    if (Array.isArray(value.roles)) {
        for (const [index, role] of value.roles.entries()) {
            if (!isObject(role)) continue;
            const roleError =
                validateOptionalTextLength(role.id, limits.maxIdLength, `Role ${String(index + 1)} id`) ??
                validateOptionalTextLength(role.name, limits.maxRoleNameLength, `Role ${String(index + 1)} name`) ??
                validateOptionalTextLength(
                    role.permissions,
                    limits.maxPermissionBitfieldLength,
                    `Role ${String(index + 1)} permissions`
                );
            if (roleError) return roleError;
        }
    }

    for (const collection of [value.categories, value.channels]) {
        if (!Array.isArray(collection)) continue;

        for (const [index, channel] of collection.entries()) {
            if (!isObject(channel)) continue;
            const channelLabel = collection === value.categories ? 'Category' : 'Channel';
            const channelError =
                validateOptionalTextLength(channel.id, limits.maxIdLength, `${channelLabel} ${String(index + 1)} id`) ??
                validateOptionalTextLength(
                    channel.name,
                    limits.maxChannelNameLength,
                    `${channelLabel} ${String(index + 1)} name`
                ) ??
                validateOptionalTextLength(
                    channel.url,
                    limits.maxChannelUrlLength,
                    `${channelLabel} ${String(index + 1)} URL`
                ) ??
                validateOptionalTextLength(
                    channel.parentId,
                    limits.maxIdLength,
                    `${channelLabel} ${String(index + 1)} parent id`
                );
            if (channelError) return channelError;

            if (!Array.isArray(channel.permissionOverwrites)) continue;
            if (channel.permissionOverwrites.length > limits.maxPermissionOverwritesPerChannel) {
                return `${channelLabel} ${String(index + 1)} cannot contain more than ${String(limits.maxPermissionOverwritesPerChannel)} permission overwrites.`;
            }

            for (const [overwriteIndex, overwrite] of channel.permissionOverwrites.entries()) {
                if (!isObject(overwrite)) continue;
                const overwriteLabel = `${channelLabel} ${String(index + 1)} permission overwrite ${String(overwriteIndex + 1)}`;
                const overwriteError =
                    validateOptionalTextLength(overwrite.id, limits.maxIdLength, `${overwriteLabel} id`) ??
                    validateOptionalTextLength(
                        overwrite.allow,
                        limits.maxPermissionBitfieldLength,
                        `${overwriteLabel} allow value`
                    ) ??
                    validateOptionalTextLength(
                        overwrite.deny,
                        limits.maxPermissionBitfieldLength,
                        `${overwriteLabel} deny value`
                    );
                if (overwriteError) return overwriteError;
            }
        }
    }

    return undefined;
}

function validateOptionalTextLength(value: unknown, maximum: number, label: string): string | undefined {
    return typeof value === 'string' && value.length > maximum
        ? `${label} cannot exceed ${String(maximum)} characters.`
        : undefined;
}

function normalizeRoles(value: unknown): BlueprintRole[] | undefined {
    if (!Array.isArray(value)) return undefined;

    const roles: BlueprintRole[] = [];

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

function normalizeChannels(value: unknown): BlueprintChannel[] | undefined {
    if (!Array.isArray(value)) return undefined;

    const channels: BlueprintChannel[] = [];

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

function normalizePermissionOverwrites(value: unknown): BlueprintChannel['permissionOverwrites'] | undefined {
    if (!Array.isArray(value)) return undefined;

    const permissionOverwrites: BlueprintChannel['permissionOverwrites'] = [];

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
    roles: BlueprintRole[];
    categories: BlueprintChannel[];
    channels: BlueprintChannel[];
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

function isRoleProtectionReason(value: unknown): value is NonNullable<BlueprintRole['protectionReason']> {
    return value === 'everyone' || value === 'bot' || value === 'integration' || value === 'managed';
}

function isObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}

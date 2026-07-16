import { err, ok, type Result } from 'neverthrow';

import type {
    FluxerGuildChannel,
    FluxerGuildRole,
    FluxerGuildRoleProtectionReason,
    FluxerGuildStructure,
    FluxerPermissionOverwrite,
} from './guild-structure.js';

export const botProviderReadProtocolVersion = 1 as const;
export const botProviderReadJwtAudience = 'neonflux-bot-provider-read-v1';
export const botProviderReadGuildStructurePathPrefix = '/v1/provider/guilds/';

export type BotProviderReadGuildStructureResponse =
    | { protocolVersion: typeof botProviderReadProtocolVersion; type: 'structure'; structure: FluxerGuildStructure }
    | { protocolVersion: typeof botProviderReadProtocolVersion; type: 'unavailable-or-not-found' }
    | { protocolVersion: typeof botProviderReadProtocolVersion; type: 'read-failed' }
    | { protocolVersion: typeof botProviderReadProtocolVersion; type: 'overloaded' };

export function createBotProviderReadGuildStructurePath(guildId: string): string {
    return `${botProviderReadGuildStructurePathPrefix}${encodeURIComponent(guildId)}/structure`;
}

export function parseBotProviderReadGuildStructureResponse(
    value: unknown
): Result<BotProviderReadGuildStructureResponse, 'invalid-response'> {
    if (
        !isRecord(value) ||
        value.protocolVersion !== botProviderReadProtocolVersion ||
        typeof value.type !== 'string'
    ) {
        return err('invalid-response');
    }

    switch (value.type) {
        case 'structure': {
            if (!isExactRecord(value, ['protocolVersion', 'structure', 'type'])) return err('invalid-response');
            const structure = parseGuildStructure(value.structure);
            return structure
                ? ok({ protocolVersion: botProviderReadProtocolVersion, type: 'structure', structure })
                : err('invalid-response');
        }
        case 'overloaded':
        case 'read-failed':
        case 'unavailable-or-not-found':
            return isExactRecord(value, ['protocolVersion', 'type'])
                ? ok({ protocolVersion: botProviderReadProtocolVersion, type: value.type })
                : err('invalid-response');
        default:
            return err('invalid-response');
    }
}

function parseGuildStructure(value: unknown): FluxerGuildStructure | undefined {
    if (!isRecord(value)) return undefined;

    const allowedKeys = [
        'botHighestRoleHierarchyRank',
        'botHighestRolePosition',
        'categories',
        'channels',
        'guildId',
        'guildName',
        'roles',
    ];
    if (!hasOnlyKeys(value, allowedKeys)) return undefined;
    if (!isNonEmptyString(value.guildId) || typeof value.guildName !== 'string') return undefined;
    if (!isOptionalFiniteNumber(value.botHighestRolePosition)) return undefined;
    if (!isOptionalFiniteNumber(value.botHighestRoleHierarchyRank)) return undefined;
    if (!Array.isArray(value.roles) || !Array.isArray(value.channels) || !Array.isArray(value.categories)) {
        return undefined;
    }

    const roles = value.roles.map(parseRole);
    const channels = value.channels.map(parseChannel);
    const categories = value.categories.map(parseChannel);
    if (
        roles.some((role) => !role) ||
        channels.some((channel) => !channel) ||
        categories.some((category) => !category)
    ) {
        return undefined;
    }

    return {
        guildId: value.guildId,
        guildName: value.guildName,
        ...(typeof value.botHighestRolePosition === 'number'
            ? { botHighestRolePosition: value.botHighestRolePosition }
            : {}),
        ...(typeof value.botHighestRoleHierarchyRank === 'number'
            ? { botHighestRoleHierarchyRank: value.botHighestRoleHierarchyRank }
            : {}),
        roles: roles as FluxerGuildRole[],
        channels: channels as FluxerGuildChannel[],
        categories: categories as FluxerGuildChannel[],
    };
}

function parseRole(value: unknown): FluxerGuildRole | undefined {
    if (!isRecord(value)) return undefined;
    if (
        !hasOnlyKeys(value, [
            'color',
            'hierarchyRank',
            'hoist',
            'id',
            'mentionable',
            'name',
            'permissions',
            'position',
            'protected',
            'protectionReason',
        ]) ||
        !isNonEmptyString(value.id) ||
        typeof value.name !== 'string' ||
        !isFiniteNumber(value.position) ||
        !isOptionalFiniteNumber(value.hierarchyRank) ||
        !isFiniteNumber(value.color) ||
        typeof value.permissions !== 'string' ||
        typeof value.hoist !== 'boolean' ||
        typeof value.mentionable !== 'boolean' ||
        !isOptionalBoolean(value.protected) ||
        !isOptionalProtectionReason(value.protectionReason)
    ) {
        return undefined;
    }

    return {
        id: value.id,
        name: value.name,
        position: value.position,
        ...(typeof value.hierarchyRank === 'number' ? { hierarchyRank: value.hierarchyRank } : {}),
        color: value.color,
        permissions: value.permissions,
        hoist: value.hoist,
        mentionable: value.mentionable,
        ...(typeof value.protected === 'boolean' ? { protected: value.protected } : {}),
        ...(isProtectionReason(value.protectionReason) ? { protectionReason: value.protectionReason } : {}),
    };
}

function parseChannel(value: unknown): FluxerGuildChannel | undefined {
    if (
        !isExactRecord(value, ['id', 'name', 'type', 'parentId', 'position', 'permissionOverwrites'], ['url']) ||
        !isNonEmptyString(value.id) ||
        (typeof value.name !== 'string' && value.name !== null) ||
        !isFiniteNumber(value.type) ||
        (typeof value.url !== 'string' && value.url !== null && value.url !== undefined) ||
        (typeof value.parentId !== 'string' && value.parentId !== null) ||
        (typeof value.position !== 'number' && value.position !== null) ||
        (typeof value.position === 'number' && !Number.isFinite(value.position)) ||
        !Array.isArray(value.permissionOverwrites)
    ) {
        return undefined;
    }

    const permissionOverwrites = value.permissionOverwrites.map(parsePermissionOverwrite);
    if (permissionOverwrites.some((overwrite) => !overwrite)) return undefined;

    return {
        id: value.id,
        name: value.name,
        type: value.type,
        ...(value.url !== undefined ? { url: value.url } : {}),
        parentId: value.parentId,
        position: value.position,
        permissionOverwrites: permissionOverwrites as FluxerPermissionOverwrite[],
    };
}

function parsePermissionOverwrite(value: unknown): FluxerPermissionOverwrite | undefined {
    if (
        !isExactRecord(value, ['allow', 'deny', 'id', 'type']) ||
        !isNonEmptyString(value.id) ||
        !isFiniteNumber(value.type) ||
        typeof value.allow !== 'string' ||
        typeof value.deny !== 'string'
    ) {
        return undefined;
    }

    return { id: value.id, type: value.type, allow: value.allow, deny: value.deny };
}

function isExactRecord(
    value: unknown,
    requiredKeys: readonly string[],
    optionalKeys: readonly string[] = []
): value is Record<string, unknown> {
    if (!isRecord(value) || requiredKeys.some((key) => !(key in value))) return false;
    return hasOnlyKeys(value, [...requiredKeys, ...optionalKeys]);
}

function hasOnlyKeys(value: Record<string, unknown>, allowedKeys: readonly string[]): boolean {
    const allowed = new Set(allowedKeys);
    return Object.keys(value).every((key) => allowed.has(key));
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
    return typeof value === 'string' && value.trim().length > 0;
}

function isFiniteNumber(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value);
}

function isOptionalFiniteNumber(value: unknown): value is number | undefined {
    return value === undefined || isFiniteNumber(value);
}

function isOptionalBoolean(value: unknown): value is boolean | undefined {
    return value === undefined || typeof value === 'boolean';
}

function isProtectionReason(value: unknown): value is FluxerGuildRoleProtectionReason {
    return value === 'everyone' || value === 'bot' || value === 'integration' || value === 'managed';
}

function isOptionalProtectionReason(value: unknown): value is FluxerGuildRoleProtectionReason | undefined {
    return value === undefined || isProtectionReason(value);
}

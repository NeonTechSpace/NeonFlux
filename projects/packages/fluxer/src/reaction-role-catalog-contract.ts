import { err, ok, type Result } from 'neverthrow';

import type { FluxerReactionRoleCatalog } from './reaction-roles.js';

export const reactionRoleCatalogProtocolVersion = 1 as const;
export const reactionRoleCatalogJwtAudience = 'neonflux-bot-reaction-role-catalog-v1';
export const reactionRoleCatalogPathPrefix = '/v1/provider/guilds/';

export type ReactionRoleCatalogResponse =
    | {
          catalog: FluxerReactionRoleCatalog;
          protocolVersion: typeof reactionRoleCatalogProtocolVersion;
          type: 'catalog';
      }
    | {
          protocolVersion: typeof reactionRoleCatalogProtocolVersion;
          type: 'overloaded' | 'read-failed' | 'unavailable-or-not-found';
      };

export function createReactionRoleCatalogPath(guildId: string): string {
    return `${reactionRoleCatalogPathPrefix}${encodeURIComponent(guildId)}/reaction-roles/catalog`;
}

export function parseReactionRoleCatalogResponse(
    value: unknown
): Result<ReactionRoleCatalogResponse, 'invalid-response'> {
    if (!isRecord(value) || value.protocolVersion !== reactionRoleCatalogProtocolVersion) {
        return err('invalid-response');
    }
    if (value.type === 'overloaded' || value.type === 'read-failed' || value.type === 'unavailable-or-not-found') {
        return hasExactKeys(value, ['protocolVersion', 'type'])
            ? ok({ protocolVersion: reactionRoleCatalogProtocolVersion, type: value.type })
            : err('invalid-response');
    }
    if (value.type !== 'catalog' || !hasExactKeys(value, ['catalog', 'protocolVersion', 'type'])) {
        return err('invalid-response');
    }
    const catalog = parseCatalog(value.catalog);
    return catalog
        ? ok({ catalog, protocolVersion: reactionRoleCatalogProtocolVersion, type: 'catalog' })
        : err('invalid-response');
}

function parseCatalog(value: unknown): FluxerReactionRoleCatalog | undefined {
    if (
        !isRecord(value) ||
        !hasExactKeys(value, ['channels', 'emojis', 'guildId', 'guildName', 'roles']) ||
        !isNonEmptyString(value.guildId) ||
        typeof value.guildName !== 'string' ||
        !Array.isArray(value.channels) ||
        !Array.isArray(value.roles) ||
        !Array.isArray(value.emojis)
    ) {
        return undefined;
    }
    const channels = value.channels.map(parseChannel);
    const roles = value.roles.map(parseRole);
    const emojis = value.emojis.map(parseEmoji);
    if ([...channels, ...roles, ...emojis].some((item) => item === undefined)) return undefined;
    return {
        guildId: value.guildId,
        guildName: value.guildName,
        channels: channels as FluxerReactionRoleCatalog['channels'],
        roles: roles as FluxerReactionRoleCatalog['roles'],
        emojis: emojis as FluxerReactionRoleCatalog['emojis'],
    };
}

function parseChannel(value: unknown): FluxerReactionRoleCatalog['channels'][number] | undefined {
    if (
        !isRecord(value) ||
        !hasOnlyKeys(value, ['eligible', 'id', 'name', 'parentId', 'parentName', 'position', 'reason']) ||
        !isNonEmptyString(value.id) ||
        typeof value.name !== 'string' ||
        typeof value.eligible !== 'boolean' ||
        (typeof value.parentId !== 'string' && value.parentId !== null) ||
        (typeof value.parentName !== 'string' && value.parentName !== null) ||
        (typeof value.position !== 'number' && value.position !== null) ||
        (value.reason !== undefined && value.reason !== 'missing-permissions' && value.reason !== 'unsupported-channel')
    ) {
        return undefined;
    }
    return value as FluxerReactionRoleCatalog['channels'][number];
}

function parseRole(value: unknown): FluxerReactionRoleCatalog['roles'][number] | undefined {
    if (
        !isRecord(value) ||
        !hasOnlyKeys(value, ['color', 'eligible', 'id', 'name', 'reason']) ||
        !isNonEmptyString(value.id) ||
        typeof value.name !== 'string' ||
        typeof value.color !== 'number' ||
        typeof value.eligible !== 'boolean' ||
        (value.reason !== undefined &&
            value.reason !== 'hierarchy' &&
            value.reason !== 'invalid-permissions' &&
            value.reason !== 'missing-permissions' &&
            value.reason !== 'privileged' &&
            value.reason !== 'protected')
    ) {
        return undefined;
    }
    return value as FluxerReactionRoleCatalog['roles'][number];
}

function parseEmoji(value: unknown): FluxerReactionRoleCatalog['emojis'][number] | undefined {
    if (
        !isRecord(value) ||
        !hasExactKeys(value, ['animated', 'id', 'markup', 'name', 'url']) ||
        !isNonEmptyString(value.id) ||
        !isNonEmptyString(value.name) ||
        !isNonEmptyString(value.markup) ||
        !isHttpUrl(value.url) ||
        typeof value.animated !== 'boolean'
    ) {
        return undefined;
    }
    return value as FluxerReactionRoleCatalog['emojis'][number];
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
    return keys.every((key) => key in value) && hasOnlyKeys(value, keys);
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
    const allowed = new Set(keys);
    return Object.keys(value).every((key) => allowed.has(key));
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
    return typeof value === 'string' && value.trim().length > 0;
}

function isHttpUrl(value: unknown): value is string {
    if (!isNonEmptyString(value)) return false;
    try {
        const protocol = new URL(value).protocol;
        return protocol === 'http:' || protocol === 'https:';
    } catch {
        return false;
    }
}

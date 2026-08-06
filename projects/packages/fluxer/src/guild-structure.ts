import type { Client, Guild, GuildChannel } from '@fluxerjs/core';
import { err, ok, type Result } from 'neverthrow';

import { createFluxerAuthenticatedRestClient, fluxerBoundedNoRetryRestOptions } from './authenticated-rest-client.js';
import { isFluxerGuildUnavailable } from './guild-availability.js';

const GUILD_CATEGORY_CHANNEL_TYPE = 4;

export type FluxerGuildRoleProtectionReason = 'everyone' | 'bot' | 'integration' | 'managed';

export type FluxerGuildRole = {
    id: string;
    name: string;
    position: number;
    hierarchyRank?: number;
    color: number;
    permissions: string;
    hoist: boolean;
    mentionable: boolean;
    protected?: boolean;
    protectionReason?: FluxerGuildRoleProtectionReason;
};

export type FluxerPermissionOverwrite = {
    id: string;
    type: number;
    allow: string;
    deny: string;
};

export type FluxerGuildChannel = {
    id: string;
    name: string | null;
    type: number;
    url?: string | null;
    parentId: string | null;
    position: number | null;
    permissionOverwrites: FluxerPermissionOverwrite[];
};

export type FluxerGuildStructure = {
    guildId: string;
    guildName: string;
    botHighestRolePosition?: number;
    botHighestRoleHierarchyRank?: number;
    roles: FluxerGuildRole[];
    channels: FluxerGuildChannel[];
    categories: FluxerGuildChannel[];
};

export type FluxerGuildStructureObservation = {
    observedAt: string;
    source: 'resident-client' | 'token-client';
    structure: FluxerGuildStructure;
};

export type ReadFluxerGuildStructureInput = {
    botUserId?: string;
    client: Client;
    guildId: string;
};

export type ReadFluxerBotGuildStructureInput = Omit<ReadFluxerGuildStructureInput, 'client'> & {
    botToken: string;
};

type FluxerBotHighestRole = {
    position: number;
    hierarchyRank?: number;
    roleIds: string[];
};

export type ReadFluxerGuildStructureError =
    | { type: 'missing-input'; field: 'guildId' }
    | { type: 'unavailable-or-not-found' }
    | { type: 'fetch-failed'; error: unknown }
    | { type: 'invalid-response' };

export type ReadFluxerBotGuildStructureError =
    | ReadFluxerGuildStructureError
    | { type: 'missing-input'; field: 'botToken' }
    | { type: 'authentication-failed'; error: unknown };

export async function readFluxerBotGuildStructure(
    input: ReadFluxerBotGuildStructureInput
): Promise<Result<FluxerGuildStructure, ReadFluxerBotGuildStructureError>> {
    const botToken = input.botToken.trim();

    if (!botToken) {
        return err({ type: 'missing-input', field: 'botToken' });
    }

    const client = createFluxerAuthenticatedRestClient(botToken, fluxerBoundedNoRetryRestOptions);

    try {
        const botUserId = await readAuthenticatedBotUserId(client);

        return await readFluxerGuildStructure({
            botUserId,
            client,
            guildId: input.guildId,
        });
    } catch (error) {
        return err({ type: 'authentication-failed', error });
    } finally {
        await client.destroy().catch(() => undefined);
    }
}

export async function readFluxerBotGuildStructureObservation(
    input: ReadFluxerBotGuildStructureInput
): Promise<Result<FluxerGuildStructureObservation, ReadFluxerBotGuildStructureError>> {
    const result = await readFluxerBotGuildStructure(input);
    return result.map((structure) => ({
        observedAt: new Date().toISOString(),
        source: 'token-client' as const,
        structure,
    }));
}

export async function readFluxerGuildStructureObservation(
    input: ReadFluxerGuildStructureInput
): Promise<Result<FluxerGuildStructureObservation, ReadFluxerGuildStructureError>> {
    const result = await readFluxerGuildStructure(input);
    return result.map((structure) => ({
        observedAt: new Date().toISOString(),
        source: 'resident-client' as const,
        structure,
    }));
}

export async function readFluxerGuildStructure(
    input: ReadFluxerGuildStructureInput
): Promise<Result<FluxerGuildStructure, ReadFluxerGuildStructureError>> {
    const guildId = input.guildId.trim();

    if (!guildId) {
        return err({ type: 'missing-input', field: 'guildId' });
    }

    const guildResult = await fetchFluxerGuild(input.client, guildId);

    if (guildResult.isErr()) {
        return err(guildResult.error);
    }

    if (!guildResult.value || isFluxerGuildUnavailable(guildResult.value)) {
        return err({ type: 'unavailable-or-not-found' });
    }

    const structureResult = await fetchGuildStructure(guildResult.value);

    if (structureResult.isErr()) {
        return err(structureResult.error);
    }

    const botHighestRolePositionResult = await readBotHighestRolePosition(
        input.client,
        guildResult.value,
        structureResult.value.roles,
        input.botUserId
    );

    if (botHighestRolePositionResult.isErr()) {
        return err(botHighestRolePositionResult.error);
    }

    const normalizedRoles = normalizeRoles(
        structureResult.value.roles,
        guildId,
        botHighestRolePositionResult.value?.roleIds
    );
    const normalizedChannelResult = normalizeChannels(structureResult.value.channels);

    if (!normalizedRoles || !normalizedChannelResult) {
        return err({ type: 'invalid-response' });
    }

    return ok({
        guildId,
        guildName: normalizeGuildName(guildResult.value, guildId),
        ...(typeof botHighestRolePositionResult.value?.position === 'number'
            ? { botHighestRolePosition: botHighestRolePositionResult.value.position }
            : {}),
        ...(botHighestRolePositionResult.value && typeof botHighestRolePositionResult.value.hierarchyRank === 'number'
            ? { botHighestRoleHierarchyRank: botHighestRolePositionResult.value.hierarchyRank }
            : {}),
        roles: normalizedRoles,
        channels: normalizedChannelResult.channels,
        categories: normalizedChannelResult.categories,
    });
}

async function fetchFluxerGuild(
    client: Client,
    guildId: string
): Promise<Result<Guild | null, Extract<ReadFluxerGuildStructureError, { type: 'fetch-failed' }>>> {
    try {
        return ok(await client.guilds.fetch(guildId));
    } catch (error) {
        return err({ type: 'fetch-failed', error });
    }
}

async function fetchGuildStructure(
    guild: Guild
): Promise<
    Result<
        { roles: unknown[]; channels: GuildChannel[] },
        Extract<ReadFluxerGuildStructureError, { type: 'fetch-failed' }>
    >
> {
    try {
        const [roles, channels] = await Promise.all([fetchGuildRoles(guild), guild.fetchChannels()]);

        return ok({ roles, channels });
    } catch (error) {
        return err({ type: 'fetch-failed', error });
    }
}

async function fetchGuildRoles(guild: Guild): Promise<unknown[]> {
    const rest = readClientRest(guild);
    const guildId = readGuildId(guild);

    if (!rest || !guildId) return guild.fetchRoles();

    const data = await rest.get(`/guilds/${guildId}/roles`, { auth: true });
    if (Array.isArray(data)) return data.map((role: unknown) => role);
    if (!isObject(data)) throw new Error('Invalid guild roles response.');

    return Object.values(data);
}

function readClientRest(guild: Guild): { get: (path: string, options?: unknown) => Promise<unknown> } | undefined {
    const guildLike = guild as unknown as { client?: unknown };
    const client = isObject(guildLike.client) ? guildLike.client : undefined;
    const rest = isObject(client?.rest) ? client.rest : undefined;
    return typeof rest?.get === 'function'
        ? (rest as { get: (path: string, options?: unknown) => Promise<unknown> })
        : undefined;
}

function readGuildId(guild: Guild): string | undefined {
    const guildLike = guild as unknown as { id?: unknown };
    return typeof guildLike.id === 'string' && guildLike.id.trim() ? guildLike.id.trim() : undefined;
}

async function readBotHighestRolePosition(
    client: Client,
    guild: Guild,
    roles: unknown[],
    authenticatedBotUserId?: string
): Promise<Result<FluxerBotHighestRole | undefined, Extract<ReadFluxerGuildStructureError, { type: 'fetch-failed' }>>> {
    const botUserId = authenticatedBotUserId ?? readClientUserId(client);
    const fetchMember = readGuildFetchMember(guild);

    if (!botUserId || !fetchMember) {
        return ok(undefined);
    }

    try {
        const member = await fetchMember(botUserId);
        const roleIds = readMemberRoleIds(member);

        if (!roleIds) {
            return ok(undefined);
        }

        const rolePositionById = createRolePositionById(roles);
        const roleHierarchyRankById = createRoleHierarchyRankById(roles);
        const highestRole = roleIds.reduce<FluxerBotHighestRole | undefined>((highest, roleId) => {
            const position = rolePositionById.get(roleId);
            if (typeof position !== 'number') return highest;

            const hierarchyRank = roleHierarchyRankById.get(roleId);
            if (
                !highest ||
                compareRoleHierarchy(position, hierarchyRank, highest.position, highest.hierarchyRank) < 0
            ) {
                return { position, roleIds, ...(typeof hierarchyRank === 'number' ? { hierarchyRank } : {}) };
            }

            return highest;
        }, undefined);

        return ok(highestRole);
    } catch (error) {
        return err({ type: 'fetch-failed', error });
    }
}

async function readAuthenticatedBotUserId(client: Client): Promise<string> {
    const user = await client.rest.get<unknown>('/users/@me', { auth: true });
    if (!isObject(user) || typeof user.id !== 'string' || !user.id.trim()) {
        throw new Error('Invalid authenticated bot user response.');
    }
    return user.id.trim();
}

function readClientUserId(client: Client): string | undefined {
    const clientLike = client as unknown as { user?: { id?: unknown } };
    return typeof clientLike.user?.id === 'string' && clientLike.user.id.trim() ? clientLike.user.id.trim() : undefined;
}

function readGuildFetchMember(guild: Guild): ((userId: string) => Promise<unknown>) | undefined {
    const guildLike = guild as unknown as { fetchMember?: unknown };
    return typeof guildLike.fetchMember === 'function'
        ? (guildLike.fetchMember as (userId: string) => Promise<unknown>).bind(guild)
        : undefined;
}

function readMemberRoleIds(member: unknown): string[] | undefined {
    if (!isObject(member)) return undefined;

    const roles = isObject(member.roles) ? member.roles : undefined;
    const roleIds = roles?.roleIds;

    if (!isIterable(roleIds)) return undefined;

    return [...roleIds].filter((roleId): roleId is string => typeof roleId === 'string' && roleId.trim().length > 0);
}

function createRolePositionById(roles: unknown[]): Map<string, number> {
    const rolePositionById = new Map<string, number>();

    for (const role of roles) {
        if (!isObject(role) || typeof role.id !== 'string') continue;
        const position = readRolePosition(role);
        if (typeof position === 'number') {
            rolePositionById.set(role.id, position);
        }
    }

    return rolePositionById;
}

function createRoleHierarchyRankById(roles: unknown[]): Map<string, number> {
    const orderedRoles = roles
        .filter(isObject)
        .filter((role): role is Record<string, unknown> & { id: string } => typeof role.id === 'string')
        .filter((role) => typeof readRolePosition(role) === 'number')
        .sort((left, right) => {
            const positionDifference = (readRolePosition(right) ?? 0) - (readRolePosition(left) ?? 0);
            return positionDifference !== 0 ? positionDifference : left.id.localeCompare(right.id);
        });
    return new Map(orderedRoles.map((role, index) => [role.id, index]));
}

function compareRoleHierarchy(
    leftPosition: number,
    leftHierarchyRank: number | undefined,
    rightPosition: number,
    rightHierarchyRank: number | undefined
): number {
    if (leftPosition !== rightPosition) return rightPosition - leftPosition;
    if (typeof leftHierarchyRank === 'number' && typeof rightHierarchyRank === 'number') {
        return leftHierarchyRank - rightHierarchyRank;
    }

    return 0;
}

function normalizeRoles(
    roles: unknown,
    guildId: string,
    botRoleIds: readonly string[] = []
): FluxerGuildRole[] | undefined {
    if (!Array.isArray(roles)) {
        return undefined;
    }

    const normalizedRoles: FluxerGuildRole[] = [];
    const botRoleIdSet = new Set(botRoleIds);
    const roleRankById = createRoleHierarchyRankById(roles);

    for (const role of roles) {
        const normalizedRole = normalizeRole(
            role,
            guildId,
            isObject(role) ? roleRankById.get(String(role.id)) : undefined,
            isObject(role) && typeof role.id === 'string' && botRoleIdSet.has(role.id)
        );

        if (!normalizedRole) {
            return undefined;
        }

        normalizedRoles.push(normalizedRole);
    }

    return normalizedRoles;
}

function normalizeRole(
    role: unknown,
    guildId: string,
    hierarchyRank?: number,
    isBotAssignedRole = false
): FluxerGuildRole | undefined {
    if (!isObject(role)) {
        return undefined;
    }

    const permissions = getPermissionBitfield(role.permissions);

    if (
        typeof role.id !== 'string' ||
        typeof role.name !== 'string' ||
        typeof role.position !== 'number' ||
        typeof role.color !== 'number' ||
        typeof role.hoist !== 'boolean' ||
        typeof role.mentionable !== 'boolean' ||
        typeof permissions !== 'string'
    ) {
        return undefined;
    }

    const position = readRolePosition(role);

    if (typeof position !== 'number') {
        return undefined;
    }

    const protection = isBotAssignedRole ? 'bot' : readRoleProtection(role, guildId);

    return {
        id: role.id,
        name: role.name,
        position,
        ...(typeof hierarchyRank === 'number' ? { hierarchyRank } : {}),
        color: role.color,
        permissions,
        hoist: role.hoist,
        mentionable: role.mentionable,
        ...(protection ? { protected: true, protectionReason: protection } : {}),
    };
}

function readRolePosition(role: Record<string, unknown>): number | undefined {
    return typeof role.position === 'number' && Number.isFinite(role.position) ? role.position : undefined;
}

export function isProtectedFluxerGuildRole(role: Pick<FluxerGuildRole, 'id'> & Partial<FluxerGuildRole>): boolean {
    return role.protected === true || role.protectionReason !== undefined;
}

function readRoleProtection(
    role: Record<string, unknown>,
    guildId: string
): FluxerGuildRoleProtectionReason | undefined {
    if (role.id === guildId) return 'everyone';
    if (role.managed === true) return 'managed';

    const tags = isObject(role.tags) ? role.tags : undefined;

    if (typeof role.botId === 'string' || typeof role.bot_id === 'string' || typeof tags?.bot_id === 'string') {
        return 'bot';
    }
    if (
        typeof role.integrationId === 'string' ||
        typeof role.integration_id === 'string' ||
        typeof tags?.integration_id === 'string'
    ) {
        return 'integration';
    }

    return undefined;
}

function normalizeGuildName(guild: Guild, fallback: string): string {
    const guildName = typeof guild.name === 'string' ? guild.name.replace(/\s+/g, ' ').trim() : '';
    return guildName.length > 0 ? guildName : fallback;
}

function getPermissionBitfield(permissions: unknown): string | undefined {
    const value =
        isObject(permissions) && typeof permissions.valueOf === 'function' ? permissions.valueOf() : permissions;

    if (typeof value === 'bigint' && value >= 0n) return value.toString();
    if (typeof value === 'string' && /^\d+$/.test(value)) return value;
    return undefined;
}

function normalizeChannels(
    channels: unknown
): { channels: FluxerGuildChannel[]; categories: FluxerGuildChannel[] } | undefined {
    if (!Array.isArray(channels)) {
        return undefined;
    }

    const normalizedChannels: FluxerGuildChannel[] = [];
    const normalizedCategories: FluxerGuildChannel[] = [];

    for (const channel of channels) {
        const normalizedChannel = normalizeChannel(channel);

        if (!normalizedChannel) {
            return undefined;
        }

        if (normalizedChannel.type === GUILD_CATEGORY_CHANNEL_TYPE) {
            normalizedCategories.push(normalizedChannel);
        } else {
            normalizedChannels.push(normalizedChannel);
        }
    }

    return {
        channels: normalizedChannels,
        categories: normalizedCategories,
    };
}

function normalizeChannel(channel: unknown): FluxerGuildChannel | undefined {
    if (!isObject(channel)) {
        return undefined;
    }

    const permissionOverwrites = normalizePermissionOverwrites(channel.permissionOverwrites);

    if (
        typeof channel.id !== 'string' ||
        (typeof channel.name !== 'string' && channel.name !== null) ||
        typeof channel.type !== 'number' ||
        (typeof channel.parentId !== 'string' && channel.parentId !== null) ||
        (typeof channel.position !== 'number' && channel.position !== undefined) ||
        !permissionOverwrites
    ) {
        return undefined;
    }

    return {
        id: channel.id,
        name: channel.name,
        type: channel.type,
        ...(typeof channel.url === 'string' || channel.url === null ? { url: channel.url } : {}),
        parentId: channel.parentId,
        position: channel.position ?? null,
        permissionOverwrites,
    };
}

function normalizePermissionOverwrites(overwrites: unknown): FluxerPermissionOverwrite[] | undefined {
    if (!Array.isArray(overwrites)) {
        return undefined;
    }

    const normalizedOverwrites: FluxerPermissionOverwrite[] = [];

    for (const overwrite of overwrites) {
        const normalizedOverwrite = normalizePermissionOverwrite(overwrite);

        if (!normalizedOverwrite) {
            return undefined;
        }

        normalizedOverwrites.push(normalizedOverwrite);
    }

    return normalizedOverwrites;
}

function normalizePermissionOverwrite(overwrite: unknown): FluxerPermissionOverwrite | undefined {
    if (!isObject(overwrite)) {
        return undefined;
    }

    if (
        typeof overwrite.id !== 'string' ||
        typeof overwrite.type !== 'number' ||
        typeof overwrite.allow !== 'string' ||
        typeof overwrite.deny !== 'string'
    ) {
        return undefined;
    }

    return {
        id: overwrite.id,
        type: overwrite.type,
        allow: overwrite.allow,
        deny: overwrite.deny,
    };
}

function isObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}

function isIterable(value: unknown): value is Iterable<unknown> {
    if (!isObject(value)) return false;

    const iterableLike = value as { [Symbol.iterator]?: unknown };
    return typeof iterableLike[Symbol.iterator] === 'function';
}

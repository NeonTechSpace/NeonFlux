import { Client, type Guild, type GuildChannel, type Role } from '@fluxerjs/core';
import { err, ok, type Result } from 'neverthrow';

const GUILD_CATEGORY_CHANNEL_TYPE = 4;

export type FluxerGuildRoleProtectionReason = 'everyone' | 'bot' | 'integration' | 'managed';

export type FluxerGuildRole = {
    id: string;
    name: string;
    position: number;
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
    roles: FluxerGuildRole[];
    channels: FluxerGuildChannel[];
    categories: FluxerGuildChannel[];
};

export type ReadFluxerGuildStructureInput = {
    client: Client;
    guildId: string;
};

export type ReadFluxerBotGuildStructureInput = Omit<ReadFluxerGuildStructureInput, 'client'> & {
    botToken: string;
};

export type ReadFluxerGuildStructureError =
    | { type: 'missing-input'; field: 'guildId' }
    | { type: 'unavailable-or-not-found' }
    | { type: 'fetch-failed'; error: unknown }
    | { type: 'invalid-response' };

export type ReadFluxerBotGuildStructureError =
    | ReadFluxerGuildStructureError
    | { type: 'missing-input'; field: 'botToken' }
    | { type: 'login-failed'; error: unknown };

export async function readFluxerBotGuildStructure(
    input: ReadFluxerBotGuildStructureInput
): Promise<Result<FluxerGuildStructure, ReadFluxerBotGuildStructureError>> {
    const botToken = input.botToken.trim();

    if (!botToken) {
        return err({ type: 'missing-input', field: 'botToken' });
    }

    const client = new Client({ gatewayDebug: false });

    try {
        await client.login(botToken);

        return await readFluxerGuildStructure({
            client,
            guildId: input.guildId,
        });
    } catch (error) {
        return err({ type: 'login-failed', error });
    } finally {
        await client.destroy().catch(() => undefined);
    }
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

    if (!guildResult.value) {
        return err({ type: 'unavailable-or-not-found' });
    }

    const structureResult = await fetchGuildStructure(guildResult.value);

    if (structureResult.isErr()) {
        return err(structureResult.error);
    }

    const normalizedRoles = normalizeRoles(structureResult.value.roles, guildId, structureResult.value.rawRoles);
    const normalizedChannelResult = normalizeChannels(structureResult.value.channels);

    if (!normalizedRoles || !normalizedChannelResult) {
        return err({ type: 'invalid-response' });
    }

    return ok({
        guildId,
        guildName: normalizeGuildName(guildResult.value, guildId),
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
        { roles: Role[]; rawRoles?: unknown[]; channels: GuildChannel[] },
        Extract<ReadFluxerGuildStructureError, { type: 'fetch-failed' }>
    >
> {
    try {
        const [roles, rawRoles, channels] = await Promise.all([
            guild.fetchRoles(),
            fetchRawGuildRoles(guild),
            guild.fetchChannels(),
        ]);

        return ok({ roles, ...(rawRoles ? { rawRoles } : {}), channels });
    } catch (error) {
        return err({ type: 'fetch-failed', error });
    }
}

async function fetchRawGuildRoles(guild: Guild): Promise<unknown[] | undefined> {
    const rest = readClientRest(guild);
    const guildId = readGuildId(guild);

    if (!rest || !guildId) return undefined;

    try {
        const data = await rest.get(`/guilds/${guildId}/roles`, { auth: true });
        if (Array.isArray(data)) return data.map((role: unknown) => role);
        if (!isObject(data)) return [];

        return Object.values(data);
    } catch {
        return undefined;
    }
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

function normalizeRoles(roles: unknown, guildId: string, rawRoles?: unknown[]): FluxerGuildRole[] | undefined {
    if (!Array.isArray(roles)) {
        return undefined;
    }

    const normalizedRoles: FluxerGuildRole[] = [];
    const rawRoleById = new Map(
        (rawRoles ?? [])
            .filter(isObject)
            .filter((role): role is Record<string, unknown> & { id: string } => typeof role.id === 'string')
            .map((role) => [role.id, role])
    );

    for (const role of roles) {
        const normalizedRole = normalizeRole(
            role,
            guildId,
            isObject(role) ? rawRoleById.get(String(role.id)) : undefined
        );

        if (!normalizedRole) {
            return undefined;
        }

        normalizedRoles.push(normalizedRole);
    }

    return normalizedRoles;
}

function normalizeRole(role: unknown, guildId: string, rawRole?: Record<string, unknown>): FluxerGuildRole | undefined {
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

    const protection = readRoleProtection(rawRole ?? role, guildId);

    return {
        id: role.id,
        name: role.name,
        position: role.position,
        color: role.color,
        permissions,
        hoist: role.hoist,
        mentionable: role.mentionable,
        ...(protection ? { protected: true, protectionReason: protection } : {}),
    };
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
    if (!isObject(permissions) || typeof permissions.valueOf !== 'function') {
        return undefined;
    }

    const value = permissions.valueOf();

    return typeof value === 'string' ? value : undefined;
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

import { Client, type Guild, type GuildChannel, type Role } from '@fluxerjs/core';
import { err, ok, type Result } from 'neverthrow';

const GUILD_CATEGORY_CHANNEL_TYPE = 4;

export type FluxerGuildRole = {
    id: string;
    name: string;
    position: number;
    color: number;
    permissions: string;
    hoist: boolean;
    mentionable: boolean;
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
    parentId: string | null;
    position: number | null;
    permissionOverwrites: FluxerPermissionOverwrite[];
};

export type FluxerGuildStructure = {
    guildId: string;
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

    const normalizedRoles = normalizeRoles(structureResult.value.roles);
    const normalizedChannelResult = normalizeChannels(structureResult.value.channels);

    if (!normalizedRoles || !normalizedChannelResult) {
        return err({ type: 'invalid-response' });
    }

    return ok({
        guildId,
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
        { roles: Role[]; channels: GuildChannel[] },
        Extract<ReadFluxerGuildStructureError, { type: 'fetch-failed' }>
    >
> {
    try {
        const [roles, channels] = await Promise.all([guild.fetchRoles(), guild.fetchChannels()]);

        return ok({ roles, channels });
    } catch (error) {
        return err({ type: 'fetch-failed', error });
    }
}

function normalizeRoles(roles: unknown): FluxerGuildRole[] | undefined {
    if (!Array.isArray(roles)) {
        return undefined;
    }

    const normalizedRoles: FluxerGuildRole[] = [];

    for (const role of roles) {
        const normalizedRole = normalizeRole(role);

        if (!normalizedRole) {
            return undefined;
        }

        normalizedRoles.push(normalizedRole);
    }

    return normalizedRoles;
}

function normalizeRole(role: unknown): FluxerGuildRole | undefined {
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

    return {
        id: role.id,
        name: role.name,
        position: role.position,
        color: role.color,
        permissions,
        hoist: role.hoist,
        mentionable: role.mentionable,
    };
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

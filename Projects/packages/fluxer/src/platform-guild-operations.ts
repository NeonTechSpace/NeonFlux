import { err, ok, type Result } from 'neverthrow';

import type { FluxerBot } from './client.js';
import { mapPlatformError, requireTextInputs, runGuildAction, type FluxerPlatformError } from './platform-shared.js';

type MutableGuildChannel = {
    delete(options?: { silent?: boolean }): Promise<void>;
    editPermission(overwriteId: string, options: { type: 0 | 1; allow?: string; deny?: string }): Promise<void>;
    deletePermission(overwriteId: string): Promise<void>;
};

type CreateChannelInput = {
    guildId: string;
    type: 0 | 2 | 4 | 5;
    name: string;
    parentId?: string | null;
};

type EditPermissionInput = {
    channelId: string;
    overwriteId: string;
    type: 0 | 1;
    allow?: string;
    deny?: string;
};

export function createMemberPlatform(client: FluxerBot['client']) {
    return {
        addRole: (input: { guildId: string; userId: string; roleId: string }) => addMemberRole(client, input),
        removeRole: (input: { guildId: string; userId: string; roleId: string }) => removeMemberRole(client, input),
        move: (input: { guildId: string; userId: string; channelId: string | null }) => moveMember(client, input),
    };
}

export function createModerationPlatform(client: FluxerBot['client']) {
    return {
        ban: (input: { guildId: string; userId: string; reason?: string; deleteMessageDays?: number }) =>
            banMember(client, input),
        unban: (input: { guildId: string; userId: string }) => unbanMember(client, input),
        kick: (input: { guildId: string; userId: string }) => kickMember(client, input),
    };
}

export function createChannelPlatform(client: FluxerBot['client']) {
    return {
        create: (input: CreateChannelInput) => createChannel(client, input),
        delete: (input: { channelId: string }) => deleteChannel(client, input),
        editPermission: (input: EditPermissionInput) => editChannelPermission(client, input),
        deletePermission: (input: { channelId: string; overwriteId: string }) => deleteChannelPermission(client, input),
    };
}

export function createRolePlatform(client: FluxerBot['client']) {
    return {
        create: (input: { guildId: string; name: string; permissions?: string }) => createRole(client, input),
        delete: (input: { guildId: string; roleId: string }) => deleteRole(client, input),
    };
}

async function addMemberRole(
    client: FluxerBot['client'],
    input: { guildId: string; userId: string; roleId: string }
): Promise<Result<void, FluxerPlatformError>> {
    return updateMemberRole(client, input, 'add');
}

async function removeMemberRole(
    client: FluxerBot['client'],
    input: { guildId: string; userId: string; roleId: string }
): Promise<Result<void, FluxerPlatformError>> {
    return updateMemberRole(client, input, 'remove');
}

async function updateMemberRole(
    client: FluxerBot['client'],
    input: { guildId: string; userId: string; roleId: string },
    action: 'add' | 'remove'
): Promise<Result<void, FluxerPlatformError>> {
    const inputResult = requireTextInputs(input, ['guildId', 'userId', 'roleId']);

    if (inputResult.isErr()) {
        return err(inputResult.error);
    }

    try {
        const guild = await client.guilds.fetch(input.guildId.trim());

        if (!guild) {
            return err({ type: 'not-found' });
        }

        if (action === 'add') {
            await guild.addRoleToMember(input.userId.trim(), input.roleId.trim());
        } else {
            await guild.removeRoleFromMember(input.userId.trim(), input.roleId.trim());
        }

        return ok(undefined);
    } catch (error) {
        return err(mapPlatformError(error));
    }
}

async function moveMember(
    client: FluxerBot['client'],
    input: { guildId: string; userId: string; channelId: string | null }
): Promise<Result<void, FluxerPlatformError>> {
    const inputResult = requireTextInputs(input, ['guildId', 'userId']);

    if (inputResult.isErr()) {
        return err(inputResult.error);
    }

    try {
        const guild = await client.guilds.fetch(input.guildId.trim());

        if (!guild) {
            return err({ type: 'not-found' });
        }

        const member = await guild.fetchMember(input.userId.trim());
        const targetChannelId = input.channelId?.trim();

        await member.move(targetChannelId && targetChannelId.length > 0 ? targetChannelId : null);

        return ok(undefined);
    } catch (error) {
        return err(mapPlatformError(error));
    }
}

async function banMember(
    client: FluxerBot['client'],
    input: { guildId: string; userId: string; reason?: string; deleteMessageDays?: number }
): Promise<Result<void, FluxerPlatformError>> {
    const inputResult = requireTextInputs(input, ['guildId', 'userId']);

    if (inputResult.isErr()) {
        return err(inputResult.error);
    }

    return runGuildAction(client, input.guildId, (guild) =>
        guild.ban(input.userId.trim(), {
            ...(input.reason ? { reason: input.reason } : {}),
            ...(input.deleteMessageDays ? { delete_message_days: input.deleteMessageDays } : {}),
        })
    );
}

async function unbanMember(
    client: FluxerBot['client'],
    input: { guildId: string; userId: string }
): Promise<Result<void, FluxerPlatformError>> {
    const inputResult = requireTextInputs(input, ['guildId', 'userId']);

    if (inputResult.isErr()) {
        return err(inputResult.error);
    }

    return runGuildAction(client, input.guildId, (guild) => guild.unban(input.userId.trim()));
}

async function kickMember(
    client: FluxerBot['client'],
    input: { guildId: string; userId: string }
): Promise<Result<void, FluxerPlatformError>> {
    const inputResult = requireTextInputs(input, ['guildId', 'userId']);

    if (inputResult.isErr()) {
        return err(inputResult.error);
    }

    return runGuildAction(client, input.guildId, (guild) => guild.kick(input.userId.trim()));
}

async function createChannel(
    client: FluxerBot['client'],
    input: CreateChannelInput
): Promise<Result<{ id: string; guildId: string }, FluxerPlatformError>> {
    const inputResult = requireTextInputs(input, ['guildId', 'name']);

    if (inputResult.isErr()) {
        return err(inputResult.error);
    }

    const parentId = input.parentId?.trim();
    const normalizedParentId = parentId !== undefined && parentId.length > 0 ? parentId : null;

    return runGuildAction(client, input.guildId, async (guild) => {
        const channel = await guild.createChannel({
            type: input.type,
            name: input.name.trim(),
            ...(input.parentId !== undefined ? { parent_id: normalizedParentId } : {}),
        });

        return {
            id: channel.id,
            guildId: channel.guildId,
        };
    });
}

async function deleteChannel(
    client: FluxerBot['client'],
    input: { channelId: string }
): Promise<Result<void, FluxerPlatformError>> {
    const channelId = input.channelId.trim();

    if (!channelId) {
        return err({ type: 'missing-input', field: 'channelId' });
    }

    try {
        const channel = await client.channels.fetch(channelId);

        if (!isMutableGuildChannel(channel)) {
            return err({ type: 'not-found' });
        }

        await channel.delete();

        return ok(undefined);
    } catch (error) {
        return err(mapPlatformError(error));
    }
}

async function editChannelPermission(
    client: FluxerBot['client'],
    input: EditPermissionInput
): Promise<Result<void, FluxerPlatformError>> {
    const inputResult = requireTextInputs(input, ['channelId', 'overwriteId']);

    if (inputResult.isErr()) {
        return err(inputResult.error);
    }

    try {
        const channel = await client.channels.fetch(input.channelId.trim());

        if (!isMutableGuildChannel(channel)) {
            return err({ type: 'not-found' });
        }

        await channel.editPermission(input.overwriteId.trim(), {
            type: input.type,
            ...(input.allow ? { allow: input.allow } : {}),
            ...(input.deny ? { deny: input.deny } : {}),
        });

        return ok(undefined);
    } catch (error) {
        return err(mapPlatformError(error));
    }
}

async function deleteChannelPermission(
    client: FluxerBot['client'],
    input: { channelId: string; overwriteId: string }
): Promise<Result<void, FluxerPlatformError>> {
    const inputResult = requireTextInputs(input, ['channelId', 'overwriteId']);

    if (inputResult.isErr()) {
        return err(inputResult.error);
    }

    try {
        const channel = await client.channels.fetch(input.channelId.trim());

        if (!isMutableGuildChannel(channel)) {
            return err({ type: 'not-found' });
        }

        await channel.deletePermission(input.overwriteId.trim());

        return ok(undefined);
    } catch (error) {
        return err(mapPlatformError(error));
    }
}

async function createRole(
    client: FluxerBot['client'],
    input: { guildId: string; name: string; permissions?: string }
): Promise<Result<{ id: string; guildId: string }, FluxerPlatformError>> {
    const inputResult = requireTextInputs(input, ['guildId', 'name']);

    if (inputResult.isErr()) {
        return err(inputResult.error);
    }

    return runGuildAction(client, input.guildId, async (guild) => {
        const role = await guild.createRole({
            name: input.name.trim(),
            ...(input.permissions ? { permissions: input.permissions } : {}),
        });

        return {
            id: role.id,
            guildId: role.guildId,
        };
    });
}

async function deleteRole(
    client: FluxerBot['client'],
    input: { guildId: string; roleId: string }
): Promise<Result<void, FluxerPlatformError>> {
    const inputResult = requireTextInputs(input, ['guildId', 'roleId']);

    if (inputResult.isErr()) {
        return err(inputResult.error);
    }

    try {
        const guild = await client.guilds.fetch(input.guildId.trim());

        if (!guild) {
            return err({ type: 'not-found' });
        }

        const role = await guild.fetchRole(input.roleId.trim());

        await role.delete();

        return ok(undefined);
    } catch (error) {
        return err(mapPlatformError(error));
    }
}

function isMutableGuildChannel(channel: unknown): channel is MutableGuildChannel {
    if (typeof channel !== 'object' || channel === null) {
        return false;
    }

    const possibleChannel = channel as {
        delete?: unknown;
        editPermission?: unknown;
        deletePermission?: unknown;
    };

    return (
        typeof possibleChannel.delete === 'function' &&
        typeof possibleChannel.editPermission === 'function' &&
        typeof possibleChannel.deletePermission === 'function'
    );
}

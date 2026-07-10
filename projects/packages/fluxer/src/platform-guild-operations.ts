import { err, ok, type Result } from 'neverthrow';

import type { FluxerBot } from './client.js';
import { mapPlatformError, requireTextInputs, runGuildAction, type FluxerPlatformError } from './platform-shared.js';

type MutableGuildChannel = {
    delete(options?: { silent?: boolean }): Promise<void>;
    editPermission(overwriteId: string, options: { type: 0 | 1; allow?: string; deny?: string }): Promise<void>;
    deletePermission(overwriteId: string): Promise<void>;
};

type EditableGuildChannel = {
    edit(options: { name?: string; user_limit?: number | null }): Promise<unknown>;
};

type ChannelPositionableGuild = {
    setChannelPositions(updates: Array<{ id: string; parent_id?: string | null; position?: number }>): Promise<unknown>;
};

type ChannelPositionInput = {
    guildId: string;
    positions: Array<{ channelId: string; parentId: string | null; position: number }>;
};

type RolePositionableGuild = {
    setRolePositions(updates: Array<{ id: string; position?: number }>): Promise<unknown>;
};

type EditableGuildMember = {
    edit(options: { communication_disabled_until?: string | null; timeout_reason?: string | null }): Promise<unknown>;
};

type CreateChannelInput = {
    guildId: string;
    type: 0 | 2 | 4 | 998;
    name: string;
    url?: string | null;
    parentId?: string | null;
    position?: number;
};

type EditChannelInput = {
    channelId: string;
    guildId?: string;
    name?: string;
    parentId?: string | null;
    position?: number;
    userLimit?: number | null;
};

type EditPermissionInput = {
    channelId: string;
    overwriteId: string;
    type: 0 | 1;
    allow?: string;
    deny?: string;
};

type RoleVisualInput = {
    permissions?: string;
    color?: number;
    hoist?: boolean;
    mentionable?: boolean;
};

type CreateRoleInput = RoleVisualInput & {
    guildId: string;
    name: string;
    position?: number;
};

type EditRoleInput = RoleVisualInput & {
    guildId: string;
    roleId: string;
    name?: string;
    position?: number;
};

type RolePositionInput = {
    guildId: string;
    positions: Array<{ roleId: string; position: number }>;
};

export function createMemberPlatform(client: FluxerBot['client']) {
    return {
        read: (input: { guildId: string; userId: string }) => readMember(client, input),
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
        timeout: (input: { guildId: string; userId: string; expiresAt: Date; reason?: string }) =>
            timeoutMember(client, input),
        untimeout: (input: { guildId: string; userId: string; reason?: string }) => untimeoutMember(client, input),
    };
}

export function createChannelPlatform(client: FluxerBot['client']) {
    return {
        create: (input: CreateChannelInput) => createChannel(client, input),
        edit: (input: EditChannelInput) => editChannel(client, input),
        setPositions: (input: ChannelPositionInput) => setChannelPositions(client, input),
        delete: (input: { channelId: string }) => deleteChannel(client, input),
        editPermission: (input: EditPermissionInput) => editChannelPermission(client, input),
        deletePermission: (input: { channelId: string; overwriteId: string }) => deleteChannelPermission(client, input),
    };
}

async function setChannelPositions(
    client: FluxerBot['client'],
    input: ChannelPositionInput
): Promise<Result<void, FluxerPlatformError>> {
    const inputResult = requireTextInputs(input, ['guildId']);

    if (inputResult.isErr()) return err(inputResult.error);
    if (
        input.positions.length === 0 ||
        input.positions.some(
            (position) => !position.channelId.trim() || !Number.isInteger(position.position) || position.position < 0
        )
    ) {
        return err({ type: 'invalid-value', field: 'positions' });
    }

    try {
        const guild = await client.guilds.fetch(input.guildId.trim());
        if (!isChannelPositionableGuild(guild)) return err({ type: 'not-found' });

        await guild.setChannelPositions(
            input.positions.map((position) => ({
                id: position.channelId.trim(),
                parent_id: position.parentId?.trim() ?? null,
                position: position.position,
            }))
        );
        return ok(undefined);
    } catch (error) {
        return err(mapPlatformError(error));
    }
}

export function createRolePlatform(client: FluxerBot['client']) {
    return {
        create: (input: CreateRoleInput) => createRole(client, input),
        edit: (input: EditRoleInput) => editRole(client, input),
        setPositions: (input: RolePositionInput) => setRolePositions(client, input),
        delete: (input: { guildId: string; roleId: string }) => deleteRole(client, input),
    };
}

async function readMember(
    client: FluxerBot['client'],
    input: { guildId: string; userId: string }
): Promise<Result<{ guildId: string; userId: string; roleIds: string[] }, FluxerPlatformError>> {
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
        const roleIds = readMemberRoleIds(member);

        if (!roleIds) {
            return err({ type: 'operation-failed', error: new Error('Invalid member role response.') });
        }

        return ok({
            guildId: input.guildId.trim(),
            userId: input.userId.trim(),
            roleIds,
        });
    } catch (error) {
        return err(mapPlatformError(error));
    }
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

async function timeoutMember(
    client: FluxerBot['client'],
    input: { guildId: string; userId: string; expiresAt: Date; reason?: string }
): Promise<Result<void, FluxerPlatformError>> {
    const inputResult = requireTextInputs(input, ['guildId', 'userId']);

    if (inputResult.isErr()) {
        return err(inputResult.error);
    }

    if (!(input.expiresAt instanceof Date) || Number.isNaN(input.expiresAt.getTime())) {
        return err({ type: 'invalid-value', field: 'expiresAt' });
    }

    return editMemberTimeout(client, input, input.expiresAt.toISOString());
}

async function untimeoutMember(
    client: FluxerBot['client'],
    input: { guildId: string; userId: string; reason?: string }
): Promise<Result<void, FluxerPlatformError>> {
    const inputResult = requireTextInputs(input, ['guildId', 'userId']);

    if (inputResult.isErr()) {
        return err(inputResult.error);
    }

    return editMemberTimeout(client, input, null);
}

async function editMemberTimeout(
    client: FluxerBot['client'],
    input: { guildId: string; userId: string; reason?: string },
    communicationDisabledUntil: string | null
): Promise<Result<void, FluxerPlatformError>> {
    try {
        const guild = await client.guilds.fetch(input.guildId.trim());

        if (!guild) {
            return err({ type: 'not-found' });
        }

        const member = await guild.fetchMember(input.userId.trim());

        if (!isEditableGuildMember(member)) {
            return err({ type: 'operation-failed', error: new Error('Member is not editable.') });
        }

        const reason = input.reason?.trim();
        await member.edit({
            communication_disabled_until: communicationDisabledUntil,
            ...(reason ? { timeout_reason: reason } : {}),
        });

        return ok(undefined);
    } catch (error) {
        return err(mapPlatformError(error));
    }
}

function readMemberRoleIds(member: unknown): string[] | undefined {
    if (typeof member !== 'object' || member === null) {
        return undefined;
    }

    const roles = (member as { roles?: unknown }).roles;

    if (typeof roles !== 'object' || roles === null) {
        return undefined;
    }

    const roleIds = (roles as { roleIds?: unknown }).roleIds;

    if (!Array.isArray(roleIds) || !roleIds.every((roleId) => typeof roleId === 'string')) {
        return undefined;
    }

    return [...roleIds];
}

function isEditableGuildMember(member: unknown): member is EditableGuildMember {
    if (typeof member !== 'object' || member === null) {
        return false;
    }

    return typeof (member as { edit?: unknown }).edit === 'function';
}

async function createChannel(
    client: FluxerBot['client'],
    input: CreateChannelInput
): Promise<Result<{ id: string; guildId: string }, FluxerPlatformError>> {
    const inputResult = requireTextInputs(input, ['guildId', 'name']);

    if (inputResult.isErr()) {
        return err(inputResult.error);
    }
    if (input.position !== undefined && (!Number.isInteger(input.position) || input.position < 0)) {
        return err({ type: 'invalid-value', field: 'position' });
    }

    const parentId = input.parentId?.trim();
    const normalizedParentId = parentId !== undefined && parentId.length > 0 ? parentId : null;

    return runGuildAction(client, input.guildId, async (guild) => {
        const channelData: Parameters<typeof guild.createChannel>[0] & { url?: string | null } = {
            type: input.type,
            name: input.name.trim(),
            ...(input.url !== undefined ? { url: input.url } : {}),
            ...(input.parentId !== undefined ? { parent_id: normalizedParentId } : {}),
            ...(input.position !== undefined ? { position: input.position } : {}),
        };
        const channel = await guild.createChannel(channelData);

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

async function editChannel(
    client: FluxerBot['client'],
    input: EditChannelInput
): Promise<Result<void, FluxerPlatformError>> {
    const inputResult = requireTextInputs(input, ['channelId']);

    if (inputResult.isErr()) {
        return err(inputResult.error);
    }

    const name = input.name?.trim();

    if (input.name !== undefined && !name) {
        return err({ type: 'missing-input', field: 'name' });
    }
    if (
        input.userLimit !== undefined &&
        input.userLimit !== null &&
        (!Number.isInteger(input.userLimit) || input.userLimit < 0 || input.userLimit > 99)
    ) {
        return err({ type: 'invalid-value', field: 'userLimit' });
    }
    if (input.position !== undefined && (!Number.isInteger(input.position) || input.position < 0)) {
        return err({ type: 'invalid-value', field: 'position' });
    }
    if (!name && input.userLimit === undefined && input.parentId === undefined && input.position === undefined) {
        return err({ type: 'missing-input', field: 'channel' });
    }

    const parentId = input.parentId?.trim();
    const normalizedParentId = parentId !== undefined && parentId.length > 0 ? parentId : null;

    try {
        const channel = await client.channels.fetch(input.channelId.trim());

        if (!isEditableGuildChannel(channel)) {
            return err({ type: 'not-found' });
        }

        if (name || input.userLimit !== undefined) {
            await channel.edit({
                ...(name ? { name } : {}),
                ...(input.userLimit !== undefined ? { user_limit: input.userLimit } : {}),
            });
        }

        if (input.parentId !== undefined || input.position !== undefined) {
            const guildId = input.guildId?.trim();
            if (!guildId) return err({ type: 'missing-input', field: 'guildId' });

            const guild = await client.guilds.fetch(guildId);
            if (!isChannelPositionableGuild(guild)) return err({ type: 'not-found' });

            await guild.setChannelPositions([
                {
                    id: input.channelId.trim(),
                    ...(input.parentId !== undefined ? { parent_id: normalizedParentId } : {}),
                    ...(input.position !== undefined ? { position: input.position } : {}),
                },
            ]);
        }

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
    input: CreateRoleInput
): Promise<Result<{ id: string; guildId: string }, FluxerPlatformError>> {
    const inputResult = requireTextInputs(input, ['guildId', 'name']);

    if (inputResult.isErr()) {
        return err(inputResult.error);
    }

    const visualResult = normalizeRoleVisualInput(input);

    if (visualResult.isErr()) return err(visualResult.error);
    if (input.position !== undefined && (!Number.isInteger(input.position) || input.position < 0)) {
        return err({ type: 'invalid-value', field: 'position' });
    }

    return runGuildAction(client, input.guildId, async (guild) => {
        const role = await guild.createRole({
            name: input.name.trim(),
            ...visualResult.value,
            ...(input.position !== undefined ? { position: input.position } : {}),
        });

        return {
            id: role.id,
            guildId: role.guildId,
        };
    });
}

async function editRole(client: FluxerBot['client'], input: EditRoleInput): Promise<Result<void, FluxerPlatformError>> {
    const inputResult = requireTextInputs(input, ['guildId', 'roleId']);

    if (inputResult.isErr()) {
        return err(inputResult.error);
    }

    const name = input.name?.trim();

    if (input.name !== undefined && !name) return err({ type: 'missing-input', field: 'name' });

    const visualResult = normalizeRoleVisualInput(input);

    if (visualResult.isErr()) return err(visualResult.error);
    if (input.position !== undefined && (!Number.isInteger(input.position) || input.position < 0)) {
        return err({ type: 'invalid-value', field: 'position' });
    }
    if (input.position !== undefined && input.roleId.trim() === input.guildId.trim()) {
        return err({ type: 'invalid-value', field: 'position' });
    }

    const options = {
        ...(name ? { name } : {}),
        ...visualResult.value,
    };

    if (Object.keys(options).length === 0 && input.position === undefined) {
        return err({ type: 'missing-input', field: 'role' });
    }

    try {
        const guildId = input.guildId.trim();
        const roleId = input.roleId.trim();

        if (Object.keys(options).length > 0) {
            await client.rest.patch(`/guilds/${guildId}/roles/${roleId}`, {
                body: options,
                auth: true,
            });
        }

        if (input.position !== undefined) {
            const guild = await client.guilds.fetch(guildId);
            if (!isRolePositionableGuild(guild)) return err({ type: 'not-found' });

            await guild.setRolePositions([{ id: roleId, position: input.position }]);
        }

        return ok(undefined);
    } catch (error) {
        return err(mapPlatformError(error));
    }
}

async function setRolePositions(
    client: FluxerBot['client'],
    input: RolePositionInput
): Promise<Result<void, FluxerPlatformError>> {
    const inputResult = requireTextInputs(input, ['guildId']);

    if (inputResult.isErr()) {
        return err(inputResult.error);
    }

    const positions = input.positions
        .map((position) => ({ roleId: position.roleId.trim(), position: position.position }))
        .filter((position) => position.roleId);

    if (positions.length === 0) return err({ type: 'missing-input', field: 'role' });
    if (positions.some((position) => !Number.isInteger(position.position) || position.position < 0)) {
        return err({ type: 'invalid-value', field: 'position' });
    }
    if (positions.some((position) => position.roleId === input.guildId.trim())) {
        return err({ type: 'invalid-value', field: 'position' });
    }

    try {
        const guild = await client.guilds.fetch(input.guildId.trim());

        if (!guild || !isRolePositionableGuild(guild)) {
            return err({ type: 'not-found' });
        }

        await guild.setRolePositions(
            positions.map((position) => ({
                id: position.roleId,
                position: position.position,
            }))
        );

        return ok(undefined);
    } catch (error) {
        return err(mapPlatformError(error));
    }
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
        const guildId = input.guildId.trim();
        const roleId = input.roleId.trim();
        await client.rest.delete(`/guilds/${guildId}/roles/${roleId}`, { auth: true });

        return ok(undefined);
    } catch (error) {
        return err(mapPlatformError(error));
    }
}

function isEditableGuildChannel(channel: unknown): channel is EditableGuildChannel {
    return hasFunction(channel, 'edit');
}

function isMutableGuildChannel(channel: unknown): channel is MutableGuildChannel {
    return ['delete', 'editPermission', 'deletePermission'].every((key) => hasFunction(channel, key));
}

function isChannelPositionableGuild(guild: unknown): guild is ChannelPositionableGuild {
    return hasFunction(guild, 'setChannelPositions');
}

function isRolePositionableGuild(guild: unknown): guild is RolePositionableGuild {
    return hasFunction(guild, 'setRolePositions');
}

function normalizeRoleVisualInput(
    input: RoleVisualInput
): Result<{ permissions?: string; color?: number; hoist?: boolean; mentionable?: boolean }, FluxerPlatformError> {
    const permissions = input.permissions?.trim();

    if (input.permissions !== undefined && !permissions) return err({ type: 'missing-input', field: 'permissions' });
    if (input.color !== undefined && (!Number.isInteger(input.color) || input.color < 0 || input.color > 0xffffff)) {
        return err({ type: 'invalid-value', field: 'color' });
    }

    return ok({
        ...(permissions ? { permissions } : {}),
        ...(input.color !== undefined ? { color: input.color } : {}),
        ...(input.hoist !== undefined ? { hoist: input.hoist } : {}),
        ...(input.mentionable !== undefined ? { mentionable: input.mentionable } : {}),
    });
}

function hasFunction(value: unknown, key: string): boolean {
    return typeof value === 'object' && value !== null && typeof (value as Record<string, unknown>)[key] === 'function';
}

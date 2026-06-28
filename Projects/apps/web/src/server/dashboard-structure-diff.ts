import type { FluxerGuildChannel, FluxerGuildRole, FluxerGuildStructure } from '@neonflux/fluxer';

export type DashboardStructureSnapshot = {
    version: 1;
    guildId?: string;
    exportedAt?: string;
    roles: FluxerGuildRole[];
    categories: FluxerGuildChannel[];
    channels: FluxerGuildChannel[];
};

type DashboardStructurePlannedAction = {
    actionType: 'create' | 'update' | 'delete';
    targetType: 'role' | 'category' | 'channel';
    targetId?: string;
    label: string;
    details: Record<string, unknown>;
};

type DashboardStructurePlanSummary = {
    creates: number;
    updates: number;
    deletes: number;
    roles: number;
    categories: number;
    channels: number;
};

export type DashboardStructurePlan = {
    summary: DashboardStructurePlanSummary;
    actions: DashboardStructurePlannedAction[];
};

export type DashboardStructureSnapshotValidationResult =
    | { type: 'valid'; snapshot: DashboardStructureSnapshot }
    | { type: 'invalid'; message: string };

const roleFields = ['name', 'position', 'color', 'permissions', 'hoist', 'mentionable'] as const;
const channelFields = ['name', 'type', 'parentId', 'position', 'permissionOverwrites'] as const;

export function toDashboardStructureSnapshot(
    structure: FluxerGuildStructure,
    exportedAt = new Date().toISOString()
): DashboardStructureSnapshot {
    return {
        version: 1,
        guildId: structure.guildId,
        exportedAt,
        roles: structure.roles,
        categories: structure.categories,
        channels: structure.channels,
    };
}

export function normalizeDashboardStructureSnapshot(value: unknown): DashboardStructureSnapshotValidationResult {
    if (!isObject(value)) {
        return { type: 'invalid', message: 'Structure JSON must be an object.' };
    }

    const roles = normalizeRoles(value.roles);
    const categories = normalizeChannels(value.categories);
    const channels = normalizeChannels(value.channels);

    if (!roles || !categories || !channels) {
        return {
            type: 'invalid',
            message: 'Structure JSON must include valid roles, categories, and channels arrays.',
        };
    }

    return {
        type: 'valid',
        snapshot: {
            version: 1,
            ...(typeof value.guildId === 'string' && value.guildId.trim() ? { guildId: value.guildId.trim() } : {}),
            ...(typeof value.exportedAt === 'string' && value.exportedAt.trim()
                ? { exportedAt: value.exportedAt.trim() }
                : {}),
            roles,
            categories,
            channels,
        },
    };
}

export function diffDashboardStructureSnapshot(
    current: DashboardStructureSnapshot,
    requested: DashboardStructureSnapshot
): DashboardStructurePlan {
    const actions = [
        ...diffCollection('role', current.roles, requested.roles, roleFields),
        ...diffCollection('category', current.categories, requested.categories, channelFields),
        ...diffCollection('channel', current.channels, requested.channels, channelFields),
    ];

    return {
        summary: {
            creates: actions.filter((action) => action.actionType === 'create').length,
            updates: actions.filter((action) => action.actionType === 'update').length,
            deletes: actions.filter((action) => action.actionType === 'delete').length,
            roles: actions.filter((action) => action.targetType === 'role').length,
            categories: actions.filter((action) => action.targetType === 'category').length,
            channels: actions.filter((action) => action.targetType === 'channel').length,
        },
        actions,
    };
}

function diffCollection<TItem extends { id: string; name: string | null }>(
    targetType: DashboardStructurePlannedAction['targetType'],
    currentItems: readonly TItem[],
    requestedItems: readonly TItem[],
    fields: readonly (keyof TItem)[]
): DashboardStructurePlannedAction[] {
    const currentById = new Map(currentItems.map((item) => [item.id, item]));
    const requestedById = new Map(requestedItems.map((item) => [item.id, item]));
    const actions: DashboardStructurePlannedAction[] = [];

    for (const requested of requestedItems) {
        const current = currentById.get(requested.id);

        if (!current) {
            actions.push(toAction('create', targetType, requested, { after: requested }));
            continue;
        }

        const changes = diffFields(current, requested, fields);

        if (changes.length > 0) {
            actions.push(toAction('update', targetType, requested, { changes }));
        }
    }

    for (const current of currentItems) {
        if (!requestedById.has(current.id)) {
            actions.push(toAction('delete', targetType, current, { before: current }));
        }
    }

    return actions;
}

function diffFields<TItem>(
    current: TItem,
    requested: TItem,
    fields: readonly (keyof TItem)[]
): Array<{ field: string; before: unknown; after: unknown }> {
    return fields.flatMap((field) => {
        const before = current[field];
        const after = requested[field];

        if (stableValueKey(before) === stableValueKey(after)) {
            return [];
        }

        return [{ field: String(field), before, after }];
    });
}

function toAction<TItem extends { id: string; name: string | null }>(
    actionType: DashboardStructurePlannedAction['actionType'],
    targetType: DashboardStructurePlannedAction['targetType'],
    item: TItem,
    details: Record<string, unknown>
): DashboardStructurePlannedAction {
    return {
        actionType,
        targetType,
        targetId: item.id,
        label: item.name ?? item.id,
        details: {
            label: item.name ?? item.id,
            ...details,
        },
    };
}

function normalizeRoles(value: unknown): FluxerGuildRole[] | undefined {
    if (!Array.isArray(value)) return undefined;

    const roles: FluxerGuildRole[] = [];

    for (const role of value) {
        if (!isObject(role)) return undefined;
        if (
            typeof role.id !== 'string' ||
            typeof role.name !== 'string' ||
            typeof role.position !== 'number' ||
            typeof role.color !== 'number' ||
            typeof role.permissions !== 'string' ||
            typeof role.hoist !== 'boolean' ||
            typeof role.mentionable !== 'boolean'
        ) {
            return undefined;
        }

        roles.push({
            id: role.id,
            name: role.name,
            position: role.position,
            color: role.color,
            permissions: role.permissions,
            hoist: role.hoist,
            mentionable: role.mentionable,
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
            typeof channel.id !== 'string' ||
            (typeof channel.name !== 'string' && channel.name !== null) ||
            typeof channel.type !== 'number' ||
            (typeof channel.parentId !== 'string' && channel.parentId !== null && channel.parentId !== undefined) ||
            (typeof channel.position !== 'number' && channel.position !== null && channel.position !== undefined) ||
            !permissionOverwrites
        ) {
            return undefined;
        }

        channels.push({
            id: channel.id,
            name: channel.name,
            type: channel.type,
            parentId: channel.parentId ?? null,
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
            typeof overwrite.id !== 'string' ||
            typeof overwrite.type !== 'number' ||
            typeof overwrite.allow !== 'string' ||
            typeof overwrite.deny !== 'string'
        ) {
            return undefined;
        }

        permissionOverwrites.push({
            id: overwrite.id,
            type: overwrite.type,
            allow: overwrite.allow,
            deny: overwrite.deny,
        });
    }

    return permissionOverwrites;
}

function stableValueKey(value: unknown): string {
    if (Array.isArray(value)) {
        return JSON.stringify(value.map((item) => stableValueKey(item)).sort());
    }

    if (isObject(value)) {
        return JSON.stringify(
            Object.entries(value)
                .sort(([left], [right]) => left.localeCompare(right))
                .map(([key, item]) => [key, stableValueKey(item)])
        );
    }

    return JSON.stringify(value);
}

function isObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}

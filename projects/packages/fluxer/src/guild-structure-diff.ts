import type { FluxerGuildChannel, FluxerGuildRole, FluxerGuildStructure } from './guild-structure.js';

export type FluxerGuildStructureSnapshot = {
    version: 1;
    guildId?: string;
    guildName?: string;
    exportedAt?: string;
    roles: FluxerGuildRole[];
    categories: FluxerGuildChannel[];
    channels: FluxerGuildChannel[];
};

export type FluxerGuildStructurePlannedAction = {
    actionType: 'create' | 'update' | 'delete';
    targetType: 'role' | 'category' | 'channel';
    targetId?: string;
    label: string;
    details: Record<string, unknown>;
};

export type FluxerGuildStructurePlanSummary = {
    creates: number;
    updates: number;
    deletes: number;
    roles: number;
    categories: number;
    channels: number;
};

export type FluxerGuildStructurePlan = {
    summary: FluxerGuildStructurePlanSummary;
    actions: FluxerGuildStructurePlannedAction[];
};

export type FluxerGuildStructureFieldSummary = {
    names: number;
    permissions: number;
    positions: number;
    parentMoves: number;
    typeChanges: number;
    roleVisuals: number;
};

export type FluxerGuildStructureSnapshotValidationResult =
    | { type: 'valid'; snapshot: FluxerGuildStructureSnapshot }
    | { type: 'invalid'; message: string };

const roleFields = ['name', 'position', 'color', 'permissions', 'hoist', 'mentionable'] as const;
const channelFields = ['name', 'type', 'parentId', 'position', 'permissionOverwrites'] as const;

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

    return {
        type: 'valid',
        snapshot: {
            version: 1,
            ...(typeof value.guildId === 'string' && value.guildId.trim() ? { guildId: value.guildId.trim() } : {}),
            ...(typeof value.guildName === 'string' && value.guildName.trim()
                ? { guildName: value.guildName.trim() }
                : {}),
            ...(typeof value.exportedAt === 'string' && value.exportedAt.trim()
                ? { exportedAt: value.exportedAt.trim() }
                : {}),
            roles,
            categories,
            channels,
        },
    };
}

export function diffFluxerGuildStructureSnapshot(
    current: FluxerGuildStructureSnapshot,
    requested: FluxerGuildStructureSnapshot
): FluxerGuildStructurePlan {
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

export function countFluxerGuildStructurePlanChanges(summary: FluxerGuildStructurePlanSummary): number {
    return summary.creates + summary.updates + summary.deletes;
}

export function summarizeFluxerGuildStructurePlanFields(
    plan: FluxerGuildStructurePlan
): FluxerGuildStructureFieldSummary {
    const fieldSummary: FluxerGuildStructureFieldSummary = {
        names: 0,
        permissions: 0,
        positions: 0,
        parentMoves: 0,
        typeChanges: 0,
        roleVisuals: 0,
    };

    for (const action of plan.actions) {
        const changes = Array.isArray(action.details.changes) ? action.details.changes : [];

        for (const change of changes) {
            if (!isObject(change) || typeof change.field !== 'string') continue;

            if (change.field === 'name') fieldSummary.names += 1;
            if (change.field === 'permissionOverwrites' || change.field === 'permissions') {
                fieldSummary.permissions += 1;
            }
            if (change.field === 'position') fieldSummary.positions += 1;
            if (change.field === 'parentId') fieldSummary.parentMoves += 1;
            if (change.field === 'type') fieldSummary.typeChanges += 1;
            if (change.field === 'color' || change.field === 'hoist' || change.field === 'mentionable') {
                fieldSummary.roleVisuals += 1;
            }
        }
    }

    return fieldSummary;
}

function diffCollection<TItem extends { id: string; name: string | null }>(
    targetType: FluxerGuildStructurePlannedAction['targetType'],
    currentItems: readonly TItem[],
    requestedItems: readonly TItem[],
    fields: ReadonlyArray<keyof TItem>
): FluxerGuildStructurePlannedAction[] {
    const currentById = new Map(currentItems.map((item) => [item.id, item]));
    const requestedById = new Map(requestedItems.map((item) => [item.id, item]));
    const actions: FluxerGuildStructurePlannedAction[] = [];

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
    fields: ReadonlyArray<keyof TItem>
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

function toAction(
    actionType: FluxerGuildStructurePlannedAction['actionType'],
    targetType: FluxerGuildStructurePlannedAction['targetType'],
    item: { id: string; name: string | null },
    details: Record<string, unknown>
): FluxerGuildStructurePlannedAction {
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

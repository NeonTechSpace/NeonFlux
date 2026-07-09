import {
    isProtectedFluxerGuildRole,
    type FluxerGuildChannel,
    type FluxerGuildRole,
    type FluxerGuildStructure,
} from './guild-structure.js';

export type FluxerGuildStructureSnapshot = {
    version: 1;
    guildId?: string;
    guildName?: string;
    botHighestRolePosition?: number;
    botHighestRoleHierarchyRank?: number;
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

export type FluxerGuildStructureDiffOptions = {
    includeDeletes?: boolean;
    resetBeforeCreate?: boolean;
};

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
            ...(typeof value.botHighestRolePosition === 'number' &&
            Number.isFinite(value.botHighestRolePosition) &&
            value.botHighestRolePosition >= 0
                ? { botHighestRolePosition: value.botHighestRolePosition }
                : {}),
            ...(typeof value.botHighestRoleHierarchyRank === 'number' &&
            Number.isFinite(value.botHighestRoleHierarchyRank) &&
            value.botHighestRoleHierarchyRank >= 0
                ? { botHighestRoleHierarchyRank: value.botHighestRoleHierarchyRank }
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
    requested: FluxerGuildStructureSnapshot,
    options: FluxerGuildStructureDiffOptions = {}
): FluxerGuildStructurePlan {
    const includeDeletes = options.includeDeletes ?? true;
    if (options.resetBeforeCreate) {
        return createResetBeforeCreatePlan(current, requested, includeDeletes);
    }

    const roleIdentity = buildRoleIdentity(current.roles, requested.roles, current.guildId, requested.guildId);
    const categoryIdentity = buildCategoryIdentity(current.categories, requested.categories);
    const channelIdentity = buildChannelIdentity(current.channels, requested.channels, categoryIdentity);
    const actions = [
        ...diffCollection('role', current.roles, requested.roles, roleFields, {
            identity: roleIdentity,
            includeDeletes,
            shouldSkipCurrentDelete: (role) => isProtectedSnapshotRole(role, current.guildId),
            shouldSkipRequested: (role) => isProtectedSnapshotRole(role, requested.guildId),
            shouldSkipUpdate: (currentRole, requestedRole) =>
                isProtectedSnapshotRole(currentRole, current.guildId) ||
                isProtectedSnapshotRole(requestedRole, requested.guildId),
        }),
        ...diffCollection('category', current.categories, requested.categories, channelFields, {
            includeDeletes,
            identity: categoryIdentity,
        }),
        ...diffCollection('channel', current.channels, requested.channels, channelFields, {
            includeDeletes,
            identity: channelIdentity,
            mapRequestedItem: (channel) => mapRequestedChannel(channel, categoryIdentity),
        }),
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

function createResetBeforeCreatePlan(
    current: FluxerGuildStructureSnapshot,
    requested: FluxerGuildStructureSnapshot,
    includeDeletes: boolean
): FluxerGuildStructurePlan {
    const actions = [
        ...(includeDeletes
            ? [
                  ...current.roles
                      .filter((role) => !isProtectedSnapshotRole(role, current.guildId))
                      .map((role) => toAction('delete', 'role', role, { before: role })),
                  ...current.categories.map((category) =>
                      toAction('delete', 'category', category, { before: category })
                  ),
                  ...current.channels.map((channel) => toAction('delete', 'channel', channel, { before: channel })),
              ]
            : []),
        ...requested.roles
            .filter((role) => !isProtectedSnapshotRole(role, requested.guildId))
            .map((role) => toAction('create', 'role', role, { after: role })),
        ...requested.categories.map((category) => toAction('create', 'category', category, { after: category })),
        ...requested.channels.map((channel) => toAction('create', 'channel', channel, { after: channel })),
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

function isProtectedSnapshotRole(role: FluxerGuildRole, guildId: string | undefined): boolean {
    return (
        isProtectedFluxerGuildRole(role) ||
        (typeof guildId === 'string' && role.id === guildId) ||
        (role.name === '@everyone' && role.position === 0)
    );
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
    fields: ReadonlyArray<keyof TItem>,
    options: {
        includeDeletes?: boolean;
        identity?: CollectionIdentity;
        mapRequestedItem?: (item: TItem) => TItem;
        shouldSkipCurrentDelete?: (item: TItem) => boolean;
        shouldSkipRequested?: (item: TItem) => boolean;
        shouldSkipUpdate?: (current: TItem, requested: TItem) => boolean;
    } = {}
): FluxerGuildStructurePlannedAction[] {
    const currentById = new Map(currentItems.map((item) => [item.id, item]));
    const requestedCurrentIds =
        options.identity?.usedCurrentIds ?? new Set(requestedItems.map((requested) => requested.id));
    const actions: FluxerGuildStructurePlannedAction[] = [];

    for (const requested of requestedItems) {
        if (options.shouldSkipRequested?.(requested)) continue;

        const currentId = options.identity?.requestedToCurrentId.get(requested.id) ?? requested.id;
        const current = currentById.get(currentId);
        const requestedForAction = options.mapRequestedItem?.(requested) ?? requested;

        if (!current) {
            actions.push(toAction('create', targetType, requestedForAction, { after: requestedForAction }));
            continue;
        }

        if (options.shouldSkipUpdate?.(current, requestedForAction)) continue;

        const changes = diffFields(current, requestedForAction, fields);

        if (changes.length > 0) {
            actions.push(
                toAction(
                    'update',
                    targetType,
                    { ...requestedForAction, id: current.id },
                    {
                        changes,
                        ...(targetType === 'role' ? { sourceId: requested.id } : {}),
                    }
                )
            );
        }
    }

    if (options.includeDeletes ?? true) {
        for (const current of currentItems) {
            if (options.shouldSkipCurrentDelete?.(current)) continue;

            if (!requestedCurrentIds.has(current.id)) {
                actions.push(toAction('delete', targetType, current, { before: current }));
            }
        }
    }

    return actions;
}

type CollectionIdentity = {
    requestedToCurrentId: Map<string, string>;
    usedCurrentIds: Set<string>;
};

function buildRoleIdentity(
    currentRoles: readonly FluxerGuildRole[],
    requestedRoles: readonly FluxerGuildRole[],
    currentGuildId: string | undefined,
    requestedGuildId: string | undefined
): CollectionIdentity {
    return buildCollectionIdentity(currentRoles, requestedRoles, (requested, current, usedCurrentIds) => {
        if (isProtectedSnapshotRole(requested, requestedGuildId)) return undefined;

        const sameNameCandidates = current.filter(
            (candidate) =>
                !usedCurrentIds.has(candidate.id) &&
                !isProtectedSnapshotRole(candidate, currentGuildId) &&
                sameStructureName(candidate, requested)
        );
        const exactShapeCandidates = sameNameCandidates.filter((candidate) =>
            sameRoleImportShape(candidate, requested)
        );

        if (exactShapeCandidates.length === 1) {
            return exactShapeCandidates[0];
        }

        return sameNameCandidates.length === 1 ? sameNameCandidates[0] : undefined;
    });
}

function sameRoleImportShape(left: FluxerGuildRole, right: FluxerGuildRole): boolean {
    return roleFields.every((field) => stableValueKey(left[field]) === stableValueKey(right[field]));
}

function buildCategoryIdentity(
    currentCategories: readonly FluxerGuildChannel[],
    requestedCategories: readonly FluxerGuildChannel[]
): CollectionIdentity {
    return buildCollectionIdentity(currentCategories, requestedCategories, (requested, current, usedCurrentIds) =>
        findUniqueCompatibleItem(current, usedCurrentIds, (candidate) => sameStructureName(candidate, requested))
    );
}

function buildChannelIdentity(
    currentChannels: readonly FluxerGuildChannel[],
    requestedChannels: readonly FluxerGuildChannel[],
    categoryIdentity: CollectionIdentity
): CollectionIdentity {
    return buildCollectionIdentity(currentChannels, requestedChannels, (requested, current, usedCurrentIds) => {
        const requestedParentId = resolveRequestedCategoryId(requested.parentId, categoryIdentity);

        return findUniqueCompatibleItem(
            current,
            usedCurrentIds,
            (candidate) =>
                sameStructureName(candidate, requested) &&
                candidate.type === requested.type &&
                candidate.parentId === requestedParentId
        );
    });
}

function buildCollectionIdentity<TItem extends { id: string }>(
    currentItems: readonly TItem[],
    requestedItems: readonly TItem[],
    findFallbackCurrent: (
        requested: TItem,
        currentItems: readonly TItem[],
        usedCurrentIds: ReadonlySet<string>
    ) => TItem | undefined
): CollectionIdentity {
    const currentById = new Map(currentItems.map((item) => [item.id, item]));
    const requestedToCurrentId = new Map<string, string>();
    const usedCurrentIds = new Set<string>();

    for (const requested of requestedItems) {
        if (currentById.has(requested.id)) {
            requestedToCurrentId.set(requested.id, requested.id);
            usedCurrentIds.add(requested.id);
        }
    }

    for (const requested of requestedItems) {
        if (requestedToCurrentId.has(requested.id)) continue;

        const fallbackCurrent = findFallbackCurrent(requested, currentItems, usedCurrentIds);

        if (!fallbackCurrent) continue;

        requestedToCurrentId.set(requested.id, fallbackCurrent.id);
        usedCurrentIds.add(fallbackCurrent.id);
    }

    return { requestedToCurrentId, usedCurrentIds };
}

function findUniqueCompatibleItem<TItem extends { id: string }>(
    items: readonly TItem[],
    usedItemIds: ReadonlySet<string>,
    isCompatible: (item: TItem) => boolean
): TItem | undefined {
    const candidates = items.filter((item) => !usedItemIds.has(item.id) && isCompatible(item));

    return candidates.length === 1 ? candidates[0] : undefined;
}

function sameStructureName(left: { name: string | null }, right: { name: string | null }): boolean {
    if (typeof left.name !== 'string' || typeof right.name !== 'string') return false;

    return left.name.trim() === right.name.trim();
}

function mapRequestedChannel(channel: FluxerGuildChannel, categoryIdentity: CollectionIdentity): FluxerGuildChannel {
    return {
        ...channel,
        parentId: resolveRequestedCategoryId(channel.parentId, categoryIdentity),
    };
}

function resolveRequestedCategoryId(categoryId: string | null, categoryIdentity: CollectionIdentity): string | null {
    if (!categoryId) return null;

    return categoryIdentity.requestedToCurrentId.get(categoryId) ?? categoryId;
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
            ...(typeof role.hierarchyRank === 'number' && Number.isFinite(role.hierarchyRank)
                ? { hierarchyRank: role.hierarchyRank }
                : {}),
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

function isRoleProtectionReason(value: unknown): value is NonNullable<FluxerGuildRole['protectionReason']> {
    return value === 'everyone' || value === 'bot' || value === 'integration' || value === 'managed';
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
            ...(typeof channel.url === 'string' || channel.url === null ? { url: channel.url } : {}),
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

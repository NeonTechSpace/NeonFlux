import { isProtectedFluxerGuildRole, type FluxerGuildChannel, type FluxerGuildRole } from './guild-structure.js';
import type { FluxerGuildStructureSnapshot } from './guild-structure-snapshot.js';

export {
    normalizeFluxerGuildStructureSnapshot,
    toFluxerGuildStructureSnapshot,
    type FluxerGuildStructureSnapshot,
    type FluxerGuildStructureSnapshotValidationResult,
} from './guild-structure-snapshot.js';

export type FluxerGuildStructurePlannedAction = {
    actionType: 'create' | 'update' | 'delete';
    targetType: 'role' | 'category' | 'channel' | 'role-order';
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
    sourceTargetMap?: Record<string, string>;
};

export type FluxerGuildStructureFieldSummary = {
    names: number;
    permissions: number;
    positions: number;
    parentMoves: number;
    typeChanges: number;
    roleVisuals: number;
};

export type FluxerGuildStructureDiffOptions = {
    includeDeletes?: boolean;
    resetBeforeCreate?: boolean;
};

const roleFields = ['name', 'position', 'color', 'permissions', 'hoist', 'mentionable'] as const;
const roleEditableFields = ['name', 'color', 'permissions', 'hoist', 'mentionable'] as const;
const channelFields = ['name', 'type', 'parentId', 'position', 'permissionOverwrites'] as const;

export class FluxerGuildStructureAmbiguousIdentityError extends Error {
    readonly code = 'ambiguous-structure-identity';

    constructor() {
        super('Server blueprint contains an ambiguous same-name match. Rename duplicates before creating a plan.');
        this.name = 'FluxerGuildStructureAmbiguousIdentityError';
    }
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
    const sourceTargetMap = buildSourceTargetMap(roleIdentity, categoryIdentity, channelIdentity);
    const structuralActions: FluxerGuildStructurePlannedAction[] = [
        ...diffCollection('role', current.roles, requested.roles, roleEditableFields, {
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
    const roleOrderAction = buildRoleOrderAction(
        structuralActions,
        requested,
        hasRolePositionChange(current.roles, requested.roles, roleIdentity)
    );
    const actions = [...structuralActions, ...(roleOrderAction ? [roleOrderAction] : [])];

    return {
        summary: summarizeActions(actions),
        actions,
        ...(Object.keys(sourceTargetMap).length > 0 ? { sourceTargetMap } : {}),
    };
}

function createResetBeforeCreatePlan(
    current: FluxerGuildStructureSnapshot,
    requested: FluxerGuildStructureSnapshot,
    includeDeletes: boolean
): FluxerGuildStructurePlan {
    const structuralActions: FluxerGuildStructurePlannedAction[] = [
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
    const roleOrderAction = buildRoleOrderAction(structuralActions, requested);
    const actions = [...structuralActions, ...(roleOrderAction ? [roleOrderAction] : [])];

    return {
        summary: summarizeActions(actions),
        actions,
    };
}

function buildRoleOrderAction(
    actions: FluxerGuildStructurePlannedAction[],
    requested: FluxerGuildStructureSnapshot,
    hasPositionChange = false
): FluxerGuildStructurePlannedAction | undefined {
    const changesRoleOrder =
        hasPositionChange ||
        actions.some((action) => {
            if (action.targetType !== 'role') return false;
            return action.actionType === 'create' || action.actionType === 'delete';
        });
    if (!changesRoleOrder) return undefined;

    const after = requested.roles.flatMap((role) => {
        if (isProtectedSnapshotRole(role, requested.guildId) || role.position <= 0) return [];
        return [
            {
                sourceId: role.id,
                position: role.position,
                ...(role.hierarchyRank !== undefined ? { hierarchyRank: role.hierarchyRank } : {}),
            },
        ];
    });
    if (after.length === 0) return undefined;

    return {
        actionType: 'update',
        targetType: 'role-order',
        targetId: 'role-order',
        label: 'Role order',
        details: {
            label: 'Role order',
            after,
            changes: [{ field: 'roleOrder', after }],
        },
    };
}

function hasRolePositionChange(
    currentRoles: readonly FluxerGuildRole[],
    requestedRoles: readonly FluxerGuildRole[],
    identity: CollectionIdentity
): boolean {
    const currentById = new Map(currentRoles.map((role) => [role.id, role]));

    return requestedRoles.some((requested) => {
        const currentId = identity.requestedToCurrentId.get(requested.id);
        const current = currentId ? currentById.get(currentId) : undefined;
        return current !== undefined && current.position !== requested.position;
    });
}

function summarizeActions(actions: FluxerGuildStructurePlannedAction[]): FluxerGuildStructurePlanSummary {
    return {
        creates: actions.filter((action) => action.actionType === 'create').length,
        updates: actions.filter((action) => action.actionType === 'update').length,
        deletes: actions.filter((action) => action.actionType === 'delete').length,
        roles: actions.filter((action) => action.targetType === 'role' || action.targetType === 'role-order').length,
        categories: actions.filter((action) => action.targetType === 'category').length,
        channels: actions.filter((action) => action.targetType === 'channel').length,
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
            if (change.field === 'position' || change.field === 'roleOrder') fieldSummary.positions += 1;
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

function buildSourceTargetMap(...identities: CollectionIdentity[]): Record<string, string> {
    return Object.fromEntries(
        identities.flatMap((identity) =>
            [...identity.requestedToCurrentId].filter(([sourceId, targetId]) => sourceId !== targetId)
        )
    );
}

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

        if (exactShapeCandidates.length > 1) throw new FluxerGuildStructureAmbiguousIdentityError();
        if (exactShapeCandidates.length === 1) {
            return exactShapeCandidates[0];
        }

        if (sameNameCandidates.length > 1) throw new FluxerGuildStructureAmbiguousIdentityError();

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

    const fallbackMatches = requestedItems.flatMap((requested) => {
        if (requestedToCurrentId.has(requested.id)) return [];

        const fallbackCurrent = findFallbackCurrent(requested, currentItems, usedCurrentIds);
        return fallbackCurrent ? [{ requested, fallbackCurrent }] : [];
    });
    const fallbackUseCounts = new Map<string, number>();
    for (const match of fallbackMatches) {
        fallbackUseCounts.set(match.fallbackCurrent.id, (fallbackUseCounts.get(match.fallbackCurrent.id) ?? 0) + 1);
    }
    if ([...fallbackUseCounts.values()].some((count) => count > 1)) {
        throw new FluxerGuildStructureAmbiguousIdentityError();
    }

    for (const { requested, fallbackCurrent } of fallbackMatches) {
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

    if (candidates.length > 1) throw new FluxerGuildStructureAmbiguousIdentityError();

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

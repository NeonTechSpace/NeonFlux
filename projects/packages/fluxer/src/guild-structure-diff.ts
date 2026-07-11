import { isProtectedFluxerGuildRole, type FluxerGuildRole } from './guild-structure.js';
import type { FluxerGuildStructureRoleProjection } from './guild-structure-role-projection.js';
import type { FluxerGuildStructureSnapshot } from './guild-structure-snapshot.js';
import type {
    FluxerGuildStructureDiffOptions,
    FluxerGuildStructureFieldSummary,
    FluxerGuildStructurePlan,
    FluxerGuildStructurePlannedAction,
    FluxerGuildStructurePlanSummary,
} from './guild-structure-plan.js';
import {
    emptyIdentity,
    findUnmappedProtectedRoleIds,
    mapRequestedChannel,
    omitProtectedRoleOverwrites,
    projectChannelOrder,
    type CollectionIdentity,
} from './guild-structure-channel-projection.js';
import {
    buildDecisions,
    buildProjectedSnapshot,
    buildRebuildDecisions,
    createFingerprintInput,
    findUnsupportedChannelChanges,
} from './guild-structure-plan-builders.js';
import {
    buildCategoryIdentity,
    buildChannelIdentity,
    buildCompleteSourceTargetMap,
    buildKnownTargetKinds,
    projectRoles,
} from './guild-structure-identity.js';
import { buildFluxerGuildStructureExecutionActions } from './guild-structure-execution-plan.js';

export {
    FluxerGuildStructureAmbiguousIdentityError,
    FluxerGuildStructureInvalidIdentityMappingError,
} from './guild-structure-identity.js';

export {
    normalizeFluxerGuildStructureSnapshot,
    toFluxerGuildStructureSnapshot,
    type FluxerGuildStructureSnapshot,
    type FluxerGuildStructureSnapshotValidationResult,
} from './guild-structure-snapshot.js';

export type {
    FluxerGuildStructureDecision,
    FluxerGuildStructureDiffOptions,
    FluxerGuildStructureFieldSummary,
    FluxerGuildStructurePlan,
    FluxerGuildStructurePlanBlocker,
    FluxerGuildStructurePlanFingerprintInput,
    FluxerGuildStructurePlannedAction,
    FluxerGuildStructurePlanSummary,
    FluxerGuildStructurePolicy,
} from './guild-structure-plan.js';

const roleEditableFields = ['name', 'color', 'permissions', 'hoist', 'mentionable'] as const;
const channelEditableFields = ['name', 'type', 'parentId', 'permissionOverwrites'] as const;

export function diffFluxerGuildStructureSnapshot(
    current: FluxerGuildStructureSnapshot,
    requested: FluxerGuildStructureSnapshot,
    options: FluxerGuildStructureDiffOptions
): FluxerGuildStructurePlan {
    if (options.policy === 'rebuild') return createRebuildPlan(current, requested);

    const deleteUnmatched = options.policy === 'synchronize';

    const roleResult = projectRoles(current, requested, options.policy, !deleteUnmatched, options.roleMappings);
    const roleIdentity = roleResult.identity;
    const categoryIdentity = buildCategoryIdentity(current.categories, requested.categories, options.categoryMappings);
    const channelIdentity = buildChannelIdentity(
        current.channels,
        requested.channels,
        categoryIdentity,
        options.channelMappings
    );
    const ignoredProtectedRoleIds = findUnmappedProtectedRoleIds(
        current.roles,
        requested.roles,
        requested.guildId,
        isProtectedSnapshotRole
    );
    const preservedProtectedOverwriteIds = new Set(
        current.roles.flatMap((role) =>
            role.protectionReason === 'bot' ||
            role.protectionReason === 'integration' ||
            role.protectionReason === 'managed'
                ? [role.id]
                : []
        )
    );
    const currentCategoryById = new Map(current.categories.map((category) => [category.id, category]));
    const currentChannelById = new Map(current.channels.map((channel) => [channel.id, channel]));
    const knownTargetKinds = buildKnownTargetKinds(current);
    const sourceTargetMap = buildCompleteSourceTargetMap(requested, roleIdentity, categoryIdentity, channelIdentity);
    const blockers = findUnsupportedChannelChanges(current, requested, categoryIdentity, channelIdentity);
    const blockedSourceIds = new Set(blockers.map((blocker) => blocker.sourceId));
    const structuralActions: FluxerGuildStructurePlannedAction[] = [
        ...diffCollection('role', current.roles, requested.roles, roleEditableFields, {
            identity: roleIdentity,
            deleteUnmatched,
            shouldSkipCurrentDelete: (role) => isProtectedSnapshotRole(role, current.guildId),
            shouldSkipRequested: (role) => isProtectedSnapshotRole(role, requested.guildId),
            shouldSkipUpdate: (currentRole, requestedRole) =>
                isProtectedSnapshotRole(currentRole, current.guildId) ||
                isProtectedSnapshotRole(requestedRole, requested.guildId),
        }),
        ...diffCollection('category', current.categories, requested.categories, channelEditableFields, {
            deleteUnmatched,
            identity: categoryIdentity,
            shouldSkipUpdate: (_current, requestedCategory) => blockedSourceIds.has(requestedCategory.id),
            mapRequestedItem: (category) => {
                const currentCategory = currentCategoryById.get(
                    categoryIdentity.requestedToCurrentId.get(category.id) ?? category.id
                );
                return mapRequestedChannel(category, {
                    categoryIdentity,
                    roleIdentity,
                    ignoredProtectedRoleIds,
                    preservedProtectedOverwriteIds,
                    ...(currentCategory ? { currentChannel: currentCategory } : {}),
                    ...(current.guildId ? { currentGuildId: current.guildId } : {}),
                    ...(requested.guildId ? { requestedGuildId: requested.guildId } : {}),
                });
            },
        }),
        ...diffCollection('channel', current.channels, requested.channels, channelEditableFields, {
            deleteUnmatched,
            identity: channelIdentity,
            shouldSkipUpdate: (_current, requestedChannel) => blockedSourceIds.has(requestedChannel.id),
            mapRequestedItem: (channel) => {
                const currentChannel = currentChannelById.get(
                    channelIdentity.requestedToCurrentId.get(channel.id) ?? channel.id
                );
                return mapRequestedChannel(channel, {
                    categoryIdentity,
                    roleIdentity,
                    ignoredProtectedRoleIds,
                    preservedProtectedOverwriteIds,
                    ...(currentChannel ? { currentChannel } : {}),
                    ...(current.guildId ? { currentGuildId: current.guildId } : {}),
                    ...(requested.guildId ? { requestedGuildId: requested.guildId } : {}),
                });
            },
        }),
    ];
    const roleOrderAction = buildRoleOrderAction(structuralActions, roleResult.projection, current.roles);
    const channelOrderAction = buildChannelOrderAction({
        actions: structuralActions,
        current,
        requested,
        categoryIdentity,
        channelIdentity,
        retainUnmatchedCurrentChannels: !deleteUnmatched,
    });
    const actions = [
        ...structuralActions,
        ...(channelOrderAction ? [channelOrderAction] : []),
        ...(roleOrderAction ? [roleOrderAction] : []),
    ];
    const executionActions = buildFluxerGuildStructureExecutionActions(actions, options.policy);
    const decisions = buildDecisions({
        current,
        requested,
        policy: options.policy,
        roleIdentity,
        categoryIdentity,
        channelIdentity,
        actions: structuralActions,
        blockers,
    });
    const projectedSnapshot = buildProjectedSnapshot({
        current,
        requested,
        roleProjection: roleResult.projection,
        categoryIdentity,
        channelIdentity,
        retainUnmatched: !deleteUnmatched,
        ignoredProtectedRoleIds,
        preservedProtectedOverwriteIds,
        blockedSourceIds,
    });
    const fingerprintInput = createFingerprintInput(
        options.policy,
        knownTargetKinds,
        sourceTargetMap,
        projectedSnapshot,
        decisions,
        executionActions
    );

    return {
        version: 3,
        policy: options.policy,
        summary: summarizeActions(actions),
        actions,
        executionActions,
        knownTargetKinds,
        sourceTargetMap,
        roleProjection: roleResult.projection,
        projectedSnapshot,
        fingerprintInput,
        decisions,
        blockers,
    };
}

function createRebuildPlan(
    current: FluxerGuildStructureSnapshot,
    requested: FluxerGuildStructureSnapshot
): FluxerGuildStructurePlan {
    const knownTargetKinds = buildKnownTargetKinds(current);
    const roleResult = projectRoles(current, requested, 'rebuild', false);
    const ignoredProtectedRoleIds = findUnmappedProtectedRoleIds(
        current.roles,
        requested.roles,
        requested.guildId,
        isProtectedSnapshotRole
    );
    const structuralActions: FluxerGuildStructurePlannedAction[] = [
        ...[
            ...current.roles
                .filter((role) => !isProtectedSnapshotRole(role, current.guildId))
                .map((role) => toAction('delete', 'role', role, { before: role })),
            ...current.categories.map((category) => toAction('delete', 'category', category, { before: category })),
            ...current.channels.map((channel) => toAction('delete', 'channel', channel, { before: channel })),
        ],
        ...requested.roles
            .filter((role) => !isProtectedSnapshotRole(role, requested.guildId))
            .map((role) => toAction('create', 'role', role, { after: role })),
        ...requested.categories.map((category) => {
            const sanitized = omitProtectedRoleOverwrites(category, ignoredProtectedRoleIds);
            return toAction('create', 'category', sanitized, { after: sanitized });
        }),
        ...requested.channels.map((channel) => {
            const sanitized = omitProtectedRoleOverwrites(channel, ignoredProtectedRoleIds);
            return toAction('create', 'channel', sanitized, { after: sanitized });
        }),
    ];
    const roleOrderAction = buildRoleOrderAction(structuralActions, roleResult.projection, current.roles);
    const channelOrderAction = buildChannelOrderAction({
        actions: structuralActions,
        current,
        requested,
        categoryIdentity: emptyIdentity(),
        channelIdentity: emptyIdentity(),
        retainUnmatchedCurrentChannels: false,
    });
    const actions = [
        ...structuralActions,
        ...(channelOrderAction ? [channelOrderAction] : []),
        ...(roleOrderAction ? [roleOrderAction] : []),
    ];
    const executionActions = buildFluxerGuildStructureExecutionActions(actions, 'rebuild');
    const sourceTargetMap = buildCompleteSourceTargetMap(
        requested,
        roleResult.identity,
        emptyIdentity(),
        emptyIdentity()
    );
    const decisions = buildRebuildDecisions(current, requested);
    const projectedSnapshot = buildProjectedSnapshot({
        current,
        requested,
        roleProjection: roleResult.projection,
        categoryIdentity: emptyIdentity(),
        channelIdentity: emptyIdentity(),
        retainUnmatched: false,
        ignoredProtectedRoleIds,
        preservedProtectedOverwriteIds: new Set(),
        blockedSourceIds: new Set(),
    });
    const fingerprintInput = createFingerprintInput(
        'rebuild',
        knownTargetKinds,
        sourceTargetMap,
        projectedSnapshot,
        decisions,
        executionActions
    );

    return {
        version: 3,
        policy: 'rebuild',
        summary: summarizeActions(actions),
        actions,
        executionActions,
        knownTargetKinds,
        sourceTargetMap,
        roleProjection: roleResult.projection,
        projectedSnapshot,
        fingerprintInput,
        decisions,
        blockers: [],
    };
}

function buildChannelOrderAction(input: {
    actions: FluxerGuildStructurePlannedAction[];
    current: FluxerGuildStructureSnapshot;
    requested: FluxerGuildStructureSnapshot;
    categoryIdentity: CollectionIdentity;
    channelIdentity: CollectionIdentity;
    retainUnmatchedCurrentChannels: boolean;
}): FluxerGuildStructurePlannedAction | undefined {
    const { before, after, resolvedAfter } = projectChannelOrder(input);
    const changesChannelMembership = input.actions.some((action) => {
        if (action.targetType !== 'category' && action.targetType !== 'channel') return false;
        if (action.actionType === 'create' || action.actionType === 'delete') return true;
        const changes = Array.isArray(action.details.changes) ? action.details.changes : [];
        return changes.some((change) => isObject(change) && change.field === 'parentId');
    });
    if (JSON.stringify(before) === JSON.stringify(resolvedAfter) && !changesChannelMembership) {
        return undefined;
    }
    if (after.length === 0) return undefined;

    return {
        actionType: 'update',
        targetType: 'channel-order',
        targetId: 'channel-order',
        label: 'Channel order',
        details: {
            label: 'Channel order',
            before,
            after,
            changes: [{ field: 'channelOrder', before, after }],
        },
    };
}

function buildRoleOrderAction(
    actions: FluxerGuildStructurePlannedAction[],
    projection: FluxerGuildStructureRoleProjection,
    currentRoles: readonly FluxerGuildRole[]
): FluxerGuildStructurePlannedAction | undefined {
    const currentById = new Map(currentRoles.map((role) => [role.id, role]));
    const hasPositionChange = projection.roles.some((role) => {
        if (!role.sourceId) return false;
        if (!role.targetId) return true;
        return currentById.get(role.targetId)?.position !== role.position;
    });
    const changesRoleOrder =
        hasPositionChange ||
        actions.some((action) => {
            if (action.targetType !== 'role') return false;
            return action.actionType === 'create' || action.actionType === 'delete';
        });
    if (!changesRoleOrder) return undefined;

    const after = projection.roles.flatMap((role) => {
        if (!role.sourceId || role.protected || role.position <= 0) return [];
        return [
            {
                sourceId: role.sourceId,
                position: role.position,
                hierarchyRank: role.hierarchyRank,
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

function summarizeActions(actions: FluxerGuildStructurePlannedAction[]): FluxerGuildStructurePlanSummary {
    return {
        creates: actions.filter((action) => action.actionType === 'create').length,
        updates: actions.filter((action) => action.actionType === 'update').length,
        deletes: actions.filter((action) => action.actionType === 'delete').length,
        roles: actions.filter((action) => action.targetType === 'role' || action.targetType === 'role-order').length,
        categories: actions.filter((action) => action.targetType === 'category').length,
        channels: actions.filter((action) => action.targetType === 'channel' || action.targetType === 'channel-order')
            .length,
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
            if (change.field === 'position' || change.field === 'roleOrder' || change.field === 'channelOrder') {
                fieldSummary.positions += 1;
            }
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
        deleteUnmatched?: boolean;
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

    if (options.deleteUnmatched ?? true) {
        for (const current of currentItems) {
            if (options.shouldSkipCurrentDelete?.(current)) continue;

            if (!requestedCurrentIds.has(current.id)) {
                actions.push(toAction('delete', targetType, current, { before: current }));
            }
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

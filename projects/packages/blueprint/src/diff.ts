import { isProtectedBlueprintRole, type BlueprintRole } from './contracts.js';
import type { BlueprintRoleProjection } from './role-projection.js';
import type { BlueprintSnapshot } from './snapshot.js';
import { summarizeBlueprintPlanChanges } from './plan-summary.js';
import {
    BLUEPRINT_PLAN_VERSION,
    type BlueprintDiffOptions,
    type BlueprintFieldSummary,
    type BlueprintPlan,
    type BlueprintPlanStep,
    type BlueprintPlanSummary,
} from './plan.js';
import {
    emptyIdentity,
    findUnmappedProtectedRoleIds,
    mapRequestedChannel,
    omitProtectedRoleOverwrites,
    projectChannelOrder,
    type CollectionIdentity,
} from './channel-projection.js';
import {
    buildDecisions,
    buildProjectedSnapshot,
    buildRebuildDecisions,
    findUnsupportedChannelChanges,
} from './plan-builders.js';
import {
    buildCategoryIdentity,
    buildChannelIdentity,
    buildCompleteSourceTargetMap,
    buildKnownTargetKinds,
    projectRoles,
} from './identity.js';
import { buildBlueprintProviderSteps } from './provider-steps.js';

export { BlueprintAmbiguousIdentityError, BlueprintInvalidIdentityMappingError } from './identity.js';

export {
    createBlueprintSnapshotFingerprintInput,
    BLUEPRINT_SNAPSHOT_LIMITS,
    isBlueprintSnapshotJsonWithinByteLimit,
    normalizeBlueprintSnapshot,
    toPortableBlueprintSnapshot,
    toBlueprintSnapshot,
    type BlueprintSnapshot,
    type BlueprintSnapshotFingerprintInput,
    type BlueprintSnapshotValidationResult,
} from './snapshot.js';

export type {
    BlueprintPlanDecision,
    BlueprintDiffOptions,
    BlueprintFieldSummary,
    BlueprintPlan,
    BlueprintPlanBlocker,
    BlueprintPlanStep,
    BlueprintPlanSummary,
    BlueprintPolicy,
} from './plan.js';

const roleEditableFields = ['name', 'color', 'permissions', 'hoist', 'mentionable'] as const;
const channelEditableFields = ['name', 'type', 'parentId', 'permissionOverwrites'] as const;

export function diffBlueprintSnapshot(
    current: BlueprintSnapshot,
    requested: BlueprintSnapshot,
    options: BlueprintDiffOptions
): BlueprintPlan {
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
    const structuralChanges: BlueprintPlanStep[] = [
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
    const roleOrderChange = buildRoleOrderChange(structuralChanges, roleResult.projection, current.roles);
    const channelOrderChange = buildChannelOrderChange({
        changes: structuralChanges,
        current,
        requested,
        categoryIdentity,
        channelIdentity,
        retainUnmatchedCurrentChannels: !deleteUnmatched,
    });
    const changes = [
        ...structuralChanges,
        ...(channelOrderChange ? [channelOrderChange] : []),
        ...(roleOrderChange ? [roleOrderChange] : []),
    ];
    const steps = buildBlueprintProviderSteps(changes, options.policy);
    const decisions = buildDecisions({
        current,
        requested,
        policy: options.policy,
        roleIdentity,
        categoryIdentity,
        channelIdentity,
        changes: structuralChanges,
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
    return {
        version: BLUEPRINT_PLAN_VERSION,
        policy: options.policy,
        summary: summarizeBlueprintPlanChanges(changes),
        changes,
        steps,
        knownTargetKinds,
        sourceTargetMap,
        mappings: {
            roles: { ...(options.roleMappings ?? {}) },
            categories: { ...(options.categoryMappings ?? {}) },
            channels: { ...(options.channelMappings ?? {}) },
        },
        roleProjection: roleResult.projection,
        projectedSnapshot,
        decisions,
        blockers,
    };
}

function createRebuildPlan(current: BlueprintSnapshot, requested: BlueprintSnapshot): BlueprintPlan {
    const knownTargetKinds = buildKnownTargetKinds(current);
    const roleResult = projectRoles(current, requested, 'rebuild', false);
    const ignoredProtectedRoleIds = findUnmappedProtectedRoleIds(
        current.roles,
        requested.roles,
        requested.guildId,
        isProtectedSnapshotRole
    );
    const structuralChanges: BlueprintPlanStep[] = [
        ...[
            ...current.roles
                .filter((role) => !isProtectedSnapshotRole(role, current.guildId))
                .map((role) => toChange('delete', 'role', role, { before: role })),
            ...current.categories.map((category) => toChange('delete', 'category', category, { before: category })),
            ...current.channels.map((channel) => toChange('delete', 'channel', channel, { before: channel })),
        ],
        ...requested.roles
            .filter((role) => !isProtectedSnapshotRole(role, requested.guildId))
            .map((role) => toChange('create', 'role', role, { after: role })),
        ...requested.categories.map((category) => {
            const sanitized = omitProtectedRoleOverwrites(category, ignoredProtectedRoleIds);
            return toChange('create', 'category', sanitized, { after: sanitized });
        }),
        ...requested.channels.map((channel) => {
            const sanitized = omitProtectedRoleOverwrites(channel, ignoredProtectedRoleIds);
            return toChange('create', 'channel', sanitized, { after: sanitized });
        }),
    ];
    const roleOrderChange = buildRoleOrderChange(structuralChanges, roleResult.projection, current.roles);
    const channelOrderChange = buildChannelOrderChange({
        changes: structuralChanges,
        current,
        requested,
        categoryIdentity: emptyIdentity(),
        channelIdentity: emptyIdentity(),
        retainUnmatchedCurrentChannels: false,
    });
    const changes = [
        ...structuralChanges,
        ...(channelOrderChange ? [channelOrderChange] : []),
        ...(roleOrderChange ? [roleOrderChange] : []),
    ];
    const steps = buildBlueprintProviderSteps(changes, 'rebuild');
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
    return {
        version: BLUEPRINT_PLAN_VERSION,
        policy: 'rebuild',
        summary: summarizeBlueprintPlanChanges(changes),
        changes,
        steps,
        knownTargetKinds,
        sourceTargetMap,
        mappings: { roles: {}, categories: {}, channels: {} },
        roleProjection: roleResult.projection,
        projectedSnapshot,
        decisions,
        blockers: [],
    };
}

function buildChannelOrderChange(input: {
    changes: BlueprintPlanStep[];
    current: BlueprintSnapshot;
    requested: BlueprintSnapshot;
    categoryIdentity: CollectionIdentity;
    channelIdentity: CollectionIdentity;
    retainUnmatchedCurrentChannels: boolean;
}): BlueprintPlanStep | undefined {
    const { before, after, resolvedAfter } = projectChannelOrder(input);
    const changesChannelMembership = input.changes.some((change) => {
        if (change.targetType !== 'category' && change.targetType !== 'channel') return false;
        if (change.actionType === 'create' || change.actionType === 'delete') return true;
        const changes = Array.isArray(change.details.changes) ? change.details.changes : [];
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

function buildRoleOrderChange(
    changes: BlueprintPlanStep[],
    projection: BlueprintRoleProjection,
    currentRoles: readonly BlueprintRole[]
): BlueprintPlanStep | undefined {
    const currentById = new Map(currentRoles.map((role) => [role.id, role]));
    const hasPositionChange = projection.roles.some((role) => {
        if (!role.sourceId) return false;
        if (!role.targetId) return true;
        return currentById.get(role.targetId)?.position !== role.position;
    });
    const changesRoleOrder =
        hasPositionChange ||
        changes.some((change) => {
            if (change.targetType !== 'role') return false;
            return change.actionType === 'create' || change.actionType === 'delete';
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

function isProtectedSnapshotRole(role: BlueprintRole, guildId: string | undefined): boolean {
    return (
        isProtectedBlueprintRole(role) ||
        (typeof guildId === 'string' && role.id === guildId) ||
        (role.name === '@everyone' && role.position === 0)
    );
}

export function countBlueprintPlanChanges(summary: BlueprintPlanSummary): number {
    return summary.creates + summary.updates + summary.deletes;
}

export function summarizeBlueprintPlanFields(plan: BlueprintPlan): BlueprintFieldSummary {
    const fieldSummary: BlueprintFieldSummary = {
        names: 0,
        permissions: 0,
        positions: 0,
        parentMoves: 0,
        typeChanges: 0,
        roleVisuals: 0,
    };

    for (const change of plan.changes) {
        const changes =
            'changes' in change.details && Array.isArray(change.details.changes) ? change.details.changes : [];

        for (const change of changes) {
            if (!isObject(change) || typeof change.field !== 'string') continue;
            const field = change.field as string;

            if (field === 'name') fieldSummary.names += 1;
            if (field === 'permissionOverwrites' || field === 'permissions') {
                fieldSummary.permissions += 1;
            }
            if (field === 'position' || field === 'roleOrder' || field === 'channelOrder') {
                fieldSummary.positions += 1;
            }
            if (field === 'parentId') fieldSummary.parentMoves += 1;
            if (field === 'type') fieldSummary.typeChanges += 1;
            if (field === 'color' || field === 'hoist' || field === 'mentionable') {
                fieldSummary.roleVisuals += 1;
            }
        }
    }

    return fieldSummary;
}

function diffCollection<TItem extends { id: string; name: string | null }>(
    targetType: 'role' | 'category' | 'channel',
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
): BlueprintPlanStep[] {
    const currentById = new Map(currentItems.map((item) => [item.id, item]));
    const requestedCurrentIds =
        options.identity?.usedCurrentIds ?? new Set(requestedItems.map((requested) => requested.id));
    const changes: BlueprintPlanStep[] = [];

    for (const requested of requestedItems) {
        if (options.shouldSkipRequested?.(requested)) continue;

        const currentId = options.identity?.requestedToCurrentId.get(requested.id) ?? requested.id;
        const current = currentById.get(currentId);
        const requestedForChange = options.mapRequestedItem?.(requested) ?? requested;

        if (!current) {
            changes.push(toChange('create', targetType, requestedForChange, { after: requestedForChange }));
            continue;
        }

        if (options.shouldSkipUpdate?.(current, requestedForChange)) continue;

        const fieldChanges = diffFields(current, requestedForChange, fields);

        if (fieldChanges.length > 0) {
            changes.push(
                toChange(
                    'update',
                    targetType,
                    { ...requestedForChange, id: current.id },
                    {
                        changes: fieldChanges,
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
                changes.push(toChange('delete', targetType, current, { before: current }));
            }
        }
    }

    return changes;
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

function toChange(
    actionType: BlueprintPlanStep['actionType'],
    targetType: 'role' | 'category' | 'channel',
    item: { id: string; name: string | null },
    details: Record<string, unknown>
): BlueprintPlanStep {
    return {
        actionType,
        targetType,
        targetId: item.id,
        label: item.name ?? item.id,
        details: {
            label: item.name ?? item.id,
            ...details,
        },
    } as BlueprintPlanStep;
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

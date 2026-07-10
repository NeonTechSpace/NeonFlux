import { isProtectedFluxerGuildRole, type FluxerGuildChannel, type FluxerGuildRole } from './guild-structure.js';
import {
    mapRequestedChannel,
    projectChannelOrder,
    type CollectionIdentity,
} from './guild-structure-channel-projection.js';
import type { FluxerGuildStructureRoleProjection } from './guild-structure-role-projection.js';
import type { FluxerGuildStructureSnapshot } from './guild-structure-snapshot.js';
import type {
    FluxerGuildStructureDecision,
    FluxerGuildStructurePlanBlocker,
    FluxerGuildStructurePlanFingerprintInput,
    FluxerGuildStructurePlannedAction,
    FluxerGuildStructurePolicy,
} from './guild-structure-plan.js';

function isProtectedSnapshotRole(role: FluxerGuildRole, guildId: string | undefined): boolean {
    return (
        isProtectedFluxerGuildRole(role) ||
        (typeof guildId === 'string' && role.id === guildId) ||
        (role.name === '@everyone' && role.position === 0)
    );
}
export function findUnsupportedChannelChanges(
    current: FluxerGuildStructureSnapshot,
    requested: FluxerGuildStructureSnapshot,
    categoryIdentity: CollectionIdentity,
    channelIdentity: CollectionIdentity
): FluxerGuildStructurePlanBlocker[] {
    const blockers: FluxerGuildStructurePlanBlocker[] = [];
    for (const [targetType, requestedItems, currentItems, identity] of [
        ['category', requested.categories, current.categories, categoryIdentity],
        ['channel', requested.channels, current.channels, channelIdentity],
    ] as const) {
        const currentById = new Map(currentItems.map((item) => [item.id, item]));
        for (const source of requestedItems) {
            const targetId = identity.requestedToCurrentId.get(source.id);
            const target = targetId ? currentById.get(targetId) : undefined;
            if (!target) continue;
            const fields: Array<'type' | 'url'> = [];
            if (source.type !== target.type) fields.push('type');
            if ((source.url ?? null) !== (target.url ?? null)) fields.push('url');
            if (fields.length > 0) {
                blockers.push({
                    code: 'unsupported-field-change',
                    targetType,
                    sourceId: source.id,
                    targetId: target.id,
                    fields,
                });
            }
        }
    }
    return blockers.sort(
        (left, right) => left.targetType.localeCompare(right.targetType) || left.sourceId.localeCompare(right.sourceId)
    );
}

export function buildDecisions(input: {
    current: FluxerGuildStructureSnapshot;
    requested: FluxerGuildStructureSnapshot;
    policy: 'merge' | 'synchronize';
    roleIdentity: CollectionIdentity;
    categoryIdentity: CollectionIdentity;
    channelIdentity: CollectionIdentity;
    actions: FluxerGuildStructurePlannedAction[];
    blockers: FluxerGuildStructurePlanBlocker[];
}): FluxerGuildStructureDecision[] {
    const decisions: FluxerGuildStructureDecision[] = [];
    const blockersBySource = new Map(input.blockers.map((blocker) => [blocker.sourceId, blocker]));
    const collections = [
        ['role', input.requested.roles, input.current.roles, input.roleIdentity],
        ['category', input.requested.categories, input.current.categories, input.categoryIdentity],
        ['channel', input.requested.channels, input.current.channels, input.channelIdentity],
    ] as const;
    for (const [targetType, requestedItems, currentItems, identity] of collections) {
        for (const source of requestedItems) {
            if (targetType === 'role' && isProtectedSnapshotRole(source as FluxerGuildRole, input.requested.guildId)) {
                decisions.push({
                    targetType,
                    classification: 'protected-omitted',
                    reason: 'source-protected-omit',
                    sourceId: source.id,
                });
                continue;
            }
            const targetId = identity.requestedToCurrentId.get(source.id);
            const blocker = blockersBySource.get(source.id);
            if (blocker && targetId) {
                decisions.push({
                    targetType,
                    classification: 'blocked-unsupported',
                    reason: 'blocked-unsupported',
                    sourceId: source.id,
                    targetId,
                    changes: blocker.fields.map((field) => ({
                        field,
                        before: (currentItems.find((item) => item.id === targetId) as FluxerGuildChannel | undefined)?.[
                            field
                        ],
                        after: (source as FluxerGuildChannel)[field],
                    })),
                });
                continue;
            }
            if (!targetId) {
                decisions.push({
                    targetType,
                    classification: 'create',
                    reason: 'source-unmatched',
                    sourceId: source.id,
                });
                continue;
            }
            const update = input.actions.find(
                (action) =>
                    action.actionType === 'update' && action.targetType === targetType && action.targetId === targetId
            );
            const decision: FluxerGuildStructureDecision = {
                targetType,
                classification: update ? 'update' : 'no-op',
                reason: update ? 'matched-change' : 'matched-equal',
                sourceId: source.id,
                targetId,
            };
            if (update && Array.isArray(update.details.changes)) {
                decision.changes = update.details.changes as NonNullable<FluxerGuildStructureDecision['changes']>;
            }
            decisions.push(decision);
        }
        for (const target of currentItems) {
            if (identity.usedCurrentIds.has(target.id)) continue;
            const protectedTarget =
                targetType === 'role' && isProtectedSnapshotRole(target as FluxerGuildRole, input.current.guildId);
            decisions.push({
                targetType,
                classification: protectedTarget
                    ? 'protected-retained'
                    : input.policy === 'merge'
                      ? 'unmanaged-retained'
                      : 'delete',
                reason: protectedTarget
                    ? 'target-protected-retain'
                    : input.policy === 'merge'
                      ? 'target-unmatched-retain'
                      : 'target-unmatched-delete',
                targetId: target.id,
            });
        }
    }
    return sortDecisions(decisions);
}

export function buildRebuildDecisions(
    current: FluxerGuildStructureSnapshot,
    requested: FluxerGuildStructureSnapshot
): FluxerGuildStructureDecision[] {
    const decisions: FluxerGuildStructureDecision[] = [];
    for (const role of current.roles) {
        const protectedTarget = isProtectedSnapshotRole(role, current.guildId);
        decisions.push({
            targetType: 'role',
            classification: protectedTarget ? 'protected-retained' : 'delete',
            reason: protectedTarget ? 'target-protected-retain' : 'rebuild-delete',
            targetId: role.id,
        });
    }
    for (const [targetType, items] of [
        ['category', current.categories],
        ['channel', current.channels],
    ] as const) {
        for (const item of items) {
            decisions.push({ targetType, classification: 'delete', reason: 'rebuild-delete', targetId: item.id });
        }
    }
    for (const role of requested.roles) {
        const omitted = isProtectedSnapshotRole(role, requested.guildId);
        decisions.push({
            targetType: 'role',
            classification: omitted ? 'protected-omitted' : 'create',
            reason: omitted ? 'source-protected-omit' : 'rebuild-create',
            sourceId: role.id,
        });
    }
    for (const [targetType, items] of [
        ['category', requested.categories],
        ['channel', requested.channels],
    ] as const) {
        for (const item of items) {
            decisions.push({ targetType, classification: 'create', reason: 'rebuild-create', sourceId: item.id });
        }
    }
    return sortDecisions(decisions);
}

function sortDecisions(decisions: FluxerGuildStructureDecision[]): FluxerGuildStructureDecision[] {
    return decisions.sort(
        (left, right) =>
            left.targetType.localeCompare(right.targetType) ||
            (left.sourceId ?? '').localeCompare(right.sourceId ?? '') ||
            (left.targetId ?? '').localeCompare(right.targetId ?? '') ||
            left.classification.localeCompare(right.classification)
    );
}

export function buildProjectedSnapshot(input: {
    current: FluxerGuildStructureSnapshot;
    requested: FluxerGuildStructureSnapshot;
    roleProjection: FluxerGuildStructureRoleProjection;
    categoryIdentity: CollectionIdentity;
    channelIdentity: CollectionIdentity;
    retainUnmatched: boolean;
    ignoredProtectedRoleIds: ReadonlySet<string>;
    preservedProtectedOverwriteIds: ReadonlySet<string>;
    blockedSourceIds: ReadonlySet<string>;
}): FluxerGuildStructureSnapshot {
    const currentRoleById = new Map(input.current.roles.map((role) => [role.id, role]));
    const requestedRoleById = new Map(input.requested.roles.map((role) => [role.id, role]));
    const roles = input.roleProjection.roles.flatMap((entry): FluxerGuildRole[] => {
        const base = entry.sourceId ? requestedRoleById.get(entry.sourceId) : undefined;
        const retained = entry.targetId ? currentRoleById.get(entry.targetId) : undefined;
        const role = base ?? retained;
        if (!role) return [];
        return [
            {
                ...role,
                id: entry.targetId ?? entry.sourceId ?? entry.logicalId,
                position: entry.position,
                hierarchyRank: entry.hierarchyRank,
            },
        ];
    });
    const currentCategoryById = new Map(input.current.categories.map((item) => [item.id, item]));
    const currentChannelById = new Map(input.current.channels.map((item) => [item.id, item]));
    const order = projectChannelOrder({
        current: input.current,
        requested: input.requested,
        categoryIdentity: input.categoryIdentity,
        channelIdentity: input.channelIdentity,
        retainUnmatchedCurrentChannels: input.retainUnmatched,
    }).resolvedAfter;
    const positions = new Map(order.map((entry) => [entry.sourceId, entry.position]));
    const mapCollection = (
        requestedItems: readonly FluxerGuildChannel[],
        currentItems: readonly FluxerGuildChannel[],
        currentById: ReadonlyMap<string, FluxerGuildChannel>,
        identity: CollectionIdentity
    ): FluxerGuildChannel[] => {
        const projected = requestedItems.map((source) => {
            const targetId = identity.requestedToCurrentId.get(source.id);
            const currentItem = targetId ? currentById.get(targetId) : undefined;
            if (input.blockedSourceIds.has(source.id) && currentItem) return canonicalizeProjectedChannel(currentItem);
            const mapped = mapRequestedChannel(source, {
                categoryIdentity: input.categoryIdentity,
                roleIdentity: {
                    requestedToCurrentId: new Map(
                        input.roleProjection.roles.flatMap((role) =>
                            role.sourceId ? [[role.sourceId, role.targetId ?? role.sourceId] as const] : []
                        )
                    ),
                    usedCurrentIds: new Set(),
                },
                ignoredProtectedRoleIds: input.ignoredProtectedRoleIds,
                preservedProtectedOverwriteIds: input.preservedProtectedOverwriteIds,
                ...(currentItem ? { currentChannel: currentItem } : {}),
                ...(input.current.guildId ? { currentGuildId: input.current.guildId } : {}),
                ...(input.requested.guildId ? { requestedGuildId: input.requested.guildId } : {}),
            });
            const id = targetId ?? source.id;
            return canonicalizeProjectedChannel({ ...mapped, id, position: positions.get(id) ?? mapped.position });
        });
        if (!input.retainUnmatched) return projected;
        return [
            ...projected,
            ...currentItems
                .filter((item) => !identity.usedCurrentIds.has(item.id))
                .map((item) =>
                    canonicalizeProjectedChannel({ ...item, position: positions.get(item.id) ?? item.position })
                ),
        ];
    };
    const categories = mapCollection(
        input.requested.categories,
        input.current.categories,
        currentCategoryById,
        input.categoryIdentity
    );
    const channels = mapCollection(
        input.requested.channels,
        input.current.channels,
        currentChannelById,
        input.channelIdentity
    );
    return {
        version: 1,
        ...(input.current.guildId ? { guildId: input.current.guildId } : {}),
        roles,
        categories: categories.sort(compareProjectedChannels),
        channels: channels.sort(compareProjectedChannels),
    };
}

function canonicalizeProjectedChannel(channel: FluxerGuildChannel): FluxerGuildChannel {
    return {
        ...channel,
        permissionOverwrites: [...channel.permissionOverwrites].sort(
            (left, right) => left.type - right.type || left.id.localeCompare(right.id)
        ),
    };
}

function compareProjectedChannels(left: FluxerGuildChannel, right: FluxerGuildChannel): number {
    return (
        (left.parentId ?? '').localeCompare(right.parentId ?? '') ||
        (left.position ?? 0) - (right.position ?? 0) ||
        left.id.localeCompare(right.id)
    );
}

export function createFingerprintInput(
    policy: FluxerGuildStructurePolicy,
    sourceTargetMap: Record<string, string | null>,
    projectedSnapshot: FluxerGuildStructureSnapshot,
    decisions: FluxerGuildStructureDecision[]
): FluxerGuildStructurePlanFingerprintInput {
    return { version: 2, policy, sourceTargetMap, projectedSnapshot, decisions };
}

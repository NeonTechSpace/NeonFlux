import { isProtectedFluxerGuildRole, type FluxerGuildChannel, type FluxerGuildRole } from './guild-structure.js';
import { resolveRequestedCategoryId, type CollectionIdentity } from './guild-structure-channel-projection.js';
import {
    FluxerGuildStructureAmbiguousRoleIdentityError,
    FluxerGuildStructureInvalidRoleMappingError,
    projectFluxerGuildRoles,
    type FluxerGuildStructureRoleIdentityConflict,
} from './guild-structure-role-projection.js';
import type { FluxerGuildStructureSnapshot } from './guild-structure-snapshot.js';
import type { FluxerGuildStructureDecision, FluxerGuildStructurePolicy } from './guild-structure-plan.js';

export class FluxerGuildStructureAmbiguousIdentityError extends Error {
    readonly code = 'ambiguous-structure-identity';
    readonly conflicts: FluxerGuildStructureRoleIdentityConflict[];
    readonly decisions: FluxerGuildStructureDecision[];

    constructor(conflicts: FluxerGuildStructureRoleIdentityConflict[] = []) {
        super(
            'Server blueprint contains an ambiguous identity match. Choose which existing object each source object maps to.'
        );
        this.name = 'FluxerGuildStructureAmbiguousIdentityError';
        this.conflicts = conflicts;
        this.decisions = conflicts.flatMap((conflict) =>
            conflict.sourceIds.map((sourceId) => ({
                targetType: conflict.targetType,
                classification: 'blocked-ambiguous' as const,
                reason: 'blocked-ambiguous' as const,
                sourceId,
                candidateTargetIds: conflict.candidateTargetIds,
            }))
        );
    }
}

export class FluxerGuildStructureInvalidIdentityMappingError extends Error {
    readonly code = 'invalid-identity-mapping';

    constructor(message: string) {
        super(message);
        this.name = 'FluxerGuildStructureInvalidIdentityMappingError';
    }
}

function isProtectedSnapshotRole(role: FluxerGuildRole, guildId: string | undefined): boolean {
    return (
        isProtectedFluxerGuildRole(role) ||
        (typeof guildId === 'string' && role.id === guildId) ||
        (role.name === '@everyone' && role.position === 0)
    );
}

export function buildCompleteSourceTargetMap(
    requested: FluxerGuildStructureSnapshot,
    ...identities: CollectionIdentity[]
): Record<string, string | null> {
    const resolved = new Map(identities.flatMap((identity) => [...identity.requestedToCurrentId]));
    const importable = [
        ...requested.roles.filter((role) => !isProtectedSnapshotRole(role, requested.guildId)),
        ...requested.categories,
        ...requested.channels,
    ];
    const entries = importable.map((item): [string, string | null] => [item.id, resolved.get(item.id) ?? null]);
    return Object.fromEntries(entries.sort(([left], [right]) => left.localeCompare(right)));
}

export function buildKnownTargetKinds(
    current: FluxerGuildStructureSnapshot
): Record<string, 'role' | 'category' | 'channel'> {
    return Object.fromEntries(
        [
            ...(current.guildId ? ([[current.guildId, 'role']] as const) : []),
            ...current.roles.map((role) => [role.id, 'role'] as const),
            ...current.categories.map((category) => [category.id, 'category'] as const),
            ...current.channels.map((channel) => [channel.id, 'channel'] as const),
        ].sort(([left], [right]) => left.localeCompare(right))
    );
}

export function projectRoles(
    current: FluxerGuildStructureSnapshot,
    requested: FluxerGuildStructureSnapshot,
    mode: FluxerGuildStructurePolicy,
    retainUnmatchedCurrentRoles: boolean,
    roleMappings?: Record<string, string>
): ReturnType<typeof projectFluxerGuildRoles> {
    try {
        return projectFluxerGuildRoles({
            currentRoles: current.roles,
            requestedRoles: requested.roles,
            mode,
            retainUnmatchedCurrentRoles,
            ...(current.guildId ? { currentGuildId: current.guildId } : {}),
            ...(requested.guildId ? { requestedGuildId: requested.guildId } : {}),
            ...(roleMappings ? { roleMappings } : {}),
        });
    } catch (error) {
        if (error instanceof FluxerGuildStructureAmbiguousRoleIdentityError) {
            throw new FluxerGuildStructureAmbiguousIdentityError(error.conflicts);
        }
        if (error instanceof FluxerGuildStructureInvalidRoleMappingError) {
            throw new FluxerGuildStructureInvalidIdentityMappingError(error.message);
        }
        throw error;
    }
}

export function buildCategoryIdentity(
    currentCategories: readonly FluxerGuildChannel[],
    requestedCategories: readonly FluxerGuildChannel[],
    mappings?: Record<string, string>
): CollectionIdentity {
    return buildCollectionIdentity(
        'category',
        currentCategories,
        requestedCategories,
        mappings,
        (requested, current, usedCurrentIds) =>
            findUniqueCompatibleItem('category', requested, current, usedCurrentIds, (candidate) =>
                sameStructureName(candidate, requested)
            )
    );
}

export function buildChannelIdentity(
    currentChannels: readonly FluxerGuildChannel[],
    requestedChannels: readonly FluxerGuildChannel[],
    categoryIdentity: CollectionIdentity,
    mappings?: Record<string, string>
): CollectionIdentity {
    return buildCollectionIdentity(
        'channel',
        currentChannels,
        requestedChannels,
        mappings,
        (requested, current, usedCurrentIds) => {
            const requestedParentId = resolveRequestedCategoryId(requested.parentId, categoryIdentity);

            return findUniqueCompatibleItem(
                'channel',
                requested,
                current,
                usedCurrentIds,
                (candidate) =>
                    sameStructureName(candidate, requested) &&
                    candidate.type === requested.type &&
                    candidate.parentId === requestedParentId
            );
        }
    );
}

function buildCollectionIdentity<TItem extends { id: string }>(
    targetType: 'category' | 'channel',
    currentItems: readonly TItem[],
    requestedItems: readonly TItem[],
    mappings: Record<string, string> | undefined,
    findFallbackCurrent: (
        requested: TItem,
        currentItems: readonly TItem[],
        usedCurrentIds: ReadonlySet<string>
    ) => TItem | undefined
): CollectionIdentity {
    const currentById = new Map(currentItems.map((item) => [item.id, item]));
    const requestedToCurrentId = new Map<string, string>();
    const usedCurrentIds = new Set<string>();

    for (const [sourceId, targetId] of Object.entries(mappings ?? {})) {
        if (!requestedItems.some((item) => item.id === sourceId) || !currentById.has(targetId)) {
            throw new FluxerGuildStructureInvalidIdentityMappingError(
                `${targetType} mapping ${sourceId} -> ${targetId} does not reference existing eligible objects.`
            );
        }
        if (usedCurrentIds.has(targetId)) {
            throw new FluxerGuildStructureInvalidIdentityMappingError(
                `${targetType} mapping target ${targetId} is used more than once.`
            );
        }
        requestedToCurrentId.set(sourceId, targetId);
        usedCurrentIds.add(targetId);
    }

    for (const requested of requestedItems) {
        if (requestedToCurrentId.has(requested.id) || usedCurrentIds.has(requested.id)) continue;
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

function findUniqueCompatibleItem<TItem extends { id: string; name?: string | null }>(
    targetType: 'category' | 'channel',
    requested: TItem,
    items: readonly TItem[],
    usedItemIds: ReadonlySet<string>,
    isCompatible: (item: TItem) => boolean
): TItem | undefined {
    const candidates = items.filter((item) => !usedItemIds.has(item.id) && isCompatible(item));

    if (candidates.length > 1) {
        throw new FluxerGuildStructureAmbiguousIdentityError([
            {
                targetType,
                name: typeof requested.name === 'string' ? requested.name : requested.id,
                sourceIds: [requested.id],
                candidateTargetIds: candidates.map((candidate) => candidate.id),
            },
        ]);
    }

    return candidates.length === 1 ? candidates[0] : undefined;
}

function sameStructureName(left: { name: string | null }, right: { name: string | null }): boolean {
    if (typeof left.name !== 'string' || typeof right.name !== 'string') return false;

    return left.name.trim() === right.name.trim();
}

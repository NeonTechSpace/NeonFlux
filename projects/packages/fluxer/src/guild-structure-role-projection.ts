import { isProtectedFluxerGuildRole, type FluxerGuildRole } from './guild-structure.js';

type FluxerGuildStructureRoleProjectionEntry = {
    logicalId: string;
    sourceId?: string;
    targetId?: string;
    name: string;
    hierarchyRank: number;
    position: number;
    disposition: 'matched' | 'create' | 'retained';
    protected?: boolean;
};

export type FluxerGuildStructureRoleProjection = {
    version: 2;
    mode: 'merge' | 'synchronize' | 'rebuild';
    roles: FluxerGuildStructureRoleProjectionEntry[];
    skippedProtectedSourceIds: string[];
    retainedProtectedTargetIds: string[];
};

export type FluxerGuildStructureRoleIdentity = {
    requestedToCurrentId: Map<string, string>;
    usedCurrentIds: Set<string>;
};

export type FluxerGuildStructureRoleIdentityConflict = {
    targetType: 'role' | 'category' | 'channel';
    name: string;
    sourceIds: string[];
    candidateTargetIds: string[];
};

export class FluxerGuildStructureAmbiguousRoleIdentityError extends Error {
    readonly conflicts: FluxerGuildStructureRoleIdentityConflict[];

    constructor(conflicts: FluxerGuildStructureRoleIdentityConflict[]) {
        super(
            'Server blueprint contains an ambiguous same-name role match. Choose which existing role each source role maps to.'
        );
        this.name = 'FluxerGuildStructureAmbiguousRoleIdentityError';
        this.conflicts = conflicts;
    }
}

export class FluxerGuildStructureInvalidRoleMappingError extends Error {
    readonly code = 'invalid-role-mapping';

    constructor(message: string) {
        super(message);
        this.name = 'FluxerGuildStructureInvalidRoleMappingError';
    }
}

export function projectFluxerGuildRoles(input: {
    currentRoles: readonly FluxerGuildRole[];
    requestedRoles: readonly FluxerGuildRole[];
    currentGuildId?: string;
    requestedGuildId?: string;
    mode: 'merge' | 'synchronize' | 'rebuild';
    retainUnmatchedCurrentRoles: boolean;
    roleMappings?: Readonly<Record<string, string>>;
}): { identity: FluxerGuildStructureRoleIdentity; projection: FluxerGuildStructureRoleProjection } {
    const current = canonicalizeRoles(input.currentRoles);
    const requested = canonicalizeRoles(input.requestedRoles);
    const currentMovable = current.filter((role) => !isProtectedSnapshotRole(role, input.currentGuildId));
    const requestedMovable = requested.filter((role) => !isProtectedSnapshotRole(role, input.requestedGuildId));
    const identity =
        input.mode === 'rebuild'
            ? { requestedToCurrentId: new Map<string, string>(), usedCurrentIds: new Set<string>() }
            : resolveRoleIdentity({
                  currentRoles: currentMovable,
                  requestedRoles: requestedMovable,
                  ...(input.roleMappings ? { roleMappings: input.roleMappings } : {}),
              });
    const requestedEntries = requestedMovable.map((role) => {
        const targetId = identity.requestedToCurrentId.get(role.id);
        return {
            role,
            logicalId: role.id,
            sourceId: role.id,
            ...(targetId ? { targetId } : {}),
            disposition: targetId ? ('matched' as const) : ('create' as const),
        };
    });
    const retained = current
        .filter(
            (role) =>
                isProtectedSnapshotRole(role, input.currentGuildId) ||
                (input.retainUnmatchedCurrentRoles && !identity.usedCurrentIds.has(role.id))
        )
        .map((role) => ({
            role,
            logicalId: role.id,
            targetId: role.id,
            disposition: 'retained' as const,
            protected: isProtectedSnapshotRole(role, input.currentGuildId),
        }));
    const projected = stableMergeProjectedRoles(requestedEntries, retained, requested.length, current.length);
    const hasEveryone = projected.some((entry) => isEveryoneRole(entry.role));
    const roles = projected.map((entry, hierarchyRank) => ({
        logicalId: entry.logicalId,
        ...('sourceId' in entry && entry.sourceId ? { sourceId: entry.sourceId } : {}),
        ...(entry.targetId ? { targetId: entry.targetId } : {}),
        name: entry.role.name,
        hierarchyRank,
        position: projected.length - hierarchyRank - (hasEveryone ? 1 : 0),
        disposition: entry.disposition,
        ...('protected' in entry && entry.protected ? { protected: true } : {}),
    }));

    return {
        identity,
        projection: {
            version: 2,
            mode: input.mode,
            roles,
            skippedProtectedSourceIds: requested
                .filter((role) => isProtectedSnapshotRole(role, input.requestedGuildId))
                .map((role) => role.id),
            retainedProtectedTargetIds: current
                .filter((role) => isProtectedSnapshotRole(role, input.currentGuildId))
                .map((role) => role.id),
        },
    };
}

type CanonicalRole = FluxerGuildRole & { canonicalRank: number };

function canonicalizeRoles(roles: readonly FluxerGuildRole[]): CanonicalRole[] {
    return roles
        .map((role, inputIndex) => ({ role, inputIndex }))
        .sort((left, right) => {
            const leftRank = left.role.hierarchyRank;
            const rightRank = right.role.hierarchyRank;
            if (leftRank !== undefined && rightRank !== undefined && leftRank !== rightRank)
                return leftRank - rightRank;
            if (left.role.position !== right.role.position) return right.role.position - left.role.position;
            return left.inputIndex - right.inputIndex || left.role.id.localeCompare(right.role.id);
        })
        .map(({ role }, canonicalRank) => ({ ...role, canonicalRank }));
}

function resolveRoleIdentity(input: {
    currentRoles: readonly CanonicalRole[];
    requestedRoles: readonly CanonicalRole[];
    roleMappings?: Readonly<Record<string, string>>;
}): FluxerGuildStructureRoleIdentity {
    const currentById = new Map(input.currentRoles.map((role) => [role.id, role]));
    const requestedById = new Map(input.requestedRoles.map((role) => [role.id, role]));
    const requestedToCurrentId = new Map<string, string>();
    const usedCurrentIds = new Set<string>();

    for (const [sourceId, targetId] of Object.entries(input.roleMappings ?? {})) {
        if (!requestedById.has(sourceId)) {
            throw new FluxerGuildStructureInvalidRoleMappingError(
                `Role mapping source "${sourceId}" does not exist or is protected.`
            );
        }
        if (!currentById.has(targetId)) {
            throw new FluxerGuildStructureInvalidRoleMappingError(
                `Role mapping target "${targetId}" does not exist or is protected.`
            );
        }
        if (usedCurrentIds.has(targetId)) {
            throw new FluxerGuildStructureInvalidRoleMappingError(
                `Role mapping target "${targetId}" is used more than once.`
            );
        }
        requestedToCurrentId.set(sourceId, targetId);
        usedCurrentIds.add(targetId);
    }

    for (const requested of input.requestedRoles) {
        if (requestedToCurrentId.has(requested.id) || usedCurrentIds.has(requested.id)) continue;
        if (currentById.has(requested.id)) {
            requestedToCurrentId.set(requested.id, requested.id);
            usedCurrentIds.add(requested.id);
        }
    }

    const requestedGroups = groupRolesByName(input.requestedRoles.filter((role) => !requestedToCurrentId.has(role.id)));
    const currentGroups = groupRolesByName(input.currentRoles.filter((role) => !usedCurrentIds.has(role.id)));

    for (const [nameKey, requestedGroup] of requestedGroups) {
        const currentGroup = currentGroups.get(nameKey) ?? [];
        if (currentGroup.length === 0) continue;

        const assignment = findUniqueMinimumAssignment(
            requestedGroup,
            currentGroup,
            input.requestedRoles,
            input.currentRoles
        );
        if (!assignment) {
            throw new FluxerGuildStructureAmbiguousRoleIdentityError([
                {
                    targetType: 'role',
                    name: requestedGroup[0]?.name ?? nameKey,
                    sourceIds: requestedGroup.map((role) => role.id),
                    candidateTargetIds: currentGroup.map((role) => role.id),
                },
            ]);
        }
        for (const [sourceIndex, targetIndex] of assignment) {
            const source = requestedGroup[sourceIndex];
            const target = currentGroup[targetIndex];
            if (!source || !target) continue;
            requestedToCurrentId.set(source.id, target.id);
            usedCurrentIds.add(target.id);
        }
    }

    return { requestedToCurrentId, usedCurrentIds };
}

function groupRolesByName(roles: readonly CanonicalRole[]): Map<string, CanonicalRole[]> {
    const groups = new Map<string, CanonicalRole[]>();
    for (const role of roles) {
        const key = role.name.trim();
        groups.set(key, [...(groups.get(key) ?? []), role]);
    }
    return groups;
}

function findUniqueMinimumAssignment(
    sources: readonly CanonicalRole[],
    targets: readonly CanonicalRole[],
    allSources: readonly CanonicalRole[],
    allTargets: readonly CanonicalRole[]
): Array<[number, number]> | undefined {
    const pairCount = Math.min(sources.length, targets.length);
    if (pairCount === 0) return [];
    if (Math.max(sources.length, targets.length) > 16) return undefined;

    const rowsAreSources = sources.length <= targets.length;
    const rows = rowsAreSources ? sources : targets;
    const columns = rowsAreSources ? targets : sources;
    const rankWeight = pairCount * 1_000_000 + 1;
    const memo = new Map<string, AssignmentState>();

    const solve = (rowIndex: number, usedMask: number): AssignmentState => {
        if (rowIndex === rows.length) return { cost: 0, count: 1, pairs: [] };
        const key = `${String(rowIndex)}:${String(usedMask)}`;
        const cached = memo.get(key);
        if (cached) return cached;

        let best: AssignmentState | undefined;
        for (let columnIndex = 0; columnIndex < columns.length; columnIndex += 1) {
            const bit = 1 << columnIndex;
            if ((usedMask & bit) !== 0) continue;
            const source = rowsAreSources ? rows[rowIndex] : columns[columnIndex];
            const target = rowsAreSources ? columns[columnIndex] : rows[rowIndex];
            if (!source || !target) continue;
            const remainder = solve(rowIndex + 1, usedMask | bit);
            const cost =
                rolePairCost(source, target, allSources.length, allTargets.length, rankWeight) + remainder.cost;
            const pair: [number, number] = rowsAreSources ? [rowIndex, columnIndex] : [columnIndex, rowIndex];
            const candidate = { cost, count: remainder.count, pairs: [pair, ...remainder.pairs] };
            if (!best || candidate.cost < best.cost) best = candidate;
            else if (candidate.cost === best.cost) best = { ...best, count: Math.min(2, best.count + candidate.count) };
        }
        const result = best ?? { cost: Number.POSITIVE_INFINITY, count: 0, pairs: [] };
        memo.set(key, result);
        return result;
    };

    const result = solve(0, 0);
    return result.count === 1 ? result.pairs : undefined;
}

type AssignmentState = { cost: number; count: number; pairs: Array<[number, number]> };

function rolePairCost(
    source: CanonicalRole,
    target: CanonicalRole,
    sourceCount: number,
    targetCount: number,
    rankWeight: number
): number {
    const shapeDifferences =
        Number(source.color !== target.color) +
        Number(source.permissions !== target.permissions) +
        Number(source.hoist !== target.hoist) +
        Number(source.mentionable !== target.mentionable);
    const sourceRank = normalizeRank(source.canonicalRank, sourceCount);
    const targetRank = normalizeRank(target.canonicalRank, targetCount);
    return shapeDifferences * rankWeight + Math.abs(sourceRank - targetRank);
}

function normalizeRank(rank: number, count: number): number {
    return count <= 1 ? 0 : Math.round((rank / (count - 1)) * 1_000_000);
}

function stableMergeProjectedRoles<
    TRequested extends {
        role: CanonicalRole;
        logicalId: string;
        sourceId: string;
        targetId?: string;
        disposition: 'matched' | 'create';
    },
    TRetained extends {
        role: CanonicalRole;
        logicalId: string;
        targetId: string;
        disposition: 'retained';
        protected: boolean;
    },
>(
    requested: TRequested[],
    retained: TRetained[],
    sourceCount: number,
    targetCount: number
): Array<TRequested | TRetained> {
    return [...requested, ...retained].sort((left, right) => {
        if (isEveryoneRole(left.role)) return isEveryoneRole(right.role) ? 0 : 1;
        if (isEveryoneRole(right.role)) return -1;
        const leftCount = 'sourceId' in left ? sourceCount : targetCount;
        const rightCount = 'sourceId' in right ? sourceCount : targetCount;
        const rankDifference =
            normalizeRank(left.role.canonicalRank, leftCount) - normalizeRank(right.role.canonicalRank, rightCount);
        if (rankDifference !== 0) return rankDifference;
        if ('sourceId' in left !== 'sourceId' in right) return 'sourceId' in left ? -1 : 1;
        return left.logicalId.localeCompare(right.logicalId);
    });
}

function isProtectedSnapshotRole(role: FluxerGuildRole, guildId: string | undefined): boolean {
    return (
        isProtectedFluxerGuildRole(role) || (typeof guildId === 'string' && role.id === guildId) || isEveryoneRole(role)
    );
}

function isEveryoneRole(role: FluxerGuildRole): boolean {
    return role.name === '@everyone' && role.position === 0;
}

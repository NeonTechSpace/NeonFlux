import type { BlueprintChannel, BlueprintRole } from './contracts.js';
import type { BlueprintSnapshot } from './snapshot.js';

export type CollectionIdentity = {
    requestedToCurrentId: Map<string, string>;
    usedCurrentIds: Set<string>;
};

export type ChannelOrderEntry = { sourceId: string; parentSourceId: string | null; position: number };

export function emptyIdentity(): CollectionIdentity {
    return { requestedToCurrentId: new Map(), usedCurrentIds: new Set() };
}

export function mapRequestedChannel(
    channel: BlueprintChannel,
    options: {
        categoryIdentity: CollectionIdentity;
        roleIdentity: CollectionIdentity;
        ignoredProtectedRoleIds: ReadonlySet<string>;
        preservedProtectedOverwriteIds: ReadonlySet<string>;
        currentChannel?: BlueprintChannel;
        currentGuildId?: string;
        requestedGuildId?: string;
    }
): BlueprintChannel {
    const sanitized = omitProtectedRoleOverwrites(channel, options.ignoredProtectedRoleIds);
    const mappedOverwrites = sanitized.permissionOverwrites.map((overwrite) => {
        if (overwrite.type !== 0) return overwrite;
        if (options.requestedGuildId && options.currentGuildId && overwrite.id === options.requestedGuildId) {
            return { ...overwrite, id: options.currentGuildId };
        }
        return { ...overwrite, id: options.roleIdentity.requestedToCurrentId.get(overwrite.id) ?? overwrite.id };
    });
    const mappedOverwriteKeys = new Set(
        mappedOverwrites.map((overwrite) => `${String(overwrite.type)}:${overwrite.id}`)
    );
    const preservedOverwrites = (options.currentChannel?.permissionOverwrites ?? []).filter(
        (overwrite) =>
            overwrite.type === 0 &&
            options.preservedProtectedOverwriteIds.has(overwrite.id) &&
            !mappedOverwriteKeys.has(`${String(overwrite.type)}:${overwrite.id}`)
    );
    return {
        ...sanitized,
        parentId: resolveRequestedCategoryId(channel.parentId, options.categoryIdentity),
        permissionOverwrites: [...mappedOverwrites, ...preservedOverwrites],
    };
}

type ProjectedChannelOrderItem = ChannelOrderEntry & {
    sortPosition: number;
    origin: 'requested' | 'retained';
};

export function projectChannelOrder(input: {
    current: BlueprintSnapshot;
    requested: BlueprintSnapshot;
    categoryIdentity: CollectionIdentity;
    channelIdentity: CollectionIdentity;
    retainUnmatchedCurrentChannels: boolean;
}): { before: ChannelOrderEntry[]; after: ChannelOrderEntry[]; resolvedAfter: ChannelOrderEntry[] } {
    const currentChannels = [...input.current.categories, ...input.current.channels];
    const requestedChannels = [...input.requested.categories, ...input.requested.channels];
    const requestedToCurrentId = new Map([
        ...input.categoryIdentity.requestedToCurrentId,
        ...input.channelIdentity.requestedToCurrentId,
    ]);
    const currentCategoryToRequestedId = new Map(
        [...input.categoryIdentity.requestedToCurrentId].map(([sourceId, targetId]) => [targetId, sourceId])
    );
    const usedCurrentIds = new Set(requestedToCurrentId.values());
    const requestedItems: ProjectedChannelOrderItem[] = requestedChannels.map((channel) => ({
        sourceId: channel.id,
        parentSourceId: channel.parentId,
        position: 0,
        sortPosition: channel.position ?? 0,
        origin: 'requested',
    }));
    const retainedItems: ProjectedChannelOrderItem[] = input.retainUnmatchedCurrentChannels
        ? currentChannels
              .filter((channel) => !usedCurrentIds.has(channel.id))
              .map((channel) => ({
                  sourceId: channel.id,
                  parentSourceId: channel.parentId
                      ? (currentCategoryToRequestedId.get(channel.parentId) ?? channel.parentId)
                      : null,
                  position: 0,
                  sortPosition: channel.position ?? 0,
                  origin: 'retained',
              }))
        : [];
    const before = normalizeProjectedChannelOrder(
        currentChannels.map((channel) => ({
            sourceId: channel.id,
            parentSourceId: channel.parentId,
            position: 0,
            sortPosition: channel.position ?? 0,
            origin: 'retained' as const,
        }))
    );
    const after = normalizeProjectedChannelOrder([...requestedItems, ...retainedItems]);
    const resolvedAfter = after.map((entry) => ({
        sourceId: requestedToCurrentId.get(entry.sourceId) ?? entry.sourceId,
        parentSourceId: entry.parentSourceId
            ? (input.categoryIdentity.requestedToCurrentId.get(entry.parentSourceId) ?? entry.parentSourceId)
            : null,
        position: entry.position,
    }));
    return { before, after, resolvedAfter };
}

function normalizeProjectedChannelOrder(items: ProjectedChannelOrderItem[]): ChannelOrderEntry[] {
    const groups = new Map<string, ProjectedChannelOrderItem[]>();
    for (const item of items) {
        const key = item.parentSourceId ?? '';
        groups.set(key, [...(groups.get(key) ?? []), item]);
    }
    return [...groups.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .flatMap(([, siblings]) => {
            const requested = siblings.filter((item) => item.origin === 'requested').sort(compareChannelOrderItems);
            const retained = siblings.filter((item) => item.origin === 'retained').sort(compareChannelOrderItems);
            const requestedRank = new Map(
                requested.map((item, rank) => [item.sourceId, normalizeRank(rank, requested.length)])
            );
            const retainedRank = new Map(
                retained.map((item, rank) => [item.sourceId, normalizeRank(rank, retained.length)])
            );
            return [...requested, ...retained]
                .sort((left, right) => {
                    const leftRank =
                        (left.origin === 'requested' ? requestedRank : retainedRank).get(left.sourceId) ?? 0;
                    const rightRank =
                        (right.origin === 'requested' ? requestedRank : retainedRank).get(right.sourceId) ?? 0;
                    if (leftRank !== rightRank) return leftRank - rightRank;
                    if (left.origin !== right.origin) return left.origin === 'requested' ? -1 : 1;
                    return left.sourceId.localeCompare(right.sourceId);
                })
                .map((item, position) => ({
                    sourceId: item.sourceId,
                    parentSourceId: item.parentSourceId,
                    position,
                }));
        });
}

function compareChannelOrderItems(left: ProjectedChannelOrderItem, right: ProjectedChannelOrderItem): number {
    return left.sortPosition - right.sortPosition || left.sourceId.localeCompare(right.sourceId);
}

function normalizeRank(rank: number, count: number): number {
    return count <= 1 ? 0 : rank / (count - 1);
}

export function findUnmappedProtectedRoleIds(
    currentRoles: readonly BlueprintRole[],
    requestedRoles: readonly BlueprintRole[],
    requestedGuildId: string | undefined,
    isProtected: (role: BlueprintRole, guildId: string | undefined) => boolean
): ReadonlySet<string> {
    const currentRoleIds = new Set(currentRoles.map((role) => role.id));
    return new Set(
        requestedRoles.flatMap((role) =>
            isProtected(role, requestedGuildId) && role.id !== requestedGuildId && !currentRoleIds.has(role.id)
                ? [role.id]
                : []
        )
    );
}

export function omitProtectedRoleOverwrites(
    channel: BlueprintChannel,
    ignoredProtectedRoleIds: ReadonlySet<string>
): BlueprintChannel {
    return {
        ...channel,
        permissionOverwrites: channel.permissionOverwrites.filter(
            (overwrite) => overwrite.type !== 0 || !ignoredProtectedRoleIds.has(overwrite.id)
        ),
    };
}

export function resolveRequestedCategoryId(
    categoryId: string | null,
    categoryIdentity: CollectionIdentity
): string | null {
    if (!categoryId) return null;
    return categoryIdentity.requestedToCurrentId.get(categoryId) ?? categoryId;
}

import {
    normalizeFluxerGuildStructureSnapshot,
    readFluxerBotGuildStructure,
    toFluxerGuildStructureSnapshot,
} from '@neonflux/fluxer';

export async function verifyProjectedStructureSnapshot(
    botToken: string,
    guildId: string,
    plan: Record<string, unknown>,
    idMap: Record<string, string>
): Promise<{
    status: 'matched' | 'mismatch' | 'read_failed';
    expectedFingerprint?: string;
    actualFingerprint?: string;
}> {
    const projected = normalizeFluxerGuildStructureSnapshot(plan.projectedSnapshot);
    if (projected.type !== 'valid') return { status: 'mismatch' };
    const current = await readFluxerBotGuildStructure({ botToken, guildId });
    if (current.isErr()) return { status: 'read_failed' };
    const actual = toFluxerGuildStructureSnapshot(current.value);
    const expectedFingerprint = stableKey(resolveSnapshotIds(projected.snapshot, idMap, guildId));
    const actualFingerprint = stableKey({
        roles: actual.roles,
        categories: actual.categories,
        channels: actual.channels,
    });
    return expectedFingerprint === actualFingerprint
        ? { status: 'matched', expectedFingerprint, actualFingerprint }
        : { status: 'mismatch', expectedFingerprint, actualFingerprint };
}

function resolveSnapshotIds(snapshot: Record<string, unknown>, idMap: Record<string, string>, guildId: string) {
    const sourceGuildId = typeof snapshot.guildId === 'string' ? snapshot.guildId : undefined;
    const roles = Array.isArray(snapshot.roles) ? snapshot.roles : [];
    const categories = Array.isArray(snapshot.categories) ? snapshot.categories : [];
    const channels = Array.isArray(snapshot.channels) ? snapshot.channels : [];
    const resolveItems = (items: unknown[]) =>
        items.map((item) => {
            if (!isObject(item) || typeof item.id !== 'string') return item;
            const permissionOverwrites = Array.isArray(item.permissionOverwrites)
                ? item.permissionOverwrites.map((overwrite: unknown) =>
                      isObject(overwrite) && typeof overwrite.id === 'string' && overwrite.type === 0
                          ? {
                                ...overwrite,
                                id: overwrite.id === sourceGuildId ? guildId : (idMap[overwrite.id] ?? overwrite.id),
                            }
                          : overwrite
                  )
                : undefined;
            return {
                ...item,
                id: idMap[item.id] ?? (item.name === '@everyone' ? guildId : item.id),
                ...(typeof item.parentId === 'string' ? { parentId: idMap[item.parentId] ?? item.parentId } : {}),
                ...(permissionOverwrites ? { permissionOverwrites } : {}),
            };
        });
    return { roles: resolveItems(roles), categories: resolveItems(categories), channels: resolveItems(channels) };
}

function stableKey(value: unknown): string {
    if (Array.isArray(value)) return JSON.stringify(value.map(stableKey).sort());
    if (isObject(value))
        return JSON.stringify(
            Object.entries(value)
                .filter(([key]) => !['exportedAt', 'guildId', 'guildName'].includes(key))
                .sort(([a], [b]) => a.localeCompare(b))
                .map(([key, item]) => [key, stableKey(item)])
        );
    return JSON.stringify(value);
}

function isObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}

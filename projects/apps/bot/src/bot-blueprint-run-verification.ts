import {
    normalizeBlueprintSnapshot,
    sha256CanonicalJson,
    toBlueprintSnapshot,
    type BlueprintSnapshot,
    type BlueprintVerificationResult,
} from '@neonflux/blueprint';
import { readFluxerBotGuildStructure } from '@neonflux/fluxer';

export async function verifyProjectedStructureSnapshot(
    botToken: string,
    guildId: string,
    projectedSnapshot: BlueprintSnapshot,
    idMap: Record<string, string>
): Promise<BlueprintVerificationResult> {
    const projected = normalizeBlueprintSnapshot(projectedSnapshot);
    if (projected.type !== 'valid') {
        return { version: 1, status: 'read_failed', reason: 'projected-snapshot-invalid' };
    }
    const current = await readFluxerBotGuildStructure({ botToken, guildId });
    if (current.isErr()) return { version: 1, status: 'read_failed', reason: 'provider-read-failed' };
    const actual = toBlueprintSnapshot(current.value);
    const [expectedStructureDigest, actualStructureDigest] = await Promise.all([
        sha256CanonicalJson(resolveSnapshotIds(projected.snapshot, idMap, guildId)),
        sha256CanonicalJson({ roles: actual.roles, categories: actual.categories, channels: actual.channels }),
    ]);
    return {
        version: 1,
        status: expectedStructureDigest === actualStructureDigest ? 'matched' : 'mismatch',
        expectedStructureDigest,
        actualStructureDigest,
    };
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

function isObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}

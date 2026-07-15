import { canonicalJsonStringify } from './canonical-json.js';
import type { BlueprintChannel, BlueprintPermissionOverwrite, BlueprintRole } from './contracts.js';
import type { BlueprintSnapshot } from './snapshot.js';

export const BLUEPRINT_MUTATION_FENCE_VERSION = 2 as const;
export const BLUEPRINT_MUTATION_FENCE_MAX_BYTES = 512 * 1024;
export const BLUEPRINT_MUTATION_FENCE_DIAGNOSTIC_ID_LIMIT = 50;

export type BlueprintMutationFenceFieldClass =
    | 'identity'
    | 'structure'
    | 'capability'
    | 'presentation'
    | 'volatile'
    | 'diagnostic';

export const BLUEPRINT_MUTATION_FENCE_FIELD_CLASSIFICATION = {
    snapshot: {
        version: 'identity',
        guildId: 'identity',
        guildName: 'presentation',
        botHighestRolePosition: 'capability',
        botHighestRoleHierarchyRank: 'diagnostic',
        exportedAt: 'volatile',
        roles: 'structure',
        categories: 'structure',
        channels: 'structure',
    } satisfies Record<keyof BlueprintSnapshot, BlueprintMutationFenceFieldClass>,
    role: {
        id: 'identity',
        name: 'structure',
        position: 'structure',
        hierarchyRank: 'diagnostic',
        color: 'structure',
        permissions: 'structure',
        hoist: 'structure',
        mentionable: 'structure',
        protected: 'capability',
        protectionReason: 'capability',
    } satisfies Record<keyof BlueprintRole, BlueprintMutationFenceFieldClass>,
    channel: {
        id: 'identity',
        name: 'structure',
        type: 'structure',
        url: 'presentation',
        parentId: 'structure',
        position: 'structure',
        permissionOverwrites: 'structure',
    } satisfies Record<keyof BlueprintChannel, BlueprintMutationFenceFieldClass>,
    overwrite: {
        id: 'identity',
        type: 'structure',
        allow: 'structure',
        deny: 'structure',
    } satisfies Record<keyof BlueprintPermissionOverwrite, BlueprintMutationFenceFieldClass>,
} as const;

const roleFieldNames = ['name', 'position', 'color', 'permissions', 'hoist', 'mentionable'] as const;
const channelFieldNames = ['name', 'type', 'parentId', 'position', 'permissionOverwrites'] as const;
const capabilityFieldNames = [
    'botHighestRolePosition',
    'botRoleIds',
    'protectedRoleIds',
    'managedRoleIds',
    'integrationRoleIds',
] as const;

export type BlueprintFenceEntityDigest = {
    id: string;
    digest: string;
    fieldDigests: string[];
};

export type BlueprintFenceFieldDigest = {
    field: (typeof capabilityFieldNames)[number];
    digest: string;
};

export type BlueprintMutationFenceManifestV2 = {
    version: typeof BLUEPRINT_MUTATION_FENCE_VERSION;
    guildId: string;
    structureDigest: string;
    capabilityDigest: string;
    roles: BlueprintFenceEntityDigest[];
    categories: BlueprintFenceEntityDigest[];
    channels: BlueprintFenceEntityDigest[];
    capabilityFields: BlueprintFenceFieldDigest[];
};

export type BlueprintFenceCollectionDifference = {
    addedCount: number;
    removedCount: number;
    changedCount: number;
    added: string[];
    removed: string[];
    changed: Array<{ id: string; fields: string[] }>;
};

export type BlueprintMutationFenceComparison = {
    equal: boolean;
    structureChanged: boolean;
    capabilityChanged: boolean;
    roles: BlueprintFenceCollectionDifference;
    categories: BlueprintFenceCollectionDifference;
    channels: BlueprintFenceCollectionDifference;
    capabilityFields: string[];
    truncated: boolean;
};

type StructureInput = {
    version: 2;
    guildId: string;
    roles: Array<ReturnType<typeof roleStructureInput>>;
    categories: Array<ReturnType<typeof channelStructureInput>>;
    channels: Array<ReturnType<typeof channelStructureInput>>;
};

export async function createBlueprintMutationFenceManifest(
    snapshot: BlueprintSnapshot
): Promise<BlueprintMutationFenceManifestV2> {
    const guildId = snapshot.guildId?.trim();
    if (!guildId) throw new Error('blueprint-mutation-fence-guild-id-required');

    const roles = [...snapshot.roles].sort(compareById);
    const categories = [...snapshot.categories].sort(compareById);
    const channels = [...snapshot.channels].sort(compareById);
    const structureInput: StructureInput = {
        version: BLUEPRINT_MUTATION_FENCE_VERSION,
        guildId,
        roles: roles.map(roleStructureInput),
        categories: categories.map(channelStructureInput),
        channels: channels.map(channelStructureInput),
    };
    const capabilityInput = capabilityStructureInput(snapshot, roles);

    const manifest: BlueprintMutationFenceManifestV2 = {
        version: BLUEPRINT_MUTATION_FENCE_VERSION,
        guildId,
        structureDigest: await sha256Hex(canonicalJsonStringify(structureInput)),
        capabilityDigest: await sha256Hex(canonicalJsonStringify(capabilityInput)),
        roles: await Promise.all(roles.map((role) => entityDigest(role.id, roleStructureInput(role)))),
        categories: await Promise.all(
            categories.map((category) => entityDigest(category.id, channelStructureInput(category)))
        ),
        channels: await Promise.all(
            channels.map((channel) => entityDigest(channel.id, channelStructureInput(channel)))
        ),
        capabilityFields: await Promise.all(
            capabilityFieldNames.map(async (field) => ({
                field,
                digest: truncateDigest(await sha256Hex(canonicalJsonStringify(capabilityInput[field]))),
            }))
        ),
    };
    assertManifestSize(manifest);
    return manifest;
}

export function parseBlueprintMutationFenceManifest(value: unknown): BlueprintMutationFenceManifestV2 {
    if (!isRecord(value) || value.version !== 2 || typeof value.guildId !== 'string' || !value.guildId.trim()) {
        throw new Error('blueprint-mutation-fence-manifest-invalid');
    }
    if (!isSha256(value.structureDigest) || !isSha256(value.capabilityDigest)) {
        throw new Error('blueprint-mutation-fence-manifest-invalid');
    }
    const roles = parseEntities(value.roles, roleFieldNames.length);
    const categories = parseEntities(value.categories, channelFieldNames.length);
    const channels = parseEntities(value.channels, channelFieldNames.length);
    if (!Array.isArray(value.capabilityFields) || value.capabilityFields.length !== capabilityFieldNames.length) {
        throw new Error('blueprint-mutation-fence-manifest-invalid');
    }
    const capabilityFields = value.capabilityFields.map((item, index) => {
        const expected = capabilityFieldNames.at(index);
        if (expected === undefined) throw new Error('blueprint-mutation-fence-manifest-invalid');
        if (!isRecord(item) || item.field !== expected || !isDiagnosticDigest(item.digest)) {
            throw new Error('blueprint-mutation-fence-manifest-invalid');
        }
        return { field: expected, digest: item.digest };
    });
    const manifest: BlueprintMutationFenceManifestV2 = {
        version: 2,
        guildId: value.guildId,
        structureDigest: value.structureDigest,
        capabilityDigest: value.capabilityDigest,
        roles,
        categories,
        channels,
        capabilityFields,
    };
    assertManifestSize(manifest);
    return manifest;
}

export function compareBlueprintMutationFenceManifests(
    expected: BlueprintMutationFenceManifestV2,
    actual: BlueprintMutationFenceManifestV2
): BlueprintMutationFenceComparison {
    if (expected.guildId !== actual.guildId) {
        throw new Error('blueprint-mutation-fence-authority-mismatch');
    }
    const roles = compareEntities(expected.roles, actual.roles, roleFieldNames);
    const categories = compareEntities(expected.categories, actual.categories, channelFieldNames);
    const channels = compareEntities(expected.channels, actual.channels, channelFieldNames);
    const capabilityFields = capabilityFieldNames.filter(
        (_, index) => expected.capabilityFields[index]?.digest !== actual.capabilityFields[index]?.digest
    );
    const truncated = [roles, categories, channels].some(
        (item) =>
            item.added.length < item.addedCount ||
            item.removed.length < item.removedCount ||
            item.changed.length < item.changedCount
    );
    return {
        equal:
            expected.structureDigest === actual.structureDigest &&
            expected.capabilityDigest === actual.capabilityDigest,
        structureChanged: expected.structureDigest !== actual.structureDigest,
        capabilityChanged: expected.capabilityDigest !== actual.capabilityDigest,
        roles,
        categories,
        channels,
        capabilityFields,
        truncated,
    };
}

function roleStructureInput(role: BlueprintRole) {
    return {
        id: role.id,
        name: role.name,
        position: role.position,
        color: role.color,
        permissions: normalizeBitfield(role.permissions),
        hoist: role.hoist,
        mentionable: role.mentionable,
    };
}

function channelStructureInput(channel: BlueprintChannel) {
    return {
        id: channel.id,
        name: channel.name,
        type: channel.type,
        parentId: channel.parentId,
        position: channel.position,
        permissionOverwrites: [...channel.permissionOverwrites].sort(compareOverwrites).map((overwrite) => ({
            id: overwrite.id,
            type: overwrite.type,
            allow: normalizeBitfield(overwrite.allow),
            deny: normalizeBitfield(overwrite.deny),
        })),
    };
}

function capabilityStructureInput(snapshot: BlueprintSnapshot, roles: BlueprintRole[]) {
    const roleIds = (reason: BlueprintRole['protectionReason']) =>
        roles.filter((role) => role.protectionReason === reason).map((role) => role.id);
    return {
        botHighestRolePosition: snapshot.botHighestRolePosition ?? null,
        botRoleIds: roleIds('bot'),
        protectedRoleIds: roles.filter((role) => role.protected === true).map((role) => role.id),
        managedRoleIds: roleIds('managed'),
        integrationRoleIds: roleIds('integration'),
    };
}

async function entityDigest(id: string, value: Record<string, unknown>): Promise<BlueprintFenceEntityDigest> {
    const fields = Object.entries(value).filter(([field]) => field !== 'id');
    return {
        id,
        digest: truncateDigest(await sha256Hex(canonicalJsonStringify(value))),
        fieldDigests: await Promise.all(
            fields.map(async ([, fieldValue]) => truncateDigest(await sha256Hex(canonicalJsonStringify(fieldValue))))
        ),
    };
}

function compareEntities(
    expected: BlueprintFenceEntityDigest[],
    actual: BlueprintFenceEntityDigest[],
    fields: readonly string[]
): BlueprintFenceCollectionDifference {
    const expectedById = new Map(expected.map((item) => [item.id, item]));
    const actualById = new Map(actual.map((item) => [item.id, item]));
    const added = actual.filter((item) => !expectedById.has(item.id)).map((item) => item.id);
    const removed = expected.filter((item) => !actualById.has(item.id)).map((item) => item.id);
    const changed = expected.flatMap((item) => {
        const next = actualById.get(item.id);
        if (!next || next.digest === item.digest) return [];
        return [
            {
                id: item.id,
                fields: fields.filter((_, index) => item.fieldDigests[index] !== next.fieldDigests[index]),
            },
        ];
    });
    return {
        addedCount: added.length,
        removedCount: removed.length,
        changedCount: changed.length,
        added: added.slice(0, BLUEPRINT_MUTATION_FENCE_DIAGNOSTIC_ID_LIMIT),
        removed: removed.slice(0, BLUEPRINT_MUTATION_FENCE_DIAGNOSTIC_ID_LIMIT),
        changed: changed.slice(0, BLUEPRINT_MUTATION_FENCE_DIAGNOSTIC_ID_LIMIT),
    };
}

function parseEntities(value: unknown, fieldCount: number): BlueprintFenceEntityDigest[] {
    if (!Array.isArray(value)) throw new Error('blueprint-mutation-fence-manifest-invalid');
    let previousId: string | undefined;
    return value.map((item) => {
        if (
            !isRecord(item) ||
            typeof item.id !== 'string' ||
            !item.id ||
            !isDiagnosticDigest(item.digest) ||
            !Array.isArray(item.fieldDigests) ||
            item.fieldDigests.length !== fieldCount ||
            !item.fieldDigests.every(isDiagnosticDigest) ||
            (previousId !== undefined && previousId >= item.id)
        ) {
            throw new Error('blueprint-mutation-fence-manifest-invalid');
        }
        previousId = item.id;
        return { id: item.id, digest: item.digest, fieldDigests: [...item.fieldDigests] };
    });
}

function normalizeBitfield(value: string): string {
    try {
        const normalized = BigInt(value);
        if (normalized < 0n) throw new Error('negative');
        return normalized.toString(10);
    } catch {
        throw new Error('blueprint-mutation-fence-bitfield-invalid');
    }
}

function compareById(left: { id: string }, right: { id: string }): number {
    return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
}

function compareOverwrites(left: BlueprintPermissionOverwrite, right: BlueprintPermissionOverwrite): number {
    if (left.type !== right.type) return left.type - right.type;
    return compareById(left, right);
}

async function sha256Hex(value: string): Promise<string> {
    const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function truncateDigest(value: string): string {
    return value.slice(0, 32);
}

function assertManifestSize(manifest: BlueprintMutationFenceManifestV2): void {
    if (new TextEncoder().encode(JSON.stringify(manifest)).byteLength > BLUEPRINT_MUTATION_FENCE_MAX_BYTES) {
        throw new Error('blueprint-mutation-fence-manifest-too-large');
    }
}

function isSha256(value: unknown): value is string {
    return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
}

function isDiagnosticDigest(value: unknown): value is string {
    return typeof value === 'string' && /^[0-9a-f]{32}$/.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

import type { BlueprintChannel, BlueprintPermissionOverwrite, BlueprintRole } from './contracts.js';
import type {
    BlueprintChannelChange,
    BlueprintChannelOrderEntry,
    BlueprintRoleChange,
    BlueprintRoleOrderEntry,
} from './plan.js';

const maximumLedgerEntries = 10_000;
const roleKeys = [
    'id',
    'name',
    'position',
    'hierarchyRank',
    'color',
    'permissions',
    'hoist',
    'mentionable',
    'protected',
    'protectionReason',
] as const;
const channelKeys = ['id', 'name', 'type', 'url', 'parentId', 'position', 'permissionOverwrites'] as const;

export function isBlueprintPlanRole(value: unknown): value is BlueprintRole {
    if (!isRecord(value) || !hasOnlyKeys(value, roleKeys)) return false;
    return (
        isBoundedText(value.id, 64) &&
        isBoundedText(value.name, 100) &&
        isNonNegativeInteger(value.position) &&
        (value.hierarchyRank === undefined || isNonNegativeInteger(value.hierarchyRank)) &&
        isRoleColor(value.color) &&
        typeof value.permissions === 'string' &&
        value.permissions.length <= 32 &&
        typeof value.hoist === 'boolean' &&
        typeof value.mentionable === 'boolean' &&
        (value.protected === undefined || typeof value.protected === 'boolean') &&
        (value.protectionReason === undefined || isRoleProtectionReason(value.protectionReason))
    );
}

export function isBlueprintPlanChannel(value: unknown, targetType: 'category' | 'channel'): value is BlueprintChannel {
    if (!isRecord(value) || !hasOnlyKeys(value, channelKeys)) return false;
    if (
        !isBoundedText(value.id, 64) ||
        (value.name !== null && (typeof value.name !== 'string' || value.name.length > 100)) ||
        !isNonNegativeInteger(value.type) ||
        (value.url !== undefined &&
            value.url !== null &&
            (typeof value.url !== 'string' || value.url.length > 2_048)) ||
        (value.parentId !== null && !isBoundedText(value.parentId, 64)) ||
        (value.position !== null && !isNonNegativeInteger(value.position)) ||
        !isPermissionOverwrites(value.permissionOverwrites)
    ) {
        return false;
    }
    return targetType === 'category' ? value.type === 4 && value.parentId === null : value.type !== 4;
}

export function isBlueprintRoleChanges(value: unknown): value is BlueprintRoleChange[] {
    if (!isNonEmptyBoundedArray(value)) return false;
    const fields = new Set<string>();
    for (const change of value) {
        if (!isRecord(change) || !hasOnlyKeys(change, ['field', 'before', 'after']) || !isText(change.field)) {
            return false;
        }
        if (fields.has(change.field)) return false;
        fields.add(change.field);
        const valid =
            (change.field === 'name' &&
                isBoundedText(change.after, 100) &&
                (change.before === undefined || isBoundedText(change.before, 100))) ||
            (change.field === 'color' &&
                isRoleColor(change.after) &&
                (change.before === undefined || isRoleColor(change.before))) ||
            (change.field === 'permissions' &&
                isBoundedString(change.after, 32) &&
                (change.before === undefined || isBoundedString(change.before, 32))) ||
            ((change.field === 'hoist' || change.field === 'mentionable') &&
                typeof change.after === 'boolean' &&
                (change.before === undefined || typeof change.before === 'boolean'));
        if (!valid) return false;
    }
    return true;
}

export function isBlueprintChannelChanges(value: unknown): value is BlueprintChannelChange[] {
    if (!isNonEmptyBoundedArray(value)) return false;
    const fields = new Set<string>();
    for (const change of value) {
        if (!isRecord(change) || !hasOnlyKeys(change, ['field', 'before', 'after']) || !isText(change.field)) {
            return false;
        }
        if (fields.has(change.field)) return false;
        fields.add(change.field);
        const valid =
            (change.field === 'name' &&
                isNullableBoundedString(change.after, 100) &&
                (change.before === undefined || isNullableBoundedString(change.before, 100))) ||
            (change.field === 'parentId' &&
                isNullableBoundedText(change.after, 64) &&
                (change.before === undefined || isNullableBoundedText(change.before, 64))) ||
            (change.field === 'position' &&
                isNullableNonNegativeInteger(change.after) &&
                (change.before === undefined || isNullableNonNegativeInteger(change.before))) ||
            (change.field === 'permissionOverwrites' &&
                isPermissionOverwrites(change.after) &&
                (change.before === undefined || isPermissionOverwrites(change.before)));
        if (!valid) return false;
    }
    return true;
}

export function normalizeBlueprintRoleOrderEntries(
    value: unknown,
    allowEmpty: boolean
): BlueprintRoleOrderEntry[] | undefined {
    if (!Array.isArray(value) || value.length > maximumLedgerEntries || (!allowEmpty && value.length === 0)) {
        return undefined;
    }
    if (
        value.some(
            (entry) =>
                !isRecord(entry) ||
                !hasOnlyKeys(entry, ['sourceId', 'position', 'hierarchyRank']) ||
                !isText(entry.sourceId) ||
                !isNonNegativeInteger(entry.position) ||
                (entry.hierarchyRank !== undefined && !isNonNegativeInteger(entry.hierarchyRank))
        ) ||
        new Set(value.map((entry) => (entry as { sourceId: string }).sourceId)).size !== value.length
    ) {
        return undefined;
    }
    return value as BlueprintRoleOrderEntry[];
}

export function normalizeBlueprintChannelOrderEntries(
    value: unknown,
    allowEmpty: boolean
): BlueprintChannelOrderEntry[] | undefined {
    if (!Array.isArray(value) || value.length > maximumLedgerEntries || (!allowEmpty && value.length === 0)) {
        return undefined;
    }
    if (
        value.some(
            (entry) =>
                !isRecord(entry) ||
                !hasOnlyKeys(entry, ['sourceId', 'parentSourceId', 'position']) ||
                !isText(entry.sourceId) ||
                (entry.parentSourceId !== null && !isText(entry.parentSourceId)) ||
                !isNonNegativeInteger(entry.position)
        ) ||
        new Set(value.map((entry) => (entry as { sourceId: string }).sourceId)).size !== value.length
    ) {
        return undefined;
    }
    return value as BlueprintChannelOrderEntry[];
}

export function isBlueprintOrderChanges<TEntry>(
    value: unknown,
    field: 'roleOrder' | 'channelOrder',
    after: TEntry[],
    normalizeEntries: (entry: unknown, allowEmpty: boolean) => TEntry[] | undefined,
    before?: TEntry[]
): boolean {
    if (!Array.isArray(value) || value.length !== 1) return false;
    const change: unknown = value[0];
    if (!isRecord(change) || !hasOnlyKeys(change, ['field', 'before', 'after']) || change.field !== field) return false;
    const normalizedAfter = normalizeEntries(change.after, false);
    if (!normalizedAfter || stableJson(normalizedAfter) !== stableJson(after)) return false;
    if (before !== undefined) {
        const normalizedBefore = normalizeEntries(change.before, true);
        if (!normalizedBefore || stableJson(normalizedBefore) !== stableJson(before)) return false;
    } else if (change.before !== undefined && !normalizeEntries(change.before, true)) {
        return false;
    }
    return true;
}

export function hasOnlyKeys(value: Record<string, unknown>, allowedKeys: readonly string[]): boolean {
    const allowed = new Set(allowedKeys);
    return Object.keys(value).every((key) => allowed.has(key));
}

function isPermissionOverwrites(value: unknown): value is BlueprintPermissionOverwrite[] {
    if (!Array.isArray(value) || value.length > 1_000) return false;
    const keys = new Set<string>();
    for (const entry of value) {
        if (
            !isRecord(entry) ||
            !hasOnlyKeys(entry, ['id', 'type', 'allow', 'deny']) ||
            !isBoundedText(entry.id, 64) ||
            (entry.type !== 0 && entry.type !== 1) ||
            !isBoundedString(entry.allow, 32) ||
            !isBoundedString(entry.deny, 32)
        ) {
            return false;
        }
        const key = `${String(entry.type)}:${entry.id}`;
        if (keys.has(key)) return false;
        keys.add(key);
    }
    return true;
}

function isNonEmptyBoundedArray(value: unknown): value is unknown[] {
    return Array.isArray(value) && value.length > 0 && value.length <= maximumLedgerEntries;
}

function isNonNegativeInteger(value: unknown): value is number {
    return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function isRoleColor(value: unknown): value is number {
    return isNonNegativeInteger(value) && value <= 0xffffff;
}

function isRoleProtectionReason(value: unknown): boolean {
    return value === 'everyone' || value === 'bot' || value === 'integration' || value === 'managed';
}

function isBoundedString(value: unknown, maximum: number): value is string {
    return typeof value === 'string' && value.length <= maximum;
}

function isBoundedText(value: unknown, maximum: number): value is string {
    return isText(value) && value.length <= maximum;
}

function isNullableBoundedString(value: unknown, maximum: number): value is string | null {
    return value === null || isBoundedString(value, maximum);
}

function isNullableBoundedText(value: unknown, maximum: number): value is string | null {
    return value === null || isBoundedText(value, maximum);
}

function isNullableNonNegativeInteger(value: unknown): value is number | null {
    return value === null || isNonNegativeInteger(value);
}

function stableJson(value: unknown): string {
    return JSON.stringify(value);
}

function isText(value: unknown): value is string {
    return typeof value === 'string' && value.trim().length > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

import { createHash } from 'node:crypto';

import { isDashboardBlueprintPolicy } from './dashboard-blueprint-contracts.js';
import type { DashboardBlueprintPolicy } from './dashboard-blueprint-contracts.js';

export function readBlueprintPolicy(plan: Record<string, unknown>): DashboardBlueprintPolicy | undefined {
    return isDashboardBlueprintPolicy(plan.policy) ? plan.policy : undefined;
}

export function readPersistedRoleMappings(plan: Record<string, unknown>): Record<string, string> {
    return readPersistedMappings(plan, 'roleMappings');
}

export function readPersistedCategoryMappings(plan: Record<string, unknown>): Record<string, string> {
    return readPersistedMappings(plan, 'categoryMappings');
}

export function readPersistedChannelMappings(plan: Record<string, unknown>): Record<string, string> {
    return readPersistedMappings(plan, 'channelMappings');
}

function readPersistedMappings(plan: Record<string, unknown>, key: string): Record<string, string> {
    if (!isObject(plan[key])) return {};

    return Object.fromEntries(
        Object.entries(plan[key]).filter(
            (entry): entry is [string, string] =>
                Boolean(entry[0].trim()) && typeof entry[1] === 'string' && Boolean(entry[1].trim())
        )
    );
}

export function blueprintPlanDigest(fingerprintInput: unknown): string {
    return createHash('sha256').update(JSON.stringify(fingerprintInput)).digest('hex');
}

function isObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

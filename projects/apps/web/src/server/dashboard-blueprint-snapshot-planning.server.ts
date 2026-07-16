import '@tanstack/react-start/server-only';

import { BLUEPRINT_SNAPSHOT_LIMITS, isBlueprintSnapshotJsonWithinByteLimit } from '@neonflux/blueprint';

import type { DashboardBotGuildStructureReadError } from './bot-internal-api-client.server.js';
import {
    DashboardBlueprintAmbiguousIdentityError,
    diffDashboardBlueprintSnapshot,
    normalizeDashboardBlueprintSnapshot,
} from './dashboard-blueprint-diff.js';
import type { DashboardBlueprintPlan, DashboardBlueprintSnapshot } from './dashboard-blueprint-diff.js';
import type { DashboardBlueprintPolicy } from './dashboard-blueprint-contracts.js';
import type { DashboardBlueprintRoleMappingConflict } from './dashboard-blueprint-model.js';

export function mapBotStructureReadError(
    error: DashboardBotGuildStructureReadError
): { type: 'bot-token-missing' } | { type: 'structure-read-failed' } {
    return error === 'not-configured' ? { type: 'bot-token-missing' } : { type: 'structure-read-failed' };
}

export function parseDashboardBlueprintSnapshot(
    backupJson: string
): { type: 'valid'; snapshot: DashboardBlueprintSnapshot } | { type: 'invalid-input'; message: string } {
    if (!isBlueprintSnapshotJsonWithinByteLimit(backupJson)) {
        return {
            type: 'invalid-input',
            message: `Server blueprint JSON cannot exceed ${String(BLUEPRINT_SNAPSHOT_LIMITS.maxJsonBytes / 1024 / 1024)} MiB.`,
        };
    }
    const trimmedJson = backupJson.trim();
    if (!trimmedJson) return { type: 'invalid-input', message: 'Paste exported server blueprint JSON first.' };
    try {
        return normalizeDashboardBlueprintPayload(JSON.parse(trimmedJson) as unknown);
    } catch {
        return { type: 'invalid-input', message: 'Server blueprint JSON could not be parsed.' };
    }
}

export function normalizeDashboardBlueprintPayload(
    payload: unknown
): { type: 'valid'; snapshot: DashboardBlueprintSnapshot } | { type: 'invalid-input'; message: string } {
    const normalized = normalizeDashboardBlueprintSnapshot(payload);
    return normalized.type === 'invalid'
        ? { type: 'invalid-input', message: normalized.message }
        : { type: 'valid', snapshot: normalized.snapshot };
}

export function tryDiffDashboardBlueprintSnapshot(
    current: DashboardBlueprintSnapshot,
    requested: DashboardBlueprintSnapshot,
    options: {
        policy: DashboardBlueprintPolicy;
        roleMappings?: Record<string, string>;
        categoryMappings?: Record<string, string>;
        channelMappings?: Record<string, string>;
    }
):
    | { type: 'valid'; plan: DashboardBlueprintPlan }
    | { type: 'invalid-input'; message: string }
    | { type: 'mapping-required'; conflicts: DashboardBlueprintRoleMappingConflict[] } {
    try {
        return { type: 'valid', plan: diffDashboardBlueprintSnapshot(current, requested, options) };
    } catch (error) {
        if (error instanceof DashboardBlueprintAmbiguousIdentityError) {
            return { type: 'mapping-required', conflicts: error.conflicts };
        }
        if (isObject(error) && error.code === 'invalid-identity-mapping' && typeof error.message === 'string') {
            return { type: 'invalid-input', message: error.message };
        }
        throw error;
    }
}

function isObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}

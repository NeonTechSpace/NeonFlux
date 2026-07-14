import '@tanstack/react-start/server-only';

import {
    FLUXER_GUILD_STRUCTURE_SNAPSHOT_LIMITS,
    isFluxerGuildStructureSnapshotJsonWithinByteLimit,
} from '@neonflux/fluxer/guild-structure-diff';

import type { DashboardBotGuildStructureReadError } from './bot-read-client.server.js';
import {
    DashboardStructureAmbiguousIdentityError,
    diffDashboardStructureSnapshot,
    normalizeDashboardStructureSnapshot,
} from './dashboard-structure-diff.js';
import type { DashboardStructurePlan, DashboardStructureSnapshot } from './dashboard-structure-diff.js';
import type { DashboardStructurePolicy } from './dashboard-structure-contracts.js';
import type { DashboardStructureRoleMappingConflict } from './dashboard-structure-model.js';

export function mapBotStructureReadError(
    error: DashboardBotGuildStructureReadError
): { type: 'bot-token-missing' } | { type: 'structure-read-failed' } {
    return error === 'not-configured' ? { type: 'bot-token-missing' } : { type: 'structure-read-failed' };
}

export function parseDashboardStructureSnapshot(
    backupJson: string
): { type: 'valid'; snapshot: DashboardStructureSnapshot } | { type: 'invalid-input'; message: string } {
    if (!isFluxerGuildStructureSnapshotJsonWithinByteLimit(backupJson)) {
        return {
            type: 'invalid-input',
            message: `Server blueprint JSON cannot exceed ${String(FLUXER_GUILD_STRUCTURE_SNAPSHOT_LIMITS.maxJsonBytes / 1024 / 1024)} MiB.`,
        };
    }
    const trimmedJson = backupJson.trim();
    if (!trimmedJson) return { type: 'invalid-input', message: 'Paste exported server blueprint JSON first.' };
    try {
        return normalizeDashboardStructurePayload(JSON.parse(trimmedJson) as unknown);
    } catch {
        return { type: 'invalid-input', message: 'Server blueprint JSON could not be parsed.' };
    }
}

export function normalizeDashboardStructurePayload(
    payload: unknown
): { type: 'valid'; snapshot: DashboardStructureSnapshot } | { type: 'invalid-input'; message: string } {
    const normalized = normalizeDashboardStructureSnapshot(payload);
    return normalized.type === 'invalid'
        ? { type: 'invalid-input', message: normalized.message }
        : { type: 'valid', snapshot: normalized.snapshot };
}

export function tryDiffDashboardStructureSnapshot(
    current: DashboardStructureSnapshot,
    requested: DashboardStructureSnapshot,
    options: {
        policy: DashboardStructurePolicy;
        roleMappings?: Record<string, string>;
        categoryMappings?: Record<string, string>;
        channelMappings?: Record<string, string>;
    }
):
    | { type: 'valid'; plan: DashboardStructurePlan }
    | { type: 'invalid-input'; message: string }
    | { type: 'mapping-required'; conflicts: DashboardStructureRoleMappingConflict[] } {
    try {
        return { type: 'valid', plan: diffDashboardStructureSnapshot(current, requested, options) };
    } catch (error) {
        if (error instanceof DashboardStructureAmbiguousIdentityError) {
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

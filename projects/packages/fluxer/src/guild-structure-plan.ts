import type { FluxerGuildStructureRoleProjection } from './guild-structure-role-projection.js';
import type { FluxerGuildStructureSnapshot } from './guild-structure-snapshot.js';

export type FluxerGuildStructurePolicy = 'merge' | 'synchronize' | 'rebuild';

export type FluxerGuildStructurePlannedAction = {
    actionType: 'create' | 'update' | 'delete';
    targetType: 'role' | 'category' | 'channel' | 'role-order' | 'channel-order';
    targetId?: string;
    label: string;
    details: Record<string, unknown>;
};

export type FluxerGuildStructureDecision = {
    targetType: 'role' | 'category' | 'channel';
    classification:
        | 'create'
        | 'update'
        | 'delete'
        | 'no-op'
        | 'unmanaged-retained'
        | 'protected-retained'
        | 'protected-omitted'
        | 'blocked-ambiguous'
        | 'blocked-unsupported';
    reason:
        | 'matched-change'
        | 'matched-equal'
        | 'source-unmatched'
        | 'target-unmatched-delete'
        | 'target-unmatched-retain'
        | 'target-protected-retain'
        | 'source-protected-omit'
        | 'rebuild-delete'
        | 'rebuild-create'
        | 'blocked-ambiguous'
        | 'blocked-unsupported';
    sourceId?: string;
    targetId?: string;
    changes?: Array<{ field: string; before: unknown; after: unknown }>;
    candidateTargetIds?: string[];
};

export type FluxerGuildStructurePlanBlocker = {
    code: 'unsupported-field-change';
    targetType: 'category' | 'channel';
    sourceId: string;
    targetId: string;
    fields: Array<'type' | 'url'>;
};

export type FluxerGuildStructurePlanFingerprintInput = {
    version: 2;
    policy: FluxerGuildStructurePolicy;
    sourceTargetMap: Record<string, string | null>;
    projectedSnapshot: FluxerGuildStructureSnapshot;
    decisions: FluxerGuildStructureDecision[];
};

export type FluxerGuildStructurePlanSummary = {
    creates: number;
    updates: number;
    deletes: number;
    roles: number;
    categories: number;
    channels: number;
};

export type FluxerGuildStructurePlan = {
    version: 2;
    policy: FluxerGuildStructurePolicy;
    summary: FluxerGuildStructurePlanSummary;
    actions: FluxerGuildStructurePlannedAction[];
    sourceTargetMap: Record<string, string | null>;
    roleProjection: FluxerGuildStructureRoleProjection;
    projectedSnapshot: FluxerGuildStructureSnapshot;
    fingerprintInput: FluxerGuildStructurePlanFingerprintInput;
    decisions: FluxerGuildStructureDecision[];
    blockers: FluxerGuildStructurePlanBlocker[];
};

export type FluxerGuildStructureFieldSummary = {
    names: number;
    permissions: number;
    positions: number;
    parentMoves: number;
    typeChanges: number;
    roleVisuals: number;
};

export type FluxerGuildStructureDiffOptions = {
    policy: FluxerGuildStructurePolicy;
    roleMappings?: Record<string, string>;
    categoryMappings?: Record<string, string>;
    channelMappings?: Record<string, string>;
};

import type { BlueprintRoleProjection } from './role-projection.js';
import type { BlueprintChannel, BlueprintPermissionOverwrite, BlueprintRole } from './contracts.js';
import type { BlueprintSnapshot } from './snapshot.js';

export const BLUEPRINT_PLAN_VERSION = 4 as const;

export type BlueprintPolicy = 'merge' | 'synchronize' | 'rebuild';

export type BlueprintProviderOperation =
    | 'create'
    | 'delete'
    | 'update'
    | 'update-metadata'
    | 'update-placement'
    | 'channel-order'
    | 'role-order'
    | 'permission-overwrite-delete'
    | 'permission-overwrite-upsert';

export type BlueprintPlanStepProviderMetadata = {
    groupId: string;
    operation: BlueprintProviderOperation;
    step: number;
    stepCount: number;
};

type BlueprintPlanStepBase = {
    targetId: string;
    label: string;
};

type BlueprintPlanStepDetailsBase = {
    label: string;
    provider?: BlueprintPlanStepProviderMetadata;
    mutationSteps?: 1;
};

type BlueprintFieldChange<TField extends string, TValue> = {
    field: TField;
    before?: TValue;
    after: TValue;
};

export type BlueprintRoleChange =
    | BlueprintFieldChange<'name', string>
    | BlueprintFieldChange<'color', number>
    | BlueprintFieldChange<'permissions', string>
    | BlueprintFieldChange<'hoist', boolean>
    | BlueprintFieldChange<'mentionable', boolean>;

export type BlueprintChannelChange =
    | BlueprintFieldChange<'name', string | null>
    | BlueprintFieldChange<'parentId', string | null>
    | BlueprintFieldChange<'position', number | null>
    | BlueprintFieldChange<'permissionOverwrites', BlueprintPermissionOverwrite[]>;

export type BlueprintRoleOrderEntry = {
    sourceId: string;
    position: number;
    hierarchyRank?: number;
};

export type BlueprintChannelOrderEntry = {
    sourceId: string;
    parentSourceId: string | null;
    position: number;
};

type BlueprintCreateStep<TTarget extends 'role' | 'category' | 'channel', TEntity> = BlueprintPlanStepBase & {
    actionType: 'create';
    targetType: TTarget;
    details: BlueprintPlanStepDetailsBase & { after: TEntity };
};

type BlueprintUpdateStep<
    TTarget extends 'role' | 'category' | 'channel',
    TChange,
    TExtra extends object = object,
> = BlueprintPlanStepBase & {
    actionType: 'update';
    targetType: TTarget;
    details: BlueprintPlanStepDetailsBase & TExtra & { changes: TChange[] };
};

type BlueprintDeleteStep<TTarget extends 'role' | 'category' | 'channel', TEntity> = BlueprintPlanStepBase & {
    actionType: 'delete';
    targetType: TTarget;
    details: BlueprintPlanStepDetailsBase & { before: TEntity };
};

export type BlueprintRolePlanStep =
    | BlueprintCreateStep<'role', BlueprintRole>
    | BlueprintUpdateStep<'role', BlueprintRoleChange, { sourceId?: string }>
    | BlueprintDeleteStep<'role', BlueprintRole>;

export type BlueprintCategoryPlanStep =
    | BlueprintCreateStep<'category', BlueprintChannel>
    | BlueprintUpdateStep<'category', BlueprintChannelChange>
    | BlueprintDeleteStep<'category', BlueprintChannel>;

export type BlueprintChannelPlanStep =
    | BlueprintCreateStep<'channel', BlueprintChannel>
    | BlueprintUpdateStep<'channel', BlueprintChannelChange>
    | BlueprintDeleteStep<'channel', BlueprintChannel>;

export type BlueprintRoleOrderPlanStep = BlueprintPlanStepBase & {
    actionType: 'update';
    targetType: 'role-order';
    details: BlueprintPlanStepDetailsBase & {
        after: BlueprintRoleOrderEntry[];
        changes: Array<BlueprintFieldChange<'roleOrder', BlueprintRoleOrderEntry[]>>;
    };
};

export type BlueprintChannelOrderPlanStep = BlueprintPlanStepBase & {
    actionType: 'update';
    targetType: 'channel-order';
    details: BlueprintPlanStepDetailsBase & {
        before: BlueprintChannelOrderEntry[];
        after: BlueprintChannelOrderEntry[];
        changes: Array<BlueprintFieldChange<'channelOrder', BlueprintChannelOrderEntry[]>>;
    };
};

export type BlueprintPlanStep =
    | BlueprintRolePlanStep
    | BlueprintCategoryPlanStep
    | BlueprintChannelPlanStep
    | BlueprintRoleOrderPlanStep
    | BlueprintChannelOrderPlanStep;

export type BlueprintPlanDecision = {
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

export type BlueprintPlanBlocker = {
    code: 'unsupported-field-change';
    targetType: 'category' | 'channel';
    sourceId: string;
    targetId: string;
    fields: Array<'type' | 'url'>;
};

export type BlueprintEntityKind = 'role' | 'category' | 'channel';

export type BlueprintPlanMappings = {
    roles: Record<string, string>;
    categories: Record<string, string>;
    channels: Record<string, string>;
};

export type BlueprintPlanSummary = {
    creates: number;
    updates: number;
    deletes: number;
    roles: number;
    categories: number;
    channels: number;
};

export type BlueprintPlanDecisionSummary = {
    noOp: number;
    create: number;
    update: number;
    delete: number;
    protectedRetained: number;
    protectedOmitted: number;
    unmanagedRetained: number;
    blockedAmbiguous: number;
    blockedUnsupported: number;
};

export type BlueprintPlan = {
    version: typeof BLUEPRINT_PLAN_VERSION;
    policy: BlueprintPolicy;
    summary: BlueprintPlanSummary;
    changes: BlueprintPlanStep[];
    steps: BlueprintPlanStep[];
    knownTargetKinds: Record<string, BlueprintEntityKind>;
    sourceTargetMap: Record<string, string | null>;
    mappings: BlueprintPlanMappings;
    roleProjection: BlueprintRoleProjection;
    projectedSnapshot: BlueprintSnapshot;
    decisions: BlueprintPlanDecision[];
    blockers: BlueprintPlanBlocker[];
};

export type BlueprintFieldSummary = {
    names: number;
    permissions: number;
    positions: number;
    parentMoves: number;
    typeChanges: number;
    roleVisuals: number;
};

export type BlueprintDiffOptions = {
    policy: BlueprintPolicy;
    roleMappings?: Record<string, string>;
    categoryMappings?: Record<string, string>;
    channelMappings?: Record<string, string>;
};

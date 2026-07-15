import type {
    BlueprintProviderOperation,
    BlueprintPlan,
    BlueprintPlanBlocker,
    BlueprintPlanDecision,
    BlueprintPlanMappings,
    BlueprintPlanStep,
    BlueprintPlanSummary,
    BlueprintPolicy,
} from './plan.js';
import { summarizeBlueprintPlanChanges } from './plan-summary.js';
import {
    hasOnlyKeys,
    isBlueprintChannelChanges,
    isBlueprintOrderChanges,
    isBlueprintPlanChannel,
    isBlueprintPlanRole,
    isBlueprintRoleChanges,
    normalizeBlueprintChannelOrderEntries,
    normalizeBlueprintRoleOrderEntries,
} from './plan-step-payload.js';
import { normalizeBlueprintSnapshot } from './snapshot.js';

export type BlueprintContractResult<T> = { type: 'valid'; value: T } | { type: 'invalid'; message: string };

const maximumLedgerEntries = 10_000;
const policies = new Set<BlueprintPolicy>(['merge', 'synchronize', 'rebuild']);
const entityKinds = new Set(['role', 'category', 'channel']);
const decisionClassifications = new Set([
    'create',
    'update',
    'delete',
    'no-op',
    'unmanaged-retained',
    'protected-retained',
    'protected-omitted',
    'blocked-ambiguous',
    'blocked-unsupported',
]);
const decisionReasons = new Set([
    'matched-change',
    'matched-equal',
    'source-unmatched',
    'target-unmatched-delete',
    'target-unmatched-retain',
    'target-protected-retain',
    'source-protected-omit',
    'rebuild-delete',
    'rebuild-create',
    'blocked-ambiguous',
    'blocked-unsupported',
]);
const channelUpdateOperations: BlueprintProviderOperation[] = [
    'update',
    'update-metadata',
    'update-placement',
    'permission-overwrite-delete',
    'permission-overwrite-upsert',
];

export function normalizeBlueprintPlanStep(value: unknown): BlueprintContractResult<BlueprintPlanStep> {
    if (!isRecord(value)) return invalid('Blueprint plan step must be an object.');
    if (!hasOnlyKeys(value, ['actionType', 'targetType', 'targetId', 'label', 'details'])) {
        return invalid('Blueprint plan step contains unsupported fields.');
    }
    if (!isText(value.label) || !isRecord(value.details)) {
        return invalid('Blueprint plan step requires a label and details object.');
    }
    if (!isText(value.targetId)) {
        return invalid('Blueprint plan step targetId must be a non-empty string.');
    }
    const targetType = value.targetType;
    const actionType = value.actionType;
    if (typeof targetType !== 'string' || typeof actionType !== 'string') {
        return invalid('Blueprint plan step has an unsupported actionType and targetType combination.');
    }
    if (value.details.label !== value.label) {
        return invalid('Blueprint plan step requires stable identity and a matching details label.');
    }

    const variant = `${targetType}:${actionType}`;
    switch (variant) {
        case 'role:create':
            return normalizeCreateStep(value, 'role', isBlueprintPlanRole, ['create']);
        case 'category:create':
            return normalizeCreateStep(value, 'category', (entry) => isBlueprintPlanChannel(entry, 'category'), [
                'create',
            ]);
        case 'channel:create':
            return normalizeCreateStep(value, 'channel', (entry) => isBlueprintPlanChannel(entry, 'channel'), [
                'create',
            ]);
        case 'role:update':
            return normalizeUpdateStep(value, 'role', isBlueprintRoleChanges, ['update'], true);
        case 'category:update':
            return normalizeUpdateStep(value, 'category', isBlueprintChannelChanges, channelUpdateOperations);
        case 'channel:update':
            return normalizeUpdateStep(value, 'channel', isBlueprintChannelChanges, channelUpdateOperations);
        case 'role:delete':
            return normalizeDeleteStep(value, 'role', isBlueprintPlanRole, ['delete']);
        case 'category:delete':
            return normalizeDeleteStep(value, 'category', (entry) => isBlueprintPlanChannel(entry, 'category'), [
                'delete',
            ]);
        case 'channel:delete':
            return normalizeDeleteStep(value, 'channel', (entry) => isBlueprintPlanChannel(entry, 'channel'), [
                'delete',
            ]);
        case 'role-order:update':
            return normalizeRoleOrderStep(value);
        case 'channel-order:update':
            return normalizeChannelOrderStep(value);
        default:
            return invalid('Blueprint plan step has an unsupported actionType and targetType combination.');
    }
}

function normalizeCreateStep(
    value: Record<string, unknown>,
    targetType: 'role' | 'category' | 'channel',
    normalizeEntity: (entry: unknown) => boolean,
    operations: readonly BlueprintProviderOperation[]
): BlueprintContractResult<BlueprintPlanStep> {
    const details = value.details as Record<string, unknown>;
    const metadataError = validateStepDetails(details, ['label', 'after', 'provider', 'mutationSteps'], operations);
    if (metadataError) return invalid(metadataError);
    if (!normalizeEntity(details.after)) {
        return invalid(`Blueprint ${targetType} create step requires a valid ${targetType} after snapshot.`);
    }
    return { type: 'valid', value: value as BlueprintPlanStep };
}

function normalizeDeleteStep(
    value: Record<string, unknown>,
    targetType: 'role' | 'category' | 'channel',
    normalizeEntity: (entry: unknown) => boolean,
    operations: readonly BlueprintProviderOperation[]
): BlueprintContractResult<BlueprintPlanStep> {
    const details = value.details as Record<string, unknown>;
    const metadataError = validateStepDetails(details, ['label', 'before', 'provider', 'mutationSteps'], operations);
    if (metadataError) return invalid(metadataError);
    if (!normalizeEntity(details.before)) {
        return invalid(`Blueprint ${targetType} delete step requires a valid ${targetType} before snapshot.`);
    }
    return { type: 'valid', value: value as BlueprintPlanStep };
}

function normalizeUpdateStep(
    value: Record<string, unknown>,
    targetType: 'role' | 'category' | 'channel',
    normalizeChanges: (entry: unknown) => boolean,
    operations: readonly BlueprintProviderOperation[],
    allowSourceId = false
): BlueprintContractResult<BlueprintPlanStep> {
    const details = value.details as Record<string, unknown>;
    const allowedKeys = ['label', 'changes', 'provider', 'mutationSteps', ...(allowSourceId ? ['sourceId'] : [])];
    const metadataError = validateStepDetails(details, allowedKeys, operations);
    if (metadataError) return invalid(metadataError);
    if (!normalizeChanges(details.changes)) {
        return invalid(`Blueprint ${targetType} update step requires non-empty target-specific field changes.`);
    }
    if (details.sourceId !== undefined && !isText(details.sourceId)) {
        return invalid('Blueprint role update step sourceId must be a non-empty string when present.');
    }
    return { type: 'valid', value: value as BlueprintPlanStep };
}

function normalizeRoleOrderStep(value: Record<string, unknown>): BlueprintContractResult<BlueprintPlanStep> {
    if (value.targetId !== 'role-order') return invalid('Blueprint role ordering step requires stable identity.');
    const details = value.details as Record<string, unknown>;
    const metadataError = validateStepDetails(
        details,
        ['label', 'after', 'changes', 'provider', 'mutationSteps'],
        ['role-order']
    );
    if (metadataError) return invalid(metadataError);
    const after = normalizeBlueprintRoleOrderEntries(details.after, false);
    if (!after || !isBlueprintOrderChanges(details.changes, 'roleOrder', after, normalizeBlueprintRoleOrderEntries)) {
        return invalid('Blueprint role ordering step requires a non-empty typed role order projection.');
    }
    return { type: 'valid', value: value as BlueprintPlanStep };
}

function normalizeChannelOrderStep(value: Record<string, unknown>): BlueprintContractResult<BlueprintPlanStep> {
    if (value.targetId !== 'channel-order') return invalid('Blueprint channel ordering step requires stable identity.');
    const details = value.details as Record<string, unknown>;
    const metadataError = validateStepDetails(
        details,
        ['label', 'before', 'after', 'changes', 'provider', 'mutationSteps'],
        ['channel-order']
    );
    if (metadataError) return invalid(metadataError);
    const before = normalizeBlueprintChannelOrderEntries(details.before, true);
    const after = normalizeBlueprintChannelOrderEntries(details.after, false);
    if (
        !before ||
        !after ||
        !isBlueprintOrderChanges(details.changes, 'channelOrder', after, normalizeBlueprintChannelOrderEntries, before)
    ) {
        return invalid('Blueprint channel ordering step requires typed before and non-empty after projections.');
    }
    return { type: 'valid', value: value as BlueprintPlanStep };
}

function validateStepDetails(
    details: Record<string, unknown>,
    allowedKeys: readonly string[],
    operations: readonly BlueprintProviderOperation[]
): string | undefined {
    if (!hasOnlyKeys(details, allowedKeys)) return 'Blueprint plan step details contain unsupported fields.';
    const hasProvider = details.provider !== undefined;
    const hasMutationSteps = details.mutationSteps !== undefined;
    if (hasProvider !== hasMutationSteps || (hasMutationSteps && details.mutationSteps !== 1)) {
        return 'Blueprint provider-step mutation metadata is malformed.';
    }
    if (hasProvider && !isProviderMetadata(details.provider, operations)) {
        return 'Blueprint provider-step metadata does not match the plan-step variant.';
    }
    return undefined;
}

export function normalizeBlueprintPlanDecision(value: unknown): BlueprintContractResult<BlueprintPlanDecision> {
    if (!isRecord(value)) return invalid('Blueprint plan decision must be an object.');
    if (
        !hasOnlyKeys(value, [
            'targetType',
            'classification',
            'reason',
            'sourceId',
            'targetId',
            'changes',
            'candidateTargetIds',
        ])
    ) {
        return invalid('Blueprint plan decision contains unsupported fields.');
    }
    if (typeof value.targetType !== 'string' || !entityKinds.has(value.targetType)) {
        return invalid('Blueprint plan decision has an invalid targetType.');
    }
    if (typeof value.classification !== 'string' || !decisionClassifications.has(value.classification)) {
        return invalid('Blueprint plan decision has an invalid classification.');
    }
    if (typeof value.reason !== 'string' || !decisionReasons.has(value.reason)) {
        return invalid('Blueprint plan decision has an invalid reason.');
    }
    for (const field of ['sourceId', 'targetId'] as const) {
        if (value[field] !== undefined && !isText(value[field])) {
            return invalid(`Blueprint plan decision ${field} must be a non-empty string when present.`);
        }
    }
    if (value.candidateTargetIds !== undefined && !isTextArray(value.candidateTargetIds)) {
        return invalid('Blueprint plan decision candidateTargetIds must contain non-empty strings.');
    }
    if (
        value.changes !== undefined &&
        (!Array.isArray(value.changes) ||
            value.changes.some((change) => !isRecord(change) || !isText(change.field) || !('after' in change)))
    ) {
        return invalid('Blueprint plan decision changes are malformed.');
    }

    return { type: 'valid', value: value as BlueprintPlanDecision };
}

export function normalizeBlueprintPlan(value: unknown): BlueprintContractResult<BlueprintPlan> {
    if (
        !isRecord(value) ||
        !hasOnlyKeys(value, [
            'version',
            'policy',
            'summary',
            'changes',
            'steps',
            'knownTargetKinds',
            'sourceTargetMap',
            'mappings',
            'roleProjection',
            'projectedSnapshot',
            'decisions',
            'blockers',
        ]) ||
        value.version !== 4 ||
        !policies.has(value.policy as BlueprintPolicy)
    ) {
        return invalid('Blueprint plan must use a supported version and policy.');
    }
    const summary = normalizeSummary(value.summary);
    if (!summary) return invalid('Blueprint plan summary is malformed.');
    const changes = normalizeLedger(value.changes, normalizeBlueprintPlanStep, 'changes');
    if (changes.type === 'invalid') return changes;
    if (!samePlanSummary(summary, summarizeBlueprintPlanChanges(changes.value))) {
        return invalid('Blueprint plan summary does not match its logical changes.');
    }
    const steps = normalizeLedger(value.steps, normalizeBlueprintPlanStep, 'steps');
    if (steps.type === 'invalid') return steps;
    const decisions = normalizeLedger(value.decisions, normalizeBlueprintPlanDecision, 'decisions');
    if (decisions.type === 'invalid') return decisions;
    const projectedSnapshot = normalizeBlueprintSnapshot(value.projectedSnapshot);
    if (projectedSnapshot.type === 'invalid') return invalid(projectedSnapshot.message);
    if (!isRecord(value.roleProjection) || !isStringMap(value.sourceTargetMap, true)) {
        return invalid('Blueprint plan identity projection is malformed.');
    }
    if (!isKnownTargetKindMap(value.knownTargetKinds)) {
        return invalid('Blueprint plan known-target authority is malformed.');
    }
    const mappings = normalizePlanMappings(value.mappings);
    if (!mappings) return invalid('Blueprint plan mappings are malformed.');
    const blockers = normalizeBlockers(value.blockers);
    if (!blockers) return invalid('Blueprint plan blockers are malformed.');

    return {
        type: 'valid',
        value: {
            ...(value as BlueprintPlan),
            summary,
            changes: changes.value,
            steps: steps.value,
            decisions: decisions.value,
            blockers,
            mappings,
            projectedSnapshot: projectedSnapshot.snapshot,
        },
    };
}

function normalizeLedger<T>(
    value: unknown,
    normalize: (entry: unknown) => BlueprintContractResult<T>,
    label: string
): BlueprintContractResult<T[]> {
    if (!Array.isArray(value) || value.length > maximumLedgerEntries) {
        return invalid(`Blueprint plan ${label} must be a bounded array.`);
    }
    const entries: T[] = [];
    for (const entry of value) {
        const result = normalize(entry);
        if (result.type === 'invalid') return result;
        entries.push(result.value);
    }
    return { type: 'valid', value: entries };
}

function normalizeSummary(value: unknown): BlueprintPlanSummary | undefined {
    if (!isRecord(value)) return undefined;
    const fields = ['creates', 'updates', 'deletes', 'roles', 'categories', 'channels'] as const;
    if (!hasOnlyKeys(value, fields)) return undefined;
    if (fields.some((field) => !isCount(value[field]))) return undefined;
    return Object.fromEntries(fields.map((field) => [field, value[field]])) as BlueprintPlanSummary;
}

function samePlanSummary(left: BlueprintPlanSummary, right: BlueprintPlanSummary): boolean {
    return (
        left.creates === right.creates &&
        left.updates === right.updates &&
        left.deletes === right.deletes &&
        left.roles === right.roles &&
        left.categories === right.categories &&
        left.channels === right.channels
    );
}

function normalizePlanMappings(value: unknown): BlueprintPlanMappings | undefined {
    if (!isRecord(value) || !hasOnlyKeys(value, ['roles', 'categories', 'channels'])) return undefined;
    if (
        !isStringMap(value.roles, false) ||
        !isStringMap(value.categories, false) ||
        !isStringMap(value.channels, false)
    ) {
        return undefined;
    }
    return {
        roles: value.roles as Record<string, string>,
        categories: value.categories as Record<string, string>,
        channels: value.channels as Record<string, string>,
    };
}

function normalizeBlockers(value: unknown): BlueprintPlanBlocker[] | undefined {
    if (!Array.isArray(value) || value.length > maximumLedgerEntries) return undefined;
    if (
        value.some(
            (entry) =>
                !isRecord(entry) ||
                entry.code !== 'unsupported-field-change' ||
                (entry.targetType !== 'category' && entry.targetType !== 'channel') ||
                !isText(entry.sourceId) ||
                !isText(entry.targetId) ||
                !Array.isArray(entry.fields) ||
                entry.fields.some((field) => field !== 'type' && field !== 'url')
        )
    ) {
        return undefined;
    }
    return value as BlueprintPlanBlocker[];
}

function isKnownTargetKindMap(value: unknown): value is Record<string, 'role' | 'category' | 'channel'> {
    return isRecord(value) && Object.values(value).every((kind) => typeof kind === 'string' && entityKinds.has(kind));
}

function isStringMap(value: unknown, allowNull: boolean): value is Record<string, string | null> {
    return (
        isRecord(value) &&
        Object.entries(value).every(([key, entry]) => isText(key) && (isText(entry) || (allowNull && entry === null)))
    );
}

function isTextArray(value: unknown): value is string[] {
    return Array.isArray(value) && value.length <= maximumLedgerEntries && value.every(isText);
}

function isProviderMetadata(value: unknown, operations: readonly BlueprintProviderOperation[]): boolean {
    if (
        !isRecord(value) ||
        !hasOnlyKeys(value, ['groupId', 'operation', 'step', 'stepCount']) ||
        !isText(value.groupId)
    ) {
        return false;
    }
    return (
        typeof value.operation === 'string' &&
        operations.includes(value.operation as BlueprintProviderOperation) &&
        isPositiveInteger(value.step) &&
        isPositiveInteger(value.stepCount) &&
        value.step <= value.stepCount
    );
}

function isCount(value: unknown): value is number {
    return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function isPositiveInteger(value: unknown): value is number {
    return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function isText(value: unknown): value is string {
    return typeof value === 'string' && value.trim().length > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function invalid<T>(message: string): BlueprintContractResult<T> {
    return { type: 'invalid', message };
}

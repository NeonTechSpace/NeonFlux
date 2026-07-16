import type { DashboardBlueprintSnapshot } from './dashboard-blueprint-diff.js';
import {
    findCurrentItem,
    isProtectedRoleTarget,
    readRoleHierarchyBlock,
    readStructureField,
    toPreflightPlanStep,
} from './dashboard-blueprint-preflight-internal.js';
import type {
    DashboardBlueprintPreflightContext,
    DashboardBlueprintPreflightInputPlanStep,
    DashboardBlueprintPreflightPlanStep,
    DashboardBlueprintTargetType,
} from './dashboard-blueprint-preflight-internal.js';
import {
    validateLayoutChanges,
    validatePermissionOverwriteChanges,
} from './dashboard-blueprint-preflight-validation.js';
import { isObject, stableValueKey } from './dashboard-blueprint-preflight-utils.js';

const supportedUpdateFields = new Map<DashboardBlueprintTargetType, ReadonlySet<string>>([
    ['role', new Set(['name', 'position', 'permissions', 'color', 'hoist', 'mentionable'])],
    ['category', new Set(['name', 'position', 'permissionOverwrites'])],
    ['channel', new Set(['name', 'parentId', 'position', 'permissionOverwrites'])],
]);
export function preflightDeleteAction(
    current: DashboardBlueprintSnapshot,
    action: DashboardBlueprintPreflightInputPlanStep,
    targetType: DashboardBlueprintTargetType,
    options: DashboardBlueprintPreflightContext
): DashboardBlueprintPreflightPlanStep {
    const currentItem = findCurrentItem(current, targetType, action.targetId);

    if (!currentItem) {
        return toPreflightPlanStep(action, 'stale', 'The target no longer exists in the current server layout.');
    }

    if (targetType === 'role' && isProtectedRoleTarget(currentItem, current.guildId)) {
        return toPreflightPlanStep(
            action,
            'unsupported',
            'Protected bot, integration, and default roles cannot be deleted.'
        );
    }

    const deleteHierarchyBlock =
        targetType === 'role' ? readRoleHierarchyBlock(currentItem, current.botHighestRolePosition) : undefined;
    if (deleteHierarchyBlock) {
        return toPreflightPlanStep(
            action,
            'unsupported',
            deleteHierarchyBlock === 'ambiguous'
                ? 'role-hierarchy-ambiguous: the bot and target role share a provider position, so authority cannot be proven.'
                : deleteHierarchyBlock === 'unavailable'
                  ? 'role-hierarchy-ambiguous: provider hierarchy authority is unavailable.'
                  : 'The bot role must be above this role before it can be deleted.'
        );
    }

    if (stableValueKey(currentItem) !== stableValueKey(action.details.before)) {
        return toPreflightPlanStep(action, 'stale', 'The target changed after the plan was created.');
    }

    if (options.allowDestructiveDeletes) {
        return toPreflightPlanStep(action, 'ready', 'The target can be deleted after destructive approval.');
    }

    return toPreflightPlanStep(action, 'destructive-approval-required', 'Delete actions require destructive approval.');
}

export function preflightUpdateAction(
    current: DashboardBlueprintSnapshot,
    action: DashboardBlueprintPreflightInputPlanStep,
    targetType: DashboardBlueprintTargetType,
    actions: DashboardBlueprintPreflightInputPlanStep[],
    options: DashboardBlueprintPreflightContext
): DashboardBlueprintPreflightPlanStep {
    const targetId = action.targetId;

    if (!targetId) {
        return toPreflightPlanStep(action, 'invalid-plan', 'The update action is missing a target.');
    }

    const changes = normalizeChanges(action.details.changes);

    if (!changes) {
        return toPreflightPlanStep(action, 'invalid-plan', 'The update action does not contain valid field changes.');
    }
    if (
        targetType === 'role' &&
        targetId === current.guildId &&
        changes.some((change) => change.field === 'position')
    ) {
        return toPreflightPlanStep(action, 'invalid-plan', 'The @everyone role cannot be moved.');
    }

    const currentItem = findCurrentItem(current, targetType, targetId);
    const followsPlannedCreate = isPlannedCreateFollowupUpdate(action, actions, targetType);

    if (!currentItem && !followsPlannedCreate) {
        return toPreflightPlanStep(action, 'stale', 'The target no longer exists in the current server layout.');
    }

    if (currentItem && !followsPlannedCreate) {
        if (targetType === 'role' && isProtectedRoleTarget(currentItem, current.guildId)) {
            return toPreflightPlanStep(
                action,
                'unsupported',
                'Protected bot, integration, and default roles cannot be updated.'
            );
        }

        const updateHierarchyBlock =
            targetType === 'role' ? readRoleHierarchyBlock(currentItem, current.botHighestRolePosition) : undefined;
        if (updateHierarchyBlock) {
            return toPreflightPlanStep(
                action,
                'unsupported',
                updateHierarchyBlock === 'ambiguous'
                    ? 'role-hierarchy-ambiguous: the bot and target role share a provider position, so authority cannot be proven.'
                    : updateHierarchyBlock === 'unavailable'
                      ? 'role-hierarchy-ambiguous: provider hierarchy authority is unavailable.'
                      : 'The bot role must be above this role before it can be updated.'
            );
        }

        const staleField = changes.find(
            (change) => stableValueKey(readStructureField(currentItem, change.field)) !== stableValueKey(change.before)
        );

        if (staleField) {
            return toPreflightPlanStep(
                action,
                'stale',
                `Field ${staleField.field} changed after the plan was created.`
            );
        }
    }

    const supportedFields = supportedUpdateFields.get(targetType) ?? new Set<string>();
    const unsupportedField = changes.find((change) => !supportedFields.has(String(change.field)));

    if (unsupportedField) {
        return toPreflightPlanStep(
            action,
            'unsupported',
            `Field ${unsupportedField.field} is not supported by the current Fluxer structure mutation wrappers.`
        );
    }

    const overwriteValidation = validatePermissionOverwriteChanges(current, actions, changes, options);

    if (overwriteValidation) {
        return toPreflightPlanStep(action, overwriteValidation.status, overwriteValidation.message);
    }

    const layoutValidation = validateLayoutChanges(current, actions, targetType, targetId, changes, options);

    if (layoutValidation) {
        return toPreflightPlanStep(action, layoutValidation.status, layoutValidation.message);
    }

    return toPreflightPlanStep(
        action,
        'ready',
        followsPlannedCreate
            ? 'The update follows its reviewed create step.'
            : 'The target still matches the reviewed plan baseline.'
    );
}

function isPlannedCreateFollowupUpdate(
    action: DashboardBlueprintPreflightInputPlanStep,
    actions: DashboardBlueprintPreflightInputPlanStep[],
    targetType: DashboardBlueprintTargetType
): boolean {
    const actionIndex = actions.indexOf(action);
    const providerMetadata = readProviderStep(action);
    if (
        actionIndex <= 0 ||
        action.actionType !== 'update' ||
        providerMetadata?.operation !== 'permission-overwrite-upsert' ||
        providerMetadata.step <= 1
    ) {
        return false;
    }

    return actions.slice(0, actionIndex).some((candidate) => {
        const candidateProviderStep = readProviderStep(candidate);
        return (
            candidate.actionType === 'create' &&
            candidate.targetType === targetType &&
            candidate.targetId === action.targetId &&
            candidateProviderStep?.operation === 'create' &&
            candidateProviderStep.groupId === providerMetadata.groupId &&
            candidateProviderStep.step === 1 &&
            candidateProviderStep.stepCount === providerMetadata.stepCount
        );
    });
}

function readProviderStep(action: DashboardBlueprintPreflightInputPlanStep):
    | {
          groupId: string;
          operation: string;
          step: number;
          stepCount: number;
      }
    | undefined {
    const providerMetadata = action.details.provider;
    if (
        !isObject(providerMetadata) ||
        typeof providerMetadata.groupId !== 'string' ||
        !providerMetadata.groupId ||
        typeof providerMetadata.operation !== 'string' ||
        !providerMetadata.operation ||
        !Number.isInteger(providerMetadata.step) ||
        !Number.isInteger(providerMetadata.stepCount) ||
        (providerMetadata.step as number) < 1 ||
        (providerMetadata.stepCount as number) < (providerMetadata.step as number)
    ) {
        return undefined;
    }

    return {
        groupId: providerMetadata.groupId,
        operation: providerMetadata.operation,
        step: providerMetadata.step as number,
        stepCount: providerMetadata.stepCount as number,
    };
}

function normalizeChanges(value: unknown): Array<{ field: string; before: unknown; after: unknown }> | undefined {
    if (!Array.isArray(value)) return undefined;

    const changes: Array<{ field: string; before: unknown; after: unknown }> = [];

    for (const change of value) {
        if (!isObject(change) || typeof change.field !== 'string') return undefined;

        changes.push({
            field: change.field,
            before: change.before,
            after: change.after,
        });
    }

    return changes;
}

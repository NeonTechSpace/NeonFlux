import type { DashboardBlueprintSnapshot } from './dashboard-blueprint-diff.js';
import {
    isCanonicalReferenceId,
    isValidPosition,
    resolveStructureReference,
} from './dashboard-blueprint-preflight-internal.js';
import type {
    DashboardBlueprintPreflightChange,
    DashboardBlueprintPreflightContext,
    DashboardBlueprintPreflightInputPlanStep,
    DashboardBlueprintTargetType,
} from './dashboard-blueprint-preflight-internal.js';
import { isObject } from './dashboard-blueprint-preflight-utils.js';

export type DashboardBlueprintPermissionOverwrite = {
    id: string;
    type: 0 | 1;
    allow: string;
    deny: string;
};

export function validatePermissionOverwriteChanges(
    current: DashboardBlueprintSnapshot,
    actions: DashboardBlueprintPreflightInputPlanStep[],
    changes: DashboardBlueprintPreflightChange[],
    options: DashboardBlueprintPreflightContext
): { status: 'mapping-required' | 'invalid-plan'; message: string } | undefined {
    for (const change of changes) {
        if (change.field !== 'permissionOverwrites') continue;

        const before = normalizePermissionOverwrites(change.before);
        const after = normalizePermissionOverwrites(change.after);

        if (!before || !after) {
            return {
                status: 'invalid-plan',
                message: 'The permission overwrite update contains invalid overwrite data.',
            };
        }

        const targetValidation = validatePermissionOverwriteTargets(current, actions, after, options);

        if (targetValidation) return targetValidation;
    }

    return undefined;
}

export function validatePermissionOverwriteTargets(
    current: DashboardBlueprintSnapshot,
    actions: DashboardBlueprintPreflightInputPlanStep[],
    overwrites: readonly DashboardBlueprintPermissionOverwrite[],
    options: DashboardBlueprintPreflightContext
): { status: 'mapping-required' | 'invalid-plan'; message: string } | undefined {
    const duplicateKey = findDuplicateOverwriteKey(overwrites);

    if (duplicateKey) {
        return {
            status: 'invalid-plan',
            message: `Permission overwrite ${duplicateKey} appears more than once.`,
        };
    }

    const deletedRoleIds = new Set(
        actions
            .filter((action) => action.actionType === 'delete' && action.targetType === 'role' && action.targetId)
            .map((action) => action.targetId as string)
    );

    for (const overwrite of overwrites) {
        // Member overwrite IDs identify users, not Blueprint-managed structure objects.
        if (overwrite.type === 1) continue;

        const role = resolveStructureReference(current, actions, overwrite.id, 'role', options);
        if (role.type === 'unresolved') {
            return {
                status: 'mapping-required',
                message: 'A permission overwrite role target must exist or be created in this Blueprint plan.',
            };
        }
        if (role.type === 'planned-create') continue;

        if (deletedRoleIds.has(role.targetId)) {
            return {
                status: 'invalid-plan',
                message: 'A permission overwrite references a role that is deleted by this Blueprint plan.',
            };
        }
    }

    return undefined;
}

export function validateLayoutChanges(
    current: DashboardBlueprintSnapshot,
    actions: DashboardBlueprintPreflightInputPlanStep[],
    targetType: DashboardBlueprintTargetType,
    targetId: string,
    changes: DashboardBlueprintPreflightChange[],
    options: DashboardBlueprintPreflightContext
): { status: 'mapping-required' | 'unsupported' | 'invalid-plan'; message: string } | undefined {
    for (const change of changes) {
        if (change.field === 'position' && !isValidPosition(change.after)) {
            return { status: 'invalid-plan', message: 'The position update must be a non-negative integer.' };
        }
        if (targetType === 'role' && change.field === 'position' && current.guildId === targetId) {
            return { status: 'invalid-plan', message: 'The @everyone role cannot be moved.' };
        }

        if (change.field !== 'parentId') continue;

        if (targetType === 'category') {
            return { status: 'invalid-plan', message: 'Categories cannot have parent categories.' };
        }
        if (change.after === null || change.after === undefined) continue;
        if (!isCanonicalReferenceId(change.after)) {
            return { status: 'invalid-plan', message: 'The channel parent update is invalid.' };
        }
        if (resolveStructureReference(current, actions, change.after, 'category', options).type === 'unresolved') {
            return {
                status: 'mapping-required',
                message: 'The channel parent category must exist or be created earlier in this Blueprint plan.',
            };
        }
    }

    return undefined;
}

export function normalizePermissionOverwrites(value: unknown): DashboardBlueprintPermissionOverwrite[] | undefined {
    if (!Array.isArray(value)) return undefined;

    const overwrites: DashboardBlueprintPermissionOverwrite[] = [];

    for (const overwrite of value) {
        if (
            !isObject(overwrite) ||
            !isCanonicalReferenceId(overwrite.id) ||
            (overwrite.type !== 0 && overwrite.type !== 1) ||
            typeof overwrite.allow !== 'string' ||
            typeof overwrite.deny !== 'string'
        ) {
            return undefined;
        }

        overwrites.push({
            id: overwrite.id,
            type: overwrite.type,
            allow: overwrite.allow,
            deny: overwrite.deny,
        });
    }

    return overwrites;
}

function findDuplicateOverwriteKey(overwrites: readonly DashboardBlueprintPermissionOverwrite[]): string | undefined {
    const keys = new Set<string>();

    for (const overwrite of overwrites) {
        const key = `${overwrite.type}:${overwrite.id}`;

        if (keys.has(key)) return key;
        keys.add(key);
    }

    return undefined;
}

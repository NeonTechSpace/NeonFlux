import type { FluxerGuildChannel, FluxerGuildRole } from '@neonflux/fluxer';

import type { DashboardBlueprintSnapshot } from './dashboard-blueprint-diff.js';
import {
    findCurrentItem,
    isProtectedRoleTarget,
    isSupportedChannelType,
    isValidPosition,
    readOptionalReferenceId,
    resolveStructureReference,
    toPreflightPlanStep,
} from './dashboard-blueprint-preflight-internal.js';
import type {
    DashboardBlueprintPreflightContext,
    DashboardBlueprintPreflightInputPlanStep,
    DashboardBlueprintPreflightPlanStep,
    DashboardBlueprintTargetType,
} from './dashboard-blueprint-preflight-internal.js';
import {
    normalizePermissionOverwrites,
    validatePermissionOverwriteTargets,
} from './dashboard-blueprint-preflight-validation.js';
import { isObject } from './dashboard-blueprint-preflight-utils.js';

export function preflightCreateAction(
    current: DashboardBlueprintSnapshot,
    action: DashboardBlueprintPreflightInputPlanStep,
    targetType: DashboardBlueprintTargetType,
    actions: DashboardBlueprintPreflightInputPlanStep[],
    options: DashboardBlueprintPreflightContext
): DashboardBlueprintPreflightPlanStep {
    const after = normalizeCreateTarget(action.details.after);

    if (!after) {
        return toPreflightPlanStep(action, 'invalid-plan', 'The create action does not contain a valid target.');
    }

    if (
        findCurrentItem(current, targetType, action.targetId) &&
        !isSameGuildReplaceCreate(current, action, targetType, actions, options)
    ) {
        return toPreflightPlanStep(action, 'stale', 'The create target already exists in the current server layout.');
    }

    if (targetType === 'role' && isProtectedRoleTarget(after, current.guildId)) {
        return toPreflightPlanStep(action, 'unsupported', 'Protected bot, integration, and default roles are ignored.');
    }

    const mappedTargetId = action.targetId ? options.idMap[action.targetId] : undefined;

    if (mappedTargetId) {
        return preflightMappedCreateRepairAction(current, action, targetType, actions, after, mappedTargetId, options);
    }

    if (targetType === 'role') {
        return preflightRoleCreateAction(action, after);
    }

    return preflightChannelCreateAction(current, action, targetType, actions, after, options);
}

function preflightMappedCreateRepairAction(
    current: DashboardBlueprintSnapshot,
    action: DashboardBlueprintPreflightInputPlanStep,
    targetType: DashboardBlueprintTargetType,
    actions: DashboardBlueprintPreflightInputPlanStep[],
    after: Record<string, unknown>,
    mappedTargetId: string,
    options: DashboardBlueprintPreflightContext
): DashboardBlueprintPreflightPlanStep {
    const mappedItem = findCurrentItem(current, targetType, mappedTargetId);

    if (!mappedItem) {
        return toPreflightPlanStep(
            action,
            'stale',
            'The previously created retry target no longer exists in the current server layout.'
        );
    }

    if (targetType === 'role') {
        const roleValidation = preflightRoleCreateAction(action, after);
        if (roleValidation.status !== 'ready') return roleValidation;

        const mappedRole = mappedItem as FluxerGuildRole;
        if (!isMatchingMappedRole(mappedRole, after)) {
            return toPreflightPlanStep(action, 'stale', 'The previously created retry role changed after creation.');
        }

        return toPreflightPlanStep(
            action,
            'ready',
            'The previously created role exists. Retry will reuse it instead of creating a duplicate.'
        );
    }
    const mappedChannel = mappedItem as FluxerGuildChannel;

    if (typeof after.name !== 'string' || !after.name.trim() || typeof after.type !== 'number') {
        return toPreflightPlanStep(
            action,
            'invalid-plan',
            'The mapped create repair target is missing required fields.'
        );
    }
    if (targetType === 'category' && after.type !== 4) {
        return toPreflightPlanStep(
            action,
            'invalid-plan',
            'Mapped category create repair targets must use category type 4.'
        );
    }
    if (targetType === 'channel' && after.type === 4) {
        return toPreflightPlanStep(
            action,
            'invalid-plan',
            'Mapped channel create repair targets cannot use category type 4.'
        );
    }
    if (!isSupportedChannelType(after.type)) {
        return toPreflightPlanStep(action, 'unsupported', `Channel type ${after.type} is not supported for repair.`);
    }

    const expectedParentId = readOptionalReferenceId(after.parentId);
    if (expectedParentId === undefined) {
        return toPreflightPlanStep(action, 'invalid-plan', 'The mapped create repair target has an invalid parent.');
    }
    let mappedParentId: string | null = null;
    if (expectedParentId) {
        const parent = resolveStructureReference(current, actions, expectedParentId, 'category', options, false);
        if (parent.type !== 'resolved') {
            return toPreflightPlanStep(
                action,
                'mapping-required',
                'The mapped create repair parent cannot be mapped to an existing category.'
            );
        }
        mappedParentId = parent.targetId;
    }

    if (mappedChannel.name !== after.name.trim()) {
        return toPreflightPlanStep(action, 'stale', 'The previously created retry target was renamed after creation.');
    }
    if (mappedChannel.type !== after.type) {
        return toPreflightPlanStep(action, 'stale', 'The previously created retry target changed type after creation.');
    }
    if (mappedChannel.parentId !== mappedParentId) {
        return toPreflightPlanStep(action, 'stale', 'The previously created retry target moved after creation.');
    }

    const permissionOverwrites = normalizePermissionOverwrites(after.permissionOverwrites);

    if (!permissionOverwrites) {
        return toPreflightPlanStep(
            action,
            'invalid-plan',
            'The mapped create repair target has invalid permission overwrites.'
        );
    }

    const overwriteValidation = validatePermissionOverwriteTargets(current, actions, permissionOverwrites, options);

    if (overwriteValidation) {
        return toPreflightPlanStep(action, overwriteValidation.status, overwriteValidation.message);
    }

    return toPreflightPlanStep(
        action,
        'ready',
        'The previously created item exists. Retry will repair its permission overwrites instead of creating it again.'
    );
}

function isMatchingMappedRole(role: FluxerGuildRole, after: Record<string, unknown>): boolean {
    return (
        role.name === after.name &&
        role.permissions === after.permissions &&
        role.color === after.color &&
        role.hoist === after.hoist &&
        role.mentionable === after.mentionable
    );
}

function preflightRoleCreateAction(
    action: DashboardBlueprintPreflightInputPlanStep,
    after: Record<string, unknown>
): DashboardBlueprintPreflightPlanStep {
    if (
        typeof after.name !== 'string' ||
        !after.name.trim() ||
        typeof after.permissions !== 'string' ||
        typeof after.color !== 'number' ||
        typeof after.hoist !== 'boolean' ||
        typeof after.mentionable !== 'boolean'
    ) {
        return toPreflightPlanStep(action, 'invalid-plan', 'The role create target is missing required fields.');
    }

    if (!Number.isInteger(after.color) || after.color < 0 || after.color > 0xffffff) {
        return toPreflightPlanStep(action, 'invalid-plan', 'The role create target has an invalid color.');
    }

    if (!isValidPosition(after.position)) {
        return toPreflightPlanStep(action, 'invalid-plan', 'The role create target has an invalid position.');
    }

    return toPreflightPlanStep(
        action,
        'ready',
        'The role can be created with name, position, permissions, color, hoist, and mentionable settings.'
    );
}

function preflightChannelCreateAction(
    current: DashboardBlueprintSnapshot,
    action: DashboardBlueprintPreflightInputPlanStep,
    targetType: DashboardBlueprintTargetType,
    actions: DashboardBlueprintPreflightInputPlanStep[],
    after: Record<string, unknown>,
    options: DashboardBlueprintPreflightContext
): DashboardBlueprintPreflightPlanStep {
    if (typeof after.name !== 'string' || !after.name.trim() || typeof after.type !== 'number') {
        return toPreflightPlanStep(action, 'invalid-plan', 'The channel create target is missing required fields.');
    }

    if (targetType === 'category' && after.type !== 4) {
        return toPreflightPlanStep(action, 'invalid-plan', 'Category create targets must use category type 4.');
    }

    if (targetType === 'channel' && after.type === 4) {
        return toPreflightPlanStep(action, 'invalid-plan', 'Channel create targets cannot use category type 4.');
    }

    if (!isSupportedChannelType(after.type)) {
        return toPreflightPlanStep(action, 'unsupported', `Channel type ${after.type} is not supported for create.`);
    }
    if (after.url !== undefined && after.url !== null && typeof after.url !== 'string') {
        return toPreflightPlanStep(action, 'invalid-plan', 'The channel create target has an invalid link URL.');
    }

    const permissionOverwrites = normalizePermissionOverwrites(after.permissionOverwrites);

    if (!permissionOverwrites) {
        return toPreflightPlanStep(
            action,
            'invalid-plan',
            'The channel create target has invalid permission overwrites.'
        );
    }
    if (after.position !== undefined && after.position !== null && !isValidPosition(after.position)) {
        return toPreflightPlanStep(action, 'invalid-plan', 'The channel create target has an invalid position.');
    }

    const overwriteValidation = validatePermissionOverwriteTargets(current, actions, permissionOverwrites, options);

    if (overwriteValidation) {
        return toPreflightPlanStep(action, overwriteValidation.status, overwriteValidation.message);
    }

    const parentId = readOptionalReferenceId(after.parentId);

    if (parentId === undefined) {
        return toPreflightPlanStep(action, 'invalid-plan', 'The channel create target has an invalid parent category.');
    }

    if (targetType === 'category' && parentId) {
        return toPreflightPlanStep(action, 'invalid-plan', 'Categories cannot have parent categories.');
    }

    if (parentId && resolveStructureReference(current, actions, parentId, 'category', options).type === 'unresolved') {
        return toPreflightPlanStep(
            action,
            'mapping-required',
            'The channel parent category must exist or be created earlier in this Blueprint plan.'
        );
    }

    return toPreflightPlanStep(
        action,
        'ready',
        'The item can be created with name, parent, optional position, and permission overwrites.'
    );
}

function normalizeCreateTarget(value: unknown): Record<string, unknown> | undefined {
    return isObject(value) ? value : undefined;
}

function isSameGuildReplaceCreate(
    current: DashboardBlueprintSnapshot,
    action: DashboardBlueprintPreflightInputPlanStep,
    targetType: DashboardBlueprintTargetType,
    actions: DashboardBlueprintPreflightInputPlanStep[],
    options: DashboardBlueprintPreflightContext
): boolean {
    return (
        options.policy === 'rebuild' &&
        options.sourceGuildId === current.guildId &&
        actions.some(
            (candidate) =>
                candidate.actionType === 'delete' &&
                candidate.targetType === targetType &&
                candidate.targetId === action.targetId
        )
    );
}

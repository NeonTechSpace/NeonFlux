import type { FluxerGuildChannel, FluxerGuildRole } from '@neonflux/fluxer';

import type { DashboardStructureSnapshot } from './dashboard-structure-diff.js';
import { isObject, stableValueKey } from './dashboard-structure-preflight-utils.js';

type DashboardStructurePreflightActionStatus =
    | 'ready'
    | 'stale'
    | 'mapping-required'
    | 'destructive-approval-required'
    | 'unsupported'
    | 'invalid-plan';

export type DashboardStructurePreflightInputAction = {
    id: string;
    actionType: string;
    targetType: string;
    targetId?: string;
    label?: string;
    details: Record<string, unknown>;
};

type DashboardStructurePreflightAction = {
    actionId: string;
    actionType: string;
    targetType: string;
    targetId?: string;
    label?: string;
    status: DashboardStructurePreflightActionStatus;
    message: string;
};

type DashboardStructurePreflightSummary = {
    total: number;
    ready: number;
    stale: number;
    mappingRequired: number;
    destructiveApprovalRequired: number;
    unsupported: number;
    invalidPlan: number;
};

export type DashboardStructurePreflightReport = {
    summary: DashboardStructurePreflightSummary;
    actions: DashboardStructurePreflightAction[];
};

export type DashboardStructurePreflightOptions = {
    allowDestructiveDeletes?: boolean;
    idMap?: Record<string, string>;
    sourceGuildId?: string;
};

type StructureItem = FluxerGuildRole | FluxerGuildChannel;
type TargetType = 'role' | 'category' | 'channel';

const supportedUpdateFields = new Map<TargetType, ReadonlySet<string>>([
    ['role', new Set(['name', 'position', 'permissions', 'color', 'hoist', 'mentionable'])],
    ['category', new Set(['name', 'position', 'permissionOverwrites'])],
    ['channel', new Set(['name', 'parentId', 'position', 'permissionOverwrites'])],
]);

export function preflightDashboardStructureImportPlan(
    current: DashboardStructureSnapshot,
    actions: DashboardStructurePreflightInputAction[],
    options: DashboardStructurePreflightOptions = {}
): DashboardStructurePreflightReport {
    const preflightActions = actions.map((action) => preflightAction(current, action, actions, options));

    return {
        summary: {
            total: preflightActions.length,
            ready: countStatus(preflightActions, 'ready'),
            stale: countStatus(preflightActions, 'stale'),
            mappingRequired: countStatus(preflightActions, 'mapping-required'),
            destructiveApprovalRequired: countStatus(preflightActions, 'destructive-approval-required'),
            unsupported: countStatus(preflightActions, 'unsupported'),
            invalidPlan: countStatus(preflightActions, 'invalid-plan'),
        },
        actions: preflightActions,
    };
}

function preflightAction(
    current: DashboardStructureSnapshot,
    action: DashboardStructurePreflightInputAction,
    actions: DashboardStructurePreflightInputAction[],
    options: DashboardStructurePreflightOptions
): DashboardStructurePreflightAction {
    const targetType = normalizeTargetType(action.targetType);

    if (!targetType || !action.targetId) {
        return toPreflightAction(action, 'invalid-plan', 'The dry-run action is missing a valid target.');
    }

    switch (action.actionType) {
        case 'create':
            return preflightCreateAction(current, action, targetType, actions, options);
        case 'delete':
            return preflightDeleteAction(current, action, targetType, options);
        case 'update':
            return preflightUpdateAction(current, action, targetType, actions, options);
        default:
            return toPreflightAction(action, 'invalid-plan', 'The dry-run action type is not recognized.');
    }
}

function preflightCreateAction(
    current: DashboardStructureSnapshot,
    action: DashboardStructurePreflightInputAction,
    targetType: TargetType,
    actions: DashboardStructurePreflightInputAction[],
    options: DashboardStructurePreflightOptions
): DashboardStructurePreflightAction {
    const after = normalizeCreateTarget(action.details.after);

    if (!after) {
        return toPreflightAction(action, 'invalid-plan', 'The create action does not contain a valid target.');
    }

    if (findCurrentItem(current, targetType, action.targetId)) {
        return toPreflightAction(action, 'stale', 'The create target already exists in the current server layout.');
    }

    const mappedTargetId = action.targetId ? options.idMap?.[action.targetId] : undefined;

    if (mappedTargetId) {
        return preflightMappedCreateRepairAction(current, action, targetType, actions, after, mappedTargetId, options);
    }

    if (targetType === 'role') {
        if (isProtectedRoleTarget(after, current.guildId)) {
            return toPreflightAction(
                action,
                'unsupported',
                'Protected bot, integration, and default roles are ignored.'
            );
        }

        return preflightRoleCreateAction(action, after);
    }

    return preflightChannelCreateAction(current, action, targetType, actions, after, options);
}

function preflightMappedCreateRepairAction(
    current: DashboardStructureSnapshot,
    action: DashboardStructurePreflightInputAction,
    targetType: TargetType,
    actions: DashboardStructurePreflightInputAction[],
    after: Record<string, unknown>,
    mappedTargetId: string,
    options: DashboardStructurePreflightOptions
): DashboardStructurePreflightAction {
    const mappedItem = findCurrentItem(current, targetType, mappedTargetId);

    if (!mappedItem) {
        return toPreflightAction(
            action,
            'stale',
            'The previously created retry target no longer exists in the current server layout.'
        );
    }

    if (targetType === 'role') {
        return toPreflightAction(action, 'stale', 'The mapped role already exists and cannot be created again.');
    }
    const mappedChannel = mappedItem as FluxerGuildChannel;

    if (typeof after.name !== 'string' || !after.name.trim() || typeof after.type !== 'number') {
        return toPreflightAction(action, 'invalid-plan', 'The mapped create repair target is missing required fields.');
    }
    if (targetType === 'category' && after.type !== 4) {
        return toPreflightAction(
            action,
            'invalid-plan',
            'Mapped category create repair targets must use category type 4.'
        );
    }
    if (targetType === 'channel' && after.type === 4) {
        return toPreflightAction(
            action,
            'invalid-plan',
            'Mapped channel create repair targets cannot use category type 4.'
        );
    }
    if (!isSupportedChannelType(after.type)) {
        return toPreflightAction(action, 'unsupported', `Channel type ${after.type} is not supported for repair.`);
    }

    const expectedParentId = typeof after.parentId === 'string' && after.parentId.trim() ? after.parentId.trim() : null;
    const mappedParentId = expectedParentId ? (options.idMap?.[expectedParentId] ?? expectedParentId) : null;

    if (mappedChannel.name !== after.name.trim()) {
        return toPreflightAction(action, 'stale', 'The previously created retry target was renamed after creation.');
    }
    if (mappedChannel.type !== after.type) {
        return toPreflightAction(action, 'stale', 'The previously created retry target changed type after creation.');
    }
    if (mappedChannel.parentId !== mappedParentId) {
        return toPreflightAction(action, 'stale', 'The previously created retry target moved after creation.');
    }

    const permissionOverwrites = normalizePermissionOverwrites(after.permissionOverwrites);

    if (!permissionOverwrites) {
        return toPreflightAction(
            action,
            'invalid-plan',
            'The mapped create repair target has invalid permission overwrites.'
        );
    }

    const overwriteValidation = validatePermissionOverwriteTargets(current, actions, permissionOverwrites, options);

    if (overwriteValidation) {
        return toPreflightAction(action, overwriteValidation.status, overwriteValidation.message);
    }

    return toPreflightAction(
        action,
        'ready',
        'The previously created item exists. Retry will repair its permission overwrites instead of creating it again.'
    );
}

function preflightRoleCreateAction(
    action: DashboardStructurePreflightInputAction,
    after: Record<string, unknown>
): DashboardStructurePreflightAction {
    if (
        typeof after.name !== 'string' ||
        !after.name.trim() ||
        typeof after.permissions !== 'string' ||
        typeof after.color !== 'number' ||
        typeof after.hoist !== 'boolean' ||
        typeof after.mentionable !== 'boolean'
    ) {
        return toPreflightAction(action, 'invalid-plan', 'The role create target is missing required fields.');
    }

    if (!Number.isInteger(after.color) || after.color < 0 || after.color > 0xffffff) {
        return toPreflightAction(action, 'invalid-plan', 'The role create target has an invalid color.');
    }

    if (!isValidPosition(after.position)) {
        return toPreflightAction(action, 'invalid-plan', 'The role create target has an invalid position.');
    }

    return toPreflightAction(
        action,
        'ready',
        'The role can be created with name, position, permissions, color, hoist, and mentionable settings.'
    );
}

function preflightChannelCreateAction(
    current: DashboardStructureSnapshot,
    action: DashboardStructurePreflightInputAction,
    targetType: TargetType,
    actions: DashboardStructurePreflightInputAction[],
    after: Record<string, unknown>,
    options: DashboardStructurePreflightOptions
): DashboardStructurePreflightAction {
    if (typeof after.name !== 'string' || !after.name.trim() || typeof after.type !== 'number') {
        return toPreflightAction(action, 'invalid-plan', 'The channel create target is missing required fields.');
    }

    if (targetType === 'category' && after.type !== 4) {
        return toPreflightAction(action, 'invalid-plan', 'Category create targets must use category type 4.');
    }

    if (targetType === 'channel' && after.type === 4) {
        return toPreflightAction(action, 'invalid-plan', 'Channel create targets cannot use category type 4.');
    }

    if (!isSupportedChannelType(after.type)) {
        return toPreflightAction(action, 'unsupported', `Channel type ${after.type} is not supported for create.`);
    }
    if (after.url !== undefined && after.url !== null && typeof after.url !== 'string') {
        return toPreflightAction(action, 'invalid-plan', 'The channel create target has an invalid link URL.');
    }

    const permissionOverwrites = normalizePermissionOverwrites(after.permissionOverwrites);

    if (!permissionOverwrites) {
        return toPreflightAction(
            action,
            'invalid-plan',
            'The channel create target has invalid permission overwrites.'
        );
    }
    if (after.position !== undefined && after.position !== null && !isValidPosition(after.position)) {
        return toPreflightAction(action, 'invalid-plan', 'The channel create target has an invalid position.');
    }

    const overwriteValidation = validatePermissionOverwriteTargets(current, actions, permissionOverwrites, options);

    if (overwriteValidation) {
        return toPreflightAction(action, overwriteValidation.status, overwriteValidation.message);
    }

    const parentId = typeof after.parentId === 'string' && after.parentId.trim() ? after.parentId.trim() : null;

    if (targetType === 'category' && parentId) {
        return toPreflightAction(action, 'invalid-plan', 'Categories cannot have parent categories.');
    }

    if (parentId && !isResolvableCategoryId(current, actions, parentId, options)) {
        return toPreflightAction(
            action,
            'mapping-required',
            'The channel parent category must exist or be created earlier in this import plan.'
        );
    }

    return toPreflightAction(
        action,
        'ready',
        'The item can be created with name, parent, optional position, and permission overwrites.'
    );
}

function preflightDeleteAction(
    current: DashboardStructureSnapshot,
    action: DashboardStructurePreflightInputAction,
    targetType: TargetType,
    options: DashboardStructurePreflightOptions
): DashboardStructurePreflightAction {
    const currentItem = findCurrentItem(current, targetType, action.targetId);

    if (!currentItem) {
        return toPreflightAction(action, 'stale', 'The target no longer exists in the current server layout.');
    }

    if (targetType === 'role' && isProtectedRoleTarget(currentItem, current.guildId)) {
        return toPreflightAction(
            action,
            'unsupported',
            'Protected bot, integration, and default roles cannot be deleted.'
        );
    }

    if (stableValueKey(currentItem) !== stableValueKey(action.details.before)) {
        return toPreflightAction(action, 'stale', 'The target changed after the dry-run was created.');
    }

    if (options.allowDestructiveDeletes) {
        return toPreflightAction(action, 'ready', 'The target can be deleted after destructive approval.');
    }

    return toPreflightAction(action, 'destructive-approval-required', 'Delete actions require destructive approval.');
}

function preflightUpdateAction(
    current: DashboardStructureSnapshot,
    action: DashboardStructurePreflightInputAction,
    targetType: TargetType,
    actions: DashboardStructurePreflightInputAction[],
    options: DashboardStructurePreflightOptions
): DashboardStructurePreflightAction {
    const targetId = action.targetId;

    if (!targetId) {
        return toPreflightAction(action, 'invalid-plan', 'The update action is missing a target.');
    }

    const changes = normalizeChanges(action.details.changes);

    if (!changes) {
        return toPreflightAction(action, 'invalid-plan', 'The update action does not contain valid field changes.');
    }
    if (
        targetType === 'role' &&
        targetId === current.guildId &&
        changes.some((change) => change.field === 'position')
    ) {
        return toPreflightAction(action, 'invalid-plan', 'The @everyone role cannot be moved.');
    }

    const currentItem = findCurrentItem(current, targetType, targetId);

    if (!currentItem) {
        return toPreflightAction(action, 'stale', 'The target no longer exists in the current server layout.');
    }

    if (targetType === 'role' && isProtectedRoleTarget(currentItem, current.guildId)) {
        return toPreflightAction(
            action,
            'unsupported',
            'Protected bot, integration, and default roles cannot be updated.'
        );
    }

    const staleField = changes.find(
        (change) => stableValueKey(readStructureField(currentItem, change.field)) !== stableValueKey(change.before)
    );

    if (staleField) {
        return toPreflightAction(action, 'stale', `Field ${staleField.field} changed after the dry-run was created.`);
    }

    const supportedFields = supportedUpdateFields.get(targetType) ?? new Set<string>();
    const unsupportedField = changes.find((change) => !supportedFields.has(String(change.field)));

    if (unsupportedField) {
        return toPreflightAction(
            action,
            'unsupported',
            `Field ${unsupportedField.field} is not supported by the current Fluxer structure mutation wrappers.`
        );
    }

    const overwriteValidation = validatePermissionOverwriteChanges(current, actions, changes, options);

    if (overwriteValidation) {
        return toPreflightAction(action, overwriteValidation.status, overwriteValidation.message);
    }

    const layoutValidation = validateLayoutChanges(current, actions, targetType, targetId, changes, options);

    if (layoutValidation) {
        return toPreflightAction(action, layoutValidation.status, layoutValidation.message);
    }

    return toPreflightAction(action, 'ready', 'The target still matches the dry-run baseline.');
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

function findCurrentItem(
    current: DashboardStructureSnapshot,
    targetType: TargetType,
    targetId: string | undefined
): StructureItem | undefined {
    if (!targetId) return undefined;

    switch (targetType) {
        case 'role':
            return current.roles.find((role) => role.id === targetId);
        case 'category':
            return current.categories.find((category) => category.id === targetId);
        case 'channel':
            return current.channels.find((channel) => channel.id === targetId);
    }
}

function normalizeCreateTarget(value: unknown): Record<string, unknown> | undefined {
    return isObject(value) ? value : undefined;
}

function isProtectedRoleTarget(
    role: { id?: unknown; name?: unknown; position?: unknown; protected?: unknown; protectionReason?: unknown },
    guildId: string | undefined
): boolean {
    return (
        role.protected === true ||
        isRoleProtectionReason(role.protectionReason) ||
        (typeof guildId === 'string' && role.id === guildId) ||
        (role.name === '@everyone' && role.position === 0)
    );
}

function isRoleProtectionReason(value: unknown): boolean {
    return value === 'everyone' || value === 'bot' || value === 'integration' || value === 'managed';
}

function isResolvableCategoryId(
    current: DashboardStructureSnapshot,
    actions: DashboardStructurePreflightInputAction[],
    parentId: string,
    options: DashboardStructurePreflightOptions
): boolean {
    return (
        current.categories.some((category) => category.id === parentId) ||
        current.categories.some((category) => category.id === options.idMap?.[parentId]) ||
        actions.some(
            (action) =>
                action.actionType === 'create' && action.targetType === 'category' && action.targetId === parentId
        )
    );
}

function isSupportedChannelType(type: number): type is 0 | 2 | 4 | 5 | 998 {
    return type === 0 || type === 2 || type === 4 || type === 5 || type === 998;
}

type PermissionOverwrite = {
    id: string;
    type: 0 | 1;
    allow: string;
    deny: string;
};

function validatePermissionOverwriteChanges(
    current: DashboardStructureSnapshot,
    actions: DashboardStructurePreflightInputAction[],
    changes: Array<{ field: string; before: unknown; after: unknown }>,
    options: DashboardStructurePreflightOptions
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

function validatePermissionOverwriteTargets(
    current: DashboardStructureSnapshot,
    actions: DashboardStructurePreflightInputAction[],
    overwrites: readonly PermissionOverwrite[],
    options: DashboardStructurePreflightOptions
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
        if (overwrite.type === 1) continue;

        if (deletedRoleIds.has(overwrite.id)) {
            return {
                status: 'invalid-plan',
                message: 'A permission overwrite references a role that is deleted by this import plan.',
            };
        }

        if (isResolvableRoleOverwriteId(current, actions, overwrite.id, options)) continue;

        return {
            status: 'mapping-required',
            message: 'A permission overwrite role target must exist or be created in this import plan.',
        };
    }

    return undefined;
}

function validateLayoutChanges(
    current: DashboardStructureSnapshot,
    actions: DashboardStructurePreflightInputAction[],
    targetType: TargetType,
    targetId: string,
    changes: Array<{ field: string; before: unknown; after: unknown }>,
    options: DashboardStructurePreflightOptions
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
        if (typeof change.after !== 'string' || !change.after.trim()) {
            return { status: 'invalid-plan', message: 'The channel parent update is invalid.' };
        }
        if (!isResolvableCategoryId(current, actions, change.after, options)) {
            return {
                status: 'mapping-required',
                message: 'The channel parent category must exist or be created earlier in this import plan.',
            };
        }
    }

    return undefined;
}

function isResolvableRoleOverwriteId(
    current: DashboardStructureSnapshot,
    actions: DashboardStructurePreflightInputAction[],
    roleId: string,
    options: DashboardStructurePreflightOptions
): boolean {
    return (
        current.guildId === roleId ||
        options.sourceGuildId === roleId ||
        current.roles.some((role) => role.id === options.idMap?.[roleId]) ||
        current.roles.some((role) => role.id === roleId) ||
        actions.some(
            (action) => action.actionType === 'create' && action.targetType === 'role' && action.targetId === roleId
        )
    );
}

function normalizePermissionOverwrites(value: unknown): PermissionOverwrite[] | undefined {
    if (!Array.isArray(value)) return undefined;

    const overwrites: PermissionOverwrite[] = [];

    for (const overwrite of value) {
        if (
            !isObject(overwrite) ||
            typeof overwrite.id !== 'string' ||
            !overwrite.id.trim() ||
            (overwrite.type !== 0 && overwrite.type !== 1) ||
            typeof overwrite.allow !== 'string' ||
            typeof overwrite.deny !== 'string'
        ) {
            return undefined;
        }

        overwrites.push({
            id: overwrite.id.trim(),
            type: overwrite.type,
            allow: overwrite.allow,
            deny: overwrite.deny,
        });
    }

    return overwrites;
}

function findDuplicateOverwriteKey(overwrites: readonly PermissionOverwrite[]): string | undefined {
    const keys = new Set<string>();

    for (const overwrite of overwrites) {
        const key = `${overwrite.type}:${overwrite.id}`;

        if (keys.has(key)) return key;
        keys.add(key);
    }

    return undefined;
}

function isValidPosition(value: unknown): value is number {
    return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function normalizeTargetType(targetType: string): TargetType | undefined {
    return targetType === 'role' || targetType === 'category' || targetType === 'channel' ? targetType : undefined;
}

function readStructureField(item: StructureItem, field: string): unknown {
    return (item as Record<string, unknown>)[field];
}

function toPreflightAction(
    action: DashboardStructurePreflightInputAction,
    status: DashboardStructurePreflightActionStatus,
    message: string
): DashboardStructurePreflightAction {
    return {
        actionId: action.id,
        actionType: action.actionType,
        targetType: action.targetType,
        ...(action.targetId ? { targetId: action.targetId } : {}),
        ...(action.label ? { label: action.label } : {}),
        status,
        message,
    };
}

function countStatus(
    actions: DashboardStructurePreflightAction[],
    status: DashboardStructurePreflightActionStatus
): number {
    return actions.filter((action) => action.status === status).length;
}

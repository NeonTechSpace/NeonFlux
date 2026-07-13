import type { FluxerGuildChannel, FluxerGuildRole } from '@neonflux/fluxer';

import type { DashboardStructureSnapshot } from './dashboard-structure-diff.js';
import type { DashboardStructurePolicy } from './dashboard-structure-contracts.js';
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

export function countDashboardStructurePreflightHardBlockers(report: DashboardStructurePreflightReport): number {
    return (
        report.summary.stale + report.summary.mappingRequired + report.summary.unsupported + report.summary.invalidPlan
    );
}

export function isDashboardStructurePreflightReady(report: DashboardStructurePreflightReport): boolean {
    return (
        countDashboardStructurePreflightHardBlockers(report) === 0 &&
        report.summary.ready + report.summary.destructiveApprovalRequired === report.summary.total
    );
}

export function prependDashboardStructureProjectionBlocker(
    report: DashboardStructurePreflightReport,
    message: string
): DashboardStructurePreflightReport {
    return {
        summary: {
            ...report.summary,
            total: report.summary.total + 1,
            stale: report.summary.stale + 1,
        },
        actions: [
            {
                actionId: 'role-projection',
                actionType: 'verify',
                targetType: 'role-projection',
                label: 'Projected role layout',
                status: 'stale',
                message,
            },
            ...report.actions,
        ],
    };
}

export type DashboardStructurePreflightOptions = {
    allowDestructiveDeletes?: boolean;
    idMap?: Record<string, string>;
    knownTargetIds?: readonly string[];
    policy: DashboardStructurePolicy;
    sourceIds?: readonly string[];
    sourceGuildId?: string;
};

type DashboardStructurePreflightContext = {
    allowDestructiveDeletes?: boolean;
    idMap: Readonly<Record<string, string>>;
    knownTargetIds: ReadonlySet<string>;
    policy: DashboardStructurePolicy;
    sourceGuildId?: string;
    sourceIds: ReadonlySet<string>;
};

type DashboardStructureChannelOrderEntry = {
    sourceId: string;
    parentSourceId: string | null;
    position: number;
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
    options: DashboardStructurePreflightOptions = { policy: 'synchronize' }
): DashboardStructurePreflightReport {
    const context = createPreflightContext(options);
    const preflightActions = actions.map((action) => preflightAction(current, action, actions, context));

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

function createPreflightContext(options: DashboardStructurePreflightOptions): DashboardStructurePreflightContext {
    const idMap = options.idMap ?? {};

    return {
        ...(options.allowDestructiveDeletes === undefined
            ? {}
            : { allowDestructiveDeletes: options.allowDestructiveDeletes }),
        idMap,
        knownTargetIds: new Set(options.knownTargetIds ?? []),
        policy: options.policy,
        ...(options.sourceGuildId ? { sourceGuildId: options.sourceGuildId } : {}),
        sourceIds: new Set([...(options.sourceIds ?? []), ...Object.keys(idMap)]),
    };
}

function preflightAction(
    current: DashboardStructureSnapshot,
    action: DashboardStructurePreflightInputAction,
    actions: DashboardStructurePreflightInputAction[],
    options: DashboardStructurePreflightContext
): DashboardStructurePreflightAction {
    if (action.targetType === 'role-order') {
        return preflightRoleOrderAction(current, action, actions, options);
    }
    if (action.targetType === 'channel-order') {
        return preflightChannelOrderAction(current, action, actions, options);
    }

    const targetType = normalizeTargetType(action.targetType);

    if (!targetType || !isCanonicalReferenceId(action.targetId)) {
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

function preflightChannelOrderAction(
    current: DashboardStructureSnapshot,
    action: DashboardStructurePreflightInputAction,
    actions: DashboardStructurePreflightInputAction[],
    options: DashboardStructurePreflightContext
): DashboardStructurePreflightAction {
    const channels = action.details.after;
    if (action.actionType !== 'update' || action.targetId !== 'channel-order' || !Array.isArray(channels)) {
        return toPreflightAction(action, 'invalid-plan', 'The channel-order step is malformed.');
    }

    const before = readChannelOrderProjection(action.details.before);
    if (action.details.before !== undefined && !before) {
        return toPreflightAction(action, 'invalid-plan', 'The reviewed channel-order baseline is malformed.');
    }
    const baselineComparison = before
        ? compareChannelOrderBaseline(before, normalizeDashboardStructureChannelOrder(current), current, options)
        : 'same';
    if (baselineComparison === 'mapping-required') {
        return toPreflightAction(
            action,
            'mapping-required',
            'The reviewed channel-order baseline contains a reference that cannot be mapped safely.'
        );
    }
    if (baselineComparison === 'different') {
        return toPreflightAction(
            action,
            'stale',
            'The live channel or category order changed after this dry-run was reviewed.'
        );
    }

    const sourceIds = new Set<string>();
    for (const channel of channels) {
        if (
            !isObject(channel) ||
            !isCanonicalReferenceId(channel.sourceId) ||
            (channel.parentSourceId !== null && !isCanonicalReferenceId(channel.parentSourceId)) ||
            typeof channel.position !== 'number' ||
            !Number.isInteger(channel.position) ||
            channel.position < 0 ||
            sourceIds.has(channel.sourceId)
        ) {
            return toPreflightAction(
                action,
                'invalid-plan',
                'The channel-order step contains an invalid channel position.'
            );
        }
        sourceIds.add(channel.sourceId);

        const target = resolveStructureReference(current, actions, channel.sourceId, 'channel-or-category', options);
        if (target.type === 'unresolved') {
            return toPreflightAction(action, 'mapping-required', 'A channel-order target cannot be mapped safely.');
        }

        if (channel.parentSourceId) {
            const parent = resolveStructureReference(current, actions, channel.parentSourceId, 'category', options);
            if (parent.type === 'unresolved') {
                return toPreflightAction(action, 'mapping-required', 'A channel-order parent cannot be mapped safely.');
            }
        }
    }

    return toPreflightAction(action, 'ready', 'The reviewed channel-order step is ready to apply.');
}

function normalizeDashboardStructureChannelOrder(
    snapshot: DashboardStructureSnapshot
): DashboardStructureChannelOrderEntry[] {
    const grouped = new Map<string, Array<{ sourceId: string; parentSourceId: string | null; rawPosition: number }>>();
    for (const channel of [...snapshot.categories, ...snapshot.channels]) {
        const parentSourceId = channel.parentId;
        const key = parentSourceId ?? '';
        const siblings = grouped.get(key) ?? [];
        siblings.push({
            sourceId: channel.id,
            parentSourceId,
            rawPosition: typeof channel.position === 'number' ? channel.position : Number.MAX_SAFE_INTEGER,
        });
        grouped.set(key, siblings);
    }

    return [...grouped.values()]
        .flatMap((siblings) =>
            siblings
                .sort(
                    (left, right) => left.rawPosition - right.rawPosition || left.sourceId.localeCompare(right.sourceId)
                )
                .map((channel, position) => ({
                    sourceId: channel.sourceId,
                    parentSourceId: channel.parentSourceId,
                    position,
                }))
        )
        .sort(compareChannelOrderEntries);
}

function readChannelOrderProjection(value: unknown): DashboardStructureChannelOrderEntry[] | undefined {
    if (!Array.isArray(value)) return undefined;
    const sourceIds = new Set<string>();
    const siblingPositions = new Set<string>();
    const entries = value.flatMap((channel) => {
        if (
            !isObject(channel) ||
            !isCanonicalReferenceId(channel.sourceId) ||
            (channel.parentSourceId !== null && !isCanonicalReferenceId(channel.parentSourceId)) ||
            typeof channel.position !== 'number' ||
            !Number.isInteger(channel.position) ||
            channel.position < 0
        ) {
            return [];
        }
        const sourceId = channel.sourceId;
        const parentSourceId = channel.parentSourceId;
        const siblingKey = `${parentSourceId ?? ''}:${channel.position}`;
        if (sourceIds.has(sourceId) || siblingPositions.has(siblingKey)) return [];
        sourceIds.add(sourceId);
        siblingPositions.add(siblingKey);
        return [{ sourceId, parentSourceId, position: channel.position }];
    });

    if (entries.length !== value.length) return undefined;
    const groupedPositions = new Map<string, number[]>();
    for (const entry of entries) {
        const key = entry.parentSourceId ?? '';
        groupedPositions.set(key, [...(groupedPositions.get(key) ?? []), entry.position]);
    }
    if (
        [...groupedPositions.values()].some((positions) =>
            positions
                .sort((left, right) => left - right)
                .some((position, expectedPosition) => position !== expectedPosition)
        )
    ) {
        return undefined;
    }

    return entries.sort(compareChannelOrderEntries);
}

function compareChannelOrderBaseline(
    expected: DashboardStructureChannelOrderEntry[],
    actual: DashboardStructureChannelOrderEntry[],
    current: DashboardStructureSnapshot,
    options: DashboardStructurePreflightContext
): 'same' | 'different' | 'mapping-required' {
    if (expected.length !== actual.length) return 'different';
    const resolved: DashboardStructureChannelOrderEntry[] = [];
    for (const channel of expected) {
        if (
            !options.knownTargetIds.has(channel.sourceId) ||
            !currentContainsReferenceTarget(current, channel.sourceId, 'channel-or-category')
        ) {
            return 'mapping-required';
        }

        let parentTargetId: string | null = null;
        if (channel.parentSourceId) {
            if (
                !options.knownTargetIds.has(channel.parentSourceId) ||
                !currentContainsReferenceTarget(current, channel.parentSourceId, 'category')
            ) {
                return 'mapping-required';
            }
            parentTargetId = channel.parentSourceId;
        }

        resolved.push({
            sourceId: channel.sourceId,
            parentSourceId: parentTargetId,
            position: channel.position,
        });
    }
    resolved.sort(compareChannelOrderEntries);

    return stableValueKey(resolved) === stableValueKey(actual) ? 'same' : 'different';
}

function compareChannelOrderEntries(
    left: DashboardStructureChannelOrderEntry,
    right: DashboardStructureChannelOrderEntry
): number {
    return (
        (left.parentSourceId ?? '').localeCompare(right.parentSourceId ?? '') ||
        left.position - right.position ||
        left.sourceId.localeCompare(right.sourceId)
    );
}

function preflightRoleOrderAction(
    current: DashboardStructureSnapshot,
    action: DashboardStructurePreflightInputAction,
    actions: DashboardStructurePreflightInputAction[],
    options: DashboardStructurePreflightContext
): DashboardStructurePreflightAction {
    const roles = action.details.after;
    if (action.actionType !== 'update' || action.targetId !== 'role-order' || !Array.isArray(roles)) {
        return toPreflightAction(action, 'invalid-plan', 'The role-order step is malformed.');
    }

    const sourceIds = new Set<string>();
    for (const role of roles) {
        if (
            !isObject(role) ||
            !isCanonicalReferenceId(role.sourceId) ||
            !Number.isInteger(role.position) ||
            typeof role.position !== 'number' ||
            role.position <= 0 ||
            sourceIds.has(role.sourceId)
        ) {
            return toPreflightAction(action, 'invalid-plan', 'The role-order step contains an invalid role position.');
        }
        sourceIds.add(role.sourceId);

        const target = resolveStructureReference(current, actions, role.sourceId, 'role', options);
        if (target.type === 'unresolved') {
            return toPreflightAction(action, 'mapping-required', 'A role-order target cannot be mapped safely.');
        }
    }

    return toPreflightAction(action, 'ready', 'The reviewed role-order step is ready to apply.');
}

function preflightCreateAction(
    current: DashboardStructureSnapshot,
    action: DashboardStructurePreflightInputAction,
    targetType: TargetType,
    actions: DashboardStructurePreflightInputAction[],
    options: DashboardStructurePreflightContext
): DashboardStructurePreflightAction {
    const after = normalizeCreateTarget(action.details.after);

    if (!after) {
        return toPreflightAction(action, 'invalid-plan', 'The create action does not contain a valid target.');
    }

    if (
        findCurrentItem(current, targetType, action.targetId) &&
        !isSameGuildReplaceCreate(current, action, targetType, actions, options)
    ) {
        return toPreflightAction(action, 'stale', 'The create target already exists in the current server layout.');
    }

    if (targetType === 'role' && isProtectedRoleTarget(after, current.guildId)) {
        return toPreflightAction(action, 'unsupported', 'Protected bot, integration, and default roles are ignored.');
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
    current: DashboardStructureSnapshot,
    action: DashboardStructurePreflightInputAction,
    targetType: TargetType,
    actions: DashboardStructurePreflightInputAction[],
    after: Record<string, unknown>,
    mappedTargetId: string,
    options: DashboardStructurePreflightContext
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
        const roleValidation = preflightRoleCreateAction(action, after);
        if (roleValidation.status !== 'ready') return roleValidation;

        const mappedRole = mappedItem as FluxerGuildRole;
        if (!isMatchingMappedRole(mappedRole, after)) {
            return toPreflightAction(action, 'stale', 'The previously created retry role changed after creation.');
        }

        return toPreflightAction(
            action,
            'ready',
            'The previously created role exists. Retry will reuse it instead of creating a duplicate.'
        );
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

    const expectedParentId = readOptionalReferenceId(after.parentId);
    if (expectedParentId === undefined) {
        return toPreflightAction(action, 'invalid-plan', 'The mapped create repair target has an invalid parent.');
    }
    let mappedParentId: string | null = null;
    if (expectedParentId) {
        const parent = resolveStructureReference(current, actions, expectedParentId, 'category', options, false);
        if (parent.type !== 'resolved') {
            return toPreflightAction(
                action,
                'mapping-required',
                'The mapped create repair parent cannot be mapped to an existing category.'
            );
        }
        mappedParentId = parent.targetId;
    }

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
    options: DashboardStructurePreflightContext
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

    const parentId = readOptionalReferenceId(after.parentId);

    if (parentId === undefined) {
        return toPreflightAction(action, 'invalid-plan', 'The channel create target has an invalid parent category.');
    }

    if (targetType === 'category' && parentId) {
        return toPreflightAction(action, 'invalid-plan', 'Categories cannot have parent categories.');
    }

    if (parentId && resolveStructureReference(current, actions, parentId, 'category', options).type === 'unresolved') {
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
    options: DashboardStructurePreflightContext
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

    if (
        targetType === 'role' &&
        isRoleBlockedByBotHierarchy(currentItem, current.botHighestRolePosition, current.botHighestRoleHierarchyRank)
    ) {
        return toPreflightAction(
            action,
            'unsupported',
            'The bot role must be above this role before it can be deleted.'
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
    options: DashboardStructurePreflightContext
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
    const followsPlannedCreate = isPlannedCreateFollowupUpdate(action, actions, targetType);

    if (!currentItem && !followsPlannedCreate) {
        return toPreflightAction(action, 'stale', 'The target no longer exists in the current server layout.');
    }

    if (currentItem && !followsPlannedCreate) {
        if (targetType === 'role' && isProtectedRoleTarget(currentItem, current.guildId)) {
            return toPreflightAction(
                action,
                'unsupported',
                'Protected bot, integration, and default roles cannot be updated.'
            );
        }

        if (
            targetType === 'role' &&
            isRoleBlockedByBotHierarchy(
                currentItem,
                current.botHighestRolePosition,
                current.botHighestRoleHierarchyRank
            )
        ) {
            return toPreflightAction(
                action,
                'unsupported',
                'The bot role must be above this role before it can be updated.'
            );
        }

        const staleField = changes.find(
            (change) => stableValueKey(readStructureField(currentItem, change.field)) !== stableValueKey(change.before)
        );

        if (staleField) {
            return toPreflightAction(
                action,
                'stale',
                `Field ${staleField.field} changed after the dry-run was created.`
            );
        }
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

    return toPreflightAction(
        action,
        'ready',
        followsPlannedCreate
            ? 'The update follows its reviewed create step.'
            : 'The target still matches the dry-run baseline.'
    );
}

function isPlannedCreateFollowupUpdate(
    action: DashboardStructurePreflightInputAction,
    actions: DashboardStructurePreflightInputAction[],
    targetType: TargetType
): boolean {
    const actionIndex = actions.indexOf(action);
    const execution = readExecutionStep(action);
    if (
        actionIndex <= 0 ||
        action.actionType !== 'update' ||
        execution?.operation !== 'permission-overwrite-upsert' ||
        execution.step <= 1
    ) {
        return false;
    }

    return actions.slice(0, actionIndex).some((candidate) => {
        const candidateExecution = readExecutionStep(candidate);
        return (
            candidate.actionType === 'create' &&
            candidate.targetType === targetType &&
            candidate.targetId === action.targetId &&
            candidateExecution?.operation === 'create' &&
            candidateExecution.groupId === execution.groupId &&
            candidateExecution.step === 1 &&
            candidateExecution.stepCount === execution.stepCount
        );
    });
}

function readExecutionStep(action: DashboardStructurePreflightInputAction):
    | {
          groupId: string;
          operation: string;
          step: number;
          stepCount: number;
      }
    | undefined {
    const execution = action.details.execution;
    if (
        !isObject(execution) ||
        typeof execution.groupId !== 'string' ||
        !execution.groupId ||
        typeof execution.operation !== 'string' ||
        !execution.operation ||
        !Number.isInteger(execution.step) ||
        !Number.isInteger(execution.stepCount) ||
        (execution.step as number) < 1 ||
        (execution.stepCount as number) < (execution.step as number)
    ) {
        return undefined;
    }

    return {
        groupId: execution.groupId,
        operation: execution.operation,
        step: execution.step as number,
        stepCount: execution.stepCount as number,
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

function isRoleBlockedByBotHierarchy(
    role: { position?: unknown; hierarchyRank?: unknown; name?: unknown },
    botHighestRolePosition: number | undefined,
    botHighestRoleHierarchyRank: number | undefined
): boolean {
    return (
        role.name !== '@everyone' &&
        isRolePositionBlockedByBotHierarchy(
            role.position,
            role.hierarchyRank,
            botHighestRolePosition,
            botHighestRoleHierarchyRank
        )
    );
}

function isRolePositionBlockedByBotHierarchy(
    position: unknown,
    hierarchyRank: unknown,
    botHighestRolePosition: number | undefined,
    botHighestRoleHierarchyRank: number | undefined
): boolean {
    if (
        typeof position !== 'number' ||
        typeof botHighestRolePosition !== 'number' ||
        !Number.isFinite(position) ||
        !Number.isFinite(botHighestRolePosition)
    ) {
        return false;
    }

    if (position > botHighestRolePosition) return true;
    if (position < botHighestRolePosition) return false;

    if (
        typeof hierarchyRank === 'number' &&
        typeof botHighestRoleHierarchyRank === 'number' &&
        Number.isFinite(hierarchyRank) &&
        Number.isFinite(botHighestRoleHierarchyRank)
    ) {
        return hierarchyRank <= botHighestRoleHierarchyRank;
    }

    return true;
}

type StructureReferenceTargetType = TargetType | 'channel-or-category';
type StructureReferenceResolution =
    | { type: 'resolved'; targetId: string }
    | { type: 'planned-create' }
    | { type: 'unresolved' };

function resolveStructureReference(
    current: DashboardStructureSnapshot,
    actions: DashboardStructurePreflightInputAction[],
    referenceId: string,
    targetType: StructureReferenceTargetType,
    options: DashboardStructurePreflightContext,
    allowPlannedCreate = true
): StructureReferenceResolution {
    if (!isCanonicalReferenceId(referenceId)) return { type: 'unresolved' };

    if (
        targetType === 'role' &&
        options.sourceGuildId === referenceId &&
        current.guildId &&
        options.knownTargetIds.has(current.guildId)
    ) {
        return { type: 'resolved', targetId: current.guildId };
    }

    const plannedCreate = actions.some(
        (action) =>
            action.actionType === 'create' &&
            action.targetId === referenceId &&
            matchesReferenceTargetType(action.targetType, targetType)
    );
    const isImportedReference =
        options.sourceIds.has(referenceId) || Object.hasOwn(options.idMap, referenceId) || plannedCreate;

    if (isImportedReference) {
        const mappedTargetId = options.idMap[referenceId];
        if (mappedTargetId) {
            return options.knownTargetIds.has(mappedTargetId) &&
                currentContainsReferenceTarget(current, mappedTargetId, targetType)
                ? { type: 'resolved', targetId: mappedTargetId }
                : { type: 'unresolved' };
        }

        return allowPlannedCreate && plannedCreate ? { type: 'planned-create' } : { type: 'unresolved' };
    }

    return options.knownTargetIds.has(referenceId) && currentContainsReferenceTarget(current, referenceId, targetType)
        ? { type: 'resolved', targetId: referenceId }
        : { type: 'unresolved' };
}

function matchesReferenceTargetType(actionTargetType: string, expected: StructureReferenceTargetType): boolean {
    return expected === 'channel-or-category'
        ? actionTargetType === 'channel' || actionTargetType === 'category'
        : actionTargetType === expected;
}

function currentContainsReferenceTarget(
    current: DashboardStructureSnapshot,
    targetId: string,
    targetType: StructureReferenceTargetType
): boolean {
    switch (targetType) {
        case 'role':
            return current.guildId === targetId || current.roles.some((role) => role.id === targetId);
        case 'category':
            return current.categories.some((category) => category.id === targetId);
        case 'channel':
            return current.channels.some((channel) => channel.id === targetId);
        case 'channel-or-category':
            return (
                current.categories.some((category) => category.id === targetId) ||
                current.channels.some((channel) => channel.id === targetId)
            );
    }
}

function isSupportedChannelType(type: number): type is 0 | 2 | 4 | 998 {
    return type === 0 || type === 2 || type === 4 || type === 998;
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
    options: DashboardStructurePreflightContext
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
    options: DashboardStructurePreflightContext
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
                message: 'A permission overwrite role target must exist or be created in this import plan.',
            };
        }
        if (role.type === 'planned-create') continue;

        if (deletedRoleIds.has(role.targetId)) {
            return {
                status: 'invalid-plan',
                message: 'A permission overwrite references a role that is deleted by this import plan.',
            };
        }
    }

    return undefined;
}

function isSameGuildReplaceCreate(
    current: DashboardStructureSnapshot,
    action: DashboardStructurePreflightInputAction,
    targetType: TargetType,
    actions: DashboardStructurePreflightInputAction[],
    options: DashboardStructurePreflightContext
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

function validateLayoutChanges(
    current: DashboardStructureSnapshot,
    actions: DashboardStructurePreflightInputAction[],
    targetType: TargetType,
    targetId: string,
    changes: Array<{ field: string; before: unknown; after: unknown }>,
    options: DashboardStructurePreflightContext
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
                message: 'The channel parent category must exist or be created earlier in this import plan.',
            };
        }
    }

    return undefined;
}

function normalizePermissionOverwrites(value: unknown): PermissionOverwrite[] | undefined {
    if (!Array.isArray(value)) return undefined;

    const overwrites: PermissionOverwrite[] = [];

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

function readOptionalReferenceId(value: unknown): string | null | undefined {
    if (value === null || value === undefined) return null;
    return isCanonicalReferenceId(value) ? value : undefined;
}

function isCanonicalReferenceId(value: unknown): value is string {
    return typeof value === 'string' && Boolean(value) && value === value.trim();
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

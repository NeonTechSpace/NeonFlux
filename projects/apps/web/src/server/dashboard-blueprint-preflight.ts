import { isBlueprintPreflightReportReady } from '@neonflux/blueprint';
import type {
    BlueprintPreflightReport,
    BlueprintPreflightReportStep,
    BlueprintPreflightStepStatus,
} from '@neonflux/blueprint';
import type { FluxerGuildChannel, FluxerGuildRole } from '@neonflux/fluxer';

import type { DashboardBlueprintSnapshot } from './dashboard-blueprint-diff.js';
import type { DashboardBlueprintPolicy } from './dashboard-blueprint-contracts.js';
import { isObject, stableValueKey } from './dashboard-blueprint-preflight-utils.js';

type DashboardBlueprintPreflightPlanStepStatus = BlueprintPreflightStepStatus;

export type DashboardBlueprintPreflightInputPlanStep = {
    id: string;
    actionType: string;
    targetType: string;
    targetId?: string;
    label?: string;
    details: Record<string, unknown>;
};

type DashboardBlueprintPreflightPlanStep = BlueprintPreflightReportStep;

export type DashboardBlueprintPreflightReport = BlueprintPreflightReport;

export function countDashboardBlueprintPreflightHardBlockers(report: DashboardBlueprintPreflightReport): number {
    return (
        report.summary.stale + report.summary.mappingRequired + report.summary.unsupported + report.summary.invalidPlan
    );
}

export function isDashboardBlueprintPreflightReady(report: DashboardBlueprintPreflightReport): boolean {
    return isBlueprintPreflightReportReady(report);
}

export function prependDashboardBlueprintProjectionBlocker(
    report: DashboardBlueprintPreflightReport,
    message: string
): DashboardBlueprintPreflightReport {
    return {
        summary: {
            ...report.summary,
            total: report.summary.total + 1,
            stale: report.summary.stale + 1,
        },
        steps: [
            {
                planStepId: 'role-projection',
                actionType: 'verify',
                targetType: 'role-projection',
                label: 'Projected role layout',
                status: 'stale',
                message,
            },
            ...report.steps,
        ],
    };
}

export type DashboardBlueprintPreflightOptions = {
    allowDestructiveDeletes?: boolean;
    idMap?: Record<string, string>;
    knownTargetIds?: readonly string[];
    policy: DashboardBlueprintPolicy;
    sourceIds?: readonly string[];
    sourceGuildId?: string;
};

type DashboardBlueprintPreflightContext = {
    allowDestructiveDeletes?: boolean;
    idMap: Readonly<Record<string, string>>;
    knownTargetIds: ReadonlySet<string>;
    policy: DashboardBlueprintPolicy;
    sourceGuildId?: string;
    sourceIds: ReadonlySet<string>;
};

type DashboardBlueprintChannelOrderEntry = {
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

export function preflightDashboardBlueprintPlan(
    current: DashboardBlueprintSnapshot,
    actions: DashboardBlueprintPreflightInputPlanStep[],
    options: DashboardBlueprintPreflightOptions = { policy: 'synchronize' }
): DashboardBlueprintPreflightReport {
    const context = createPreflightContext(options);
    const preflightSteps = actions.map((action) => preflightStep(current, action, actions, context));

    return {
        summary: {
            total: preflightSteps.length,
            ready: countStatus(preflightSteps, 'ready'),
            stale: countStatus(preflightSteps, 'stale'),
            mappingRequired: countStatus(preflightSteps, 'mapping-required'),
            destructiveApprovalRequired: countStatus(preflightSteps, 'destructive-approval-required'),
            unsupported: countStatus(preflightSteps, 'unsupported'),
            invalidPlan: countStatus(preflightSteps, 'invalid-plan'),
        },
        steps: preflightSteps,
    };
}

function createPreflightContext(options: DashboardBlueprintPreflightOptions): DashboardBlueprintPreflightContext {
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

function preflightStep(
    current: DashboardBlueprintSnapshot,
    action: DashboardBlueprintPreflightInputPlanStep,
    actions: DashboardBlueprintPreflightInputPlanStep[],
    options: DashboardBlueprintPreflightContext
): DashboardBlueprintPreflightPlanStep {
    if (action.targetType === 'role-order') {
        return preflightRoleOrderAction(current, action, actions, options);
    }
    if (action.targetType === 'channel-order') {
        return preflightChannelOrderAction(current, action, actions, options);
    }

    const targetType = normalizeTargetType(action.targetType);

    if (!targetType || !isCanonicalReferenceId(action.targetId)) {
        return toPreflightPlanStep(action, 'invalid-plan', 'The reviewed plan step is missing a valid target.');
    }

    switch (action.actionType) {
        case 'create':
            return preflightCreateAction(current, action, targetType, actions, options);
        case 'delete':
            return preflightDeleteAction(current, action, targetType, options);
        case 'update':
            return preflightUpdateAction(current, action, targetType, actions, options);
        default:
            return toPreflightPlanStep(action, 'invalid-plan', 'The reviewed plan step type is not recognized.');
    }
}

function preflightChannelOrderAction(
    current: DashboardBlueprintSnapshot,
    action: DashboardBlueprintPreflightInputPlanStep,
    actions: DashboardBlueprintPreflightInputPlanStep[],
    options: DashboardBlueprintPreflightContext
): DashboardBlueprintPreflightPlanStep {
    const channels = action.details.after;
    if (action.actionType !== 'update' || action.targetId !== 'channel-order' || !Array.isArray(channels)) {
        return toPreflightPlanStep(action, 'invalid-plan', 'The channel-order step is malformed.');
    }

    const before = readChannelOrderProjection(action.details.before);
    if (action.details.before !== undefined && !before) {
        return toPreflightPlanStep(action, 'invalid-plan', 'The reviewed channel-order baseline is malformed.');
    }
    const baselineComparison = before
        ? compareChannelOrderBaseline(before, normalizeDashboardBlueprintChannelOrder(current), current, options)
        : 'same';
    if (baselineComparison === 'mapping-required') {
        return toPreflightPlanStep(
            action,
            'mapping-required',
            'The reviewed channel-order baseline contains a reference that cannot be mapped safely.'
        );
    }
    if (baselineComparison === 'different') {
        return toPreflightPlanStep(
            action,
            'stale',
            'The live channel or category order changed after this plan was reviewed.'
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
            return toPreflightPlanStep(
                action,
                'invalid-plan',
                'The channel-order step contains an invalid channel position.'
            );
        }
        sourceIds.add(channel.sourceId);

        const target = resolveStructureReference(current, actions, channel.sourceId, 'channel-or-category', options);
        if (target.type === 'unresolved') {
            return toPreflightPlanStep(action, 'mapping-required', 'A channel-order target cannot be mapped safely.');
        }

        if (channel.parentSourceId) {
            const parent = resolveStructureReference(current, actions, channel.parentSourceId, 'category', options);
            if (parent.type === 'unresolved') {
                return toPreflightPlanStep(
                    action,
                    'mapping-required',
                    'A channel-order parent cannot be mapped safely.'
                );
            }
        }
    }

    return toPreflightPlanStep(action, 'ready', 'The reviewed channel-order step is ready to apply.');
}

function normalizeDashboardBlueprintChannelOrder(
    snapshot: DashboardBlueprintSnapshot
): DashboardBlueprintChannelOrderEntry[] {
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

function readChannelOrderProjection(value: unknown): DashboardBlueprintChannelOrderEntry[] | undefined {
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
    expected: DashboardBlueprintChannelOrderEntry[],
    actual: DashboardBlueprintChannelOrderEntry[],
    current: DashboardBlueprintSnapshot,
    options: DashboardBlueprintPreflightContext
): 'same' | 'different' | 'mapping-required' {
    if (expected.length !== actual.length) return 'different';
    const resolved: DashboardBlueprintChannelOrderEntry[] = [];
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
    left: DashboardBlueprintChannelOrderEntry,
    right: DashboardBlueprintChannelOrderEntry
): number {
    return (
        (left.parentSourceId ?? '').localeCompare(right.parentSourceId ?? '') ||
        left.position - right.position ||
        left.sourceId.localeCompare(right.sourceId)
    );
}

function preflightRoleOrderAction(
    current: DashboardBlueprintSnapshot,
    action: DashboardBlueprintPreflightInputPlanStep,
    actions: DashboardBlueprintPreflightInputPlanStep[],
    options: DashboardBlueprintPreflightContext
): DashboardBlueprintPreflightPlanStep {
    const roles = action.details.after;
    if (action.actionType !== 'update' || action.targetId !== 'role-order' || !Array.isArray(roles)) {
        return toPreflightPlanStep(action, 'invalid-plan', 'The role-order step is malformed.');
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
            return toPreflightPlanStep(
                action,
                'invalid-plan',
                'The role-order step contains an invalid role position.'
            );
        }
        sourceIds.add(role.sourceId);

        const target = resolveStructureReference(current, actions, role.sourceId, 'role', options);
        if (target.type === 'unresolved') {
            return toPreflightPlanStep(action, 'mapping-required', 'A role-order target cannot be mapped safely.');
        }
    }

    return toPreflightPlanStep(action, 'ready', 'The reviewed role-order step is ready to apply.');
}

function preflightCreateAction(
    current: DashboardBlueprintSnapshot,
    action: DashboardBlueprintPreflightInputPlanStep,
    targetType: TargetType,
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
    targetType: TargetType,
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
    targetType: TargetType,
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

function preflightDeleteAction(
    current: DashboardBlueprintSnapshot,
    action: DashboardBlueprintPreflightInputPlanStep,
    targetType: TargetType,
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

function preflightUpdateAction(
    current: DashboardBlueprintSnapshot,
    action: DashboardBlueprintPreflightInputPlanStep,
    targetType: TargetType,
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
    targetType: TargetType
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

function findCurrentItem(
    current: DashboardBlueprintSnapshot,
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

function readRoleHierarchyBlock(
    role: { position?: unknown; name?: unknown },
    botHighestRolePosition: number | undefined
): 'blocked' | 'ambiguous' | 'unavailable' | undefined {
    if (role.name === '@everyone') return undefined;
    const position = role.position;
    if (
        typeof position !== 'number' ||
        typeof botHighestRolePosition !== 'number' ||
        !Number.isFinite(position) ||
        !Number.isFinite(botHighestRolePosition)
    ) {
        return 'unavailable';
    }

    if (position > botHighestRolePosition) return 'blocked';
    if (position === botHighestRolePosition) return 'ambiguous';
    return undefined;
}

type StructureReferenceTargetType = TargetType | 'channel-or-category';
type StructureReferenceResolution =
    | { type: 'resolved'; targetId: string }
    | { type: 'planned-create' }
    | { type: 'unresolved' };

function resolveStructureReference(
    current: DashboardBlueprintSnapshot,
    actions: DashboardBlueprintPreflightInputPlanStep[],
    referenceId: string,
    targetType: StructureReferenceTargetType,
    options: DashboardBlueprintPreflightContext,
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
    current: DashboardBlueprintSnapshot,
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
    current: DashboardBlueprintSnapshot,
    actions: DashboardBlueprintPreflightInputPlanStep[],
    changes: Array<{ field: string; before: unknown; after: unknown }>,
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

function validatePermissionOverwriteTargets(
    current: DashboardBlueprintSnapshot,
    actions: DashboardBlueprintPreflightInputPlanStep[],
    overwrites: readonly PermissionOverwrite[],
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

function isSameGuildReplaceCreate(
    current: DashboardBlueprintSnapshot,
    action: DashboardBlueprintPreflightInputPlanStep,
    targetType: TargetType,
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

function validateLayoutChanges(
    current: DashboardBlueprintSnapshot,
    actions: DashboardBlueprintPreflightInputPlanStep[],
    targetType: TargetType,
    targetId: string,
    changes: Array<{ field: string; before: unknown; after: unknown }>,
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

function toPreflightPlanStep(
    action: DashboardBlueprintPreflightInputPlanStep,
    status: DashboardBlueprintPreflightPlanStepStatus,
    message: string
): DashboardBlueprintPreflightPlanStep {
    return {
        planStepId: action.id,
        actionType: action.actionType,
        targetType: action.targetType,
        ...(action.targetId ? { targetId: action.targetId } : {}),
        ...(action.label ? { label: action.label } : {}),
        status,
        message,
    };
}

function countStatus(
    actions: DashboardBlueprintPreflightPlanStep[],
    status: DashboardBlueprintPreflightPlanStepStatus
): number {
    return actions.filter((action) => action.status === status).length;
}

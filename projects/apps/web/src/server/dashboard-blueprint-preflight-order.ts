import type { DashboardBlueprintSnapshot } from './dashboard-blueprint-diff.js';
import {
    currentContainsReferenceTarget,
    isCanonicalReferenceId,
    resolveStructureReference,
    toPreflightPlanStep,
} from './dashboard-blueprint-preflight-internal.js';
import type {
    DashboardBlueprintPreflightContext,
    DashboardBlueprintPreflightInputPlanStep,
    DashboardBlueprintPreflightPlanStep,
} from './dashboard-blueprint-preflight-internal.js';
import { isObject, stableValueKey } from './dashboard-blueprint-preflight-utils.js';

type DashboardBlueprintChannelOrderEntry = {
    sourceId: string;
    parentSourceId: string | null;
    position: number;
};

export function preflightChannelOrderAction(
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

export function preflightRoleOrderAction(
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

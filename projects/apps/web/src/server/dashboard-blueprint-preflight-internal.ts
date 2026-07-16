import type { BlueprintPreflightReportStep, BlueprintPreflightStepStatus } from '@neonflux/blueprint';
import type { FluxerGuildChannel, FluxerGuildRole } from '@neonflux/fluxer';

import type { DashboardBlueprintPolicy } from './dashboard-blueprint-contracts.js';
import type { DashboardBlueprintSnapshot } from './dashboard-blueprint-diff.js';

export type DashboardBlueprintPreflightInputPlanStep = {
    id: string;
    actionType: string;
    targetType: string;
    targetId?: string;
    label?: string;
    details: Record<string, unknown>;
};

export type DashboardBlueprintPreflightPlanStep = BlueprintPreflightReportStep;

export type DashboardBlueprintPreflightContext = {
    allowDestructiveDeletes?: boolean;
    idMap: Readonly<Record<string, string>>;
    knownTargetIds: ReadonlySet<string>;
    policy: DashboardBlueprintPolicy;
    sourceGuildId?: string;
    sourceIds: ReadonlySet<string>;
};

export type DashboardBlueprintPreflightChange = {
    field: string;
    before: unknown;
    after: unknown;
};

export type DashboardBlueprintStructureItem = FluxerGuildRole | FluxerGuildChannel;
export type DashboardBlueprintTargetType = 'role' | 'category' | 'channel';
export type DashboardBlueprintStructureReferenceTargetType = DashboardBlueprintTargetType | 'channel-or-category';
export type DashboardBlueprintStructureReferenceResolution =
    | { type: 'resolved'; targetId: string }
    | { type: 'planned-create' }
    | { type: 'unresolved' };

export function findCurrentItem(
    current: DashboardBlueprintSnapshot,
    targetType: DashboardBlueprintTargetType,
    targetId: string | undefined
): DashboardBlueprintStructureItem | undefined {
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

export function isProtectedRoleTarget(
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

export function readRoleHierarchyBlock(
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

export function resolveStructureReference(
    current: DashboardBlueprintSnapshot,
    actions: DashboardBlueprintPreflightInputPlanStep[],
    referenceId: string,
    targetType: DashboardBlueprintStructureReferenceTargetType,
    options: DashboardBlueprintPreflightContext,
    allowPlannedCreate = true
): DashboardBlueprintStructureReferenceResolution {
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

function matchesReferenceTargetType(
    actionTargetType: string,
    expected: DashboardBlueprintStructureReferenceTargetType
): boolean {
    return expected === 'channel-or-category'
        ? actionTargetType === 'channel' || actionTargetType === 'category'
        : actionTargetType === expected;
}

export function currentContainsReferenceTarget(
    current: DashboardBlueprintSnapshot,
    targetId: string,
    targetType: DashboardBlueprintStructureReferenceTargetType
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

export function isSupportedChannelType(type: number): type is 0 | 2 | 4 | 998 {
    return type === 0 || type === 2 || type === 4 || type === 998;
}

export function isValidPosition(value: unknown): value is number {
    return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

export function readOptionalReferenceId(value: unknown): string | null | undefined {
    if (value === null || value === undefined) return null;
    return isCanonicalReferenceId(value) ? value : undefined;
}

export function isCanonicalReferenceId(value: unknown): value is string {
    return typeof value === 'string' && Boolean(value) && value === value.trim();
}

export function normalizeTargetType(targetType: string): DashboardBlueprintTargetType | undefined {
    return targetType === 'role' || targetType === 'category' || targetType === 'channel' ? targetType : undefined;
}

export function readStructureField(item: DashboardBlueprintStructureItem, field: string): unknown {
    return (item as Record<string, unknown>)[field];
}

export function toPreflightPlanStep(
    action: DashboardBlueprintPreflightInputPlanStep,
    status: BlueprintPreflightStepStatus,
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

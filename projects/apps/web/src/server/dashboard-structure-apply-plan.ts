import type { StructureImportActionRecord } from '@neonflux/db';

export function readRequestedGuildId(plan: Record<string, unknown>): string | undefined {
    return typeof plan.requestedGuildId === 'string' && plan.requestedGuildId.trim()
        ? plan.requestedGuildId.trim()
        : undefined;
}

export function readStructureActionChanges(
    details: Record<string, unknown>
): Array<{ field: string; before?: unknown; after: unknown }> {
    const changes = details.changes;
    if (!Array.isArray(changes)) return [];

    return changes
        .filter(
            (change): change is { field: string; before?: unknown; after: unknown } =>
                isObject(change) && typeof change.field === 'string'
        )
        .map((change) => ({
            field: change.field,
            ...(change.before !== undefined ? { before: change.before } : {}),
            after: change.after,
        }));
}

export function readApplySourceTargetMap(plan: Record<string, unknown>): Record<string, string> {
    const directMap = isObject(plan.sourceTargetMap) ? plan.sourceTargetMap : undefined;
    const applySummary = isObject(plan.applySummary) ? plan.applySummary : undefined;
    const summaryMap =
        applySummary && isObject(applySummary.sourceTargetMap) ? applySummary.sourceTargetMap : undefined;
    const source = directMap ?? summaryMap ?? {};

    return Object.fromEntries(
        Object.entries(source).filter((entry): entry is [string, string] => typeof entry[1] === 'string')
    );
}

export function readImportMode(plan: Record<string, unknown>): 'merge' | 'replace' {
    return plan.importMode === 'replace' ? 'replace' : 'merge';
}

export function readMatchedRoleSourceTargetMap(actions: StructureImportActionRecord[]): Record<string, string> {
    return Object.fromEntries(
        actions.flatMap((action): Array<[string, string]> => {
            if (action.actionType !== 'update' || action.targetType !== 'role' || !action.targetId) return [];

            const sourceId = typeof action.details.sourceId === 'string' ? action.details.sourceId.trim() : '';

            return sourceId ? [[sourceId, action.targetId]] : [];
        })
    );
}

export function readPersistedRoleOrder(actions: StructureImportActionRecord[]) {
    const action = actions.find((candidate) => candidate.targetType === 'role-order');
    if (!action || !Array.isArray(action.details.after)) return undefined;

    const roles = action.details.after.flatMap((role) => {
        if (
            !isObject(role) ||
            typeof role.sourceId !== 'string' ||
            !role.sourceId.trim() ||
            typeof role.position !== 'number' ||
            !Number.isInteger(role.position) ||
            role.position <= 0
        ) {
            return [];
        }
        return [
            {
                sourceId: role.sourceId.trim(),
                position: role.position,
                ...(typeof role.hierarchyRank === 'number' && Number.isInteger(role.hierarchyRank)
                    ? { hierarchyRank: role.hierarchyRank }
                    : {}),
            },
        ];
    });

    return roles.length === action.details.after.length ? roles : undefined;
}

function isObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

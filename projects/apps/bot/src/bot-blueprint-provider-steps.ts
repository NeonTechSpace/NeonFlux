export function toBlueprintApplyAction(step: {
    actionType: string;
    details: Record<string, unknown>;
    id: string;
    targetId: string | null;
    targetType: string;
}) {
    const changes = readChanges(step.details.changes);
    return {
        id: step.id,
        actionType: step.actionType,
        targetType: step.targetType,
        ...(step.targetId ? { targetId: step.targetId } : {}),
        after: step.details.after,
        ...(changes ? { changes } : {}),
    };
}

export function readBlueprintTargetKinds(value: unknown): Record<string, 'role' | 'category' | 'channel'> {
    if (!isObject(value)) return {};
    return Object.fromEntries(
        Object.entries(value).filter(
            (entry): entry is [string, 'role' | 'category' | 'channel'] =>
                Boolean(entry[0].trim()) &&
                entry[0] === entry[0].trim() &&
                (entry[1] === 'role' || entry[1] === 'category' || entry[1] === 'channel')
        )
    );
}

export function readResolvedBlueprintSourceTargetMap(value: unknown): Record<string, string> {
    if (!isObject(value)) return {};
    return Object.fromEntries(
        Object.entries(value).filter(
            (entry): entry is [string, string] =>
                Boolean(entry[0].trim()) &&
                entry[0] === entry[0].trim() &&
                typeof entry[1] === 'string' &&
                Boolean(entry[1].trim()) &&
                entry[1] === entry[1].trim()
        )
    );
}

function readChanges(value: unknown) {
    if (!Array.isArray(value)) return undefined;
    return value.flatMap((change) =>
        isObject(change) && typeof change.field === 'string'
            ? [
                  {
                      field: change.field,
                      ...(change.before !== undefined ? { before: change.before } : {}),
                      after: change.after,
                  },
              ]
            : []
    );
}

function isObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}

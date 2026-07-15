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

import type { FluxerGuildStructurePlannedAction, FluxerGuildStructurePolicy } from './guild-structure-plan.js';

type PermissionOverwrite = {
    allow: string;
    deny: string;
    id: string;
    type: 0 | 1;
};

type ExecutionOperation =
    | 'create'
    | 'delete'
    | 'update'
    | 'update-metadata'
    | 'update-placement'
    | 'channel-order'
    | 'role-order'
    | 'permission-overwrite-delete'
    | 'permission-overwrite-upsert';

export function buildFluxerGuildStructureExecutionActions(
    logicalActions: readonly FluxerGuildStructurePlannedAction[],
    policy: FluxerGuildStructurePolicy
): FluxerGuildStructurePlannedAction[] {
    return orderFluxerGuildStructureActions(logicalActions, policy).flatMap((action, logicalIndex) => {
        const steps = expandLogicalAction(action);
        const groupId = [
            'logical',
            String(logicalIndex).padStart(6, '0'),
            action.actionType,
            action.targetType,
            action.targetId ?? 'none',
        ].join(':');
        return steps.map(({ action: step, operation }, stepIndex) => ({
            ...step,
            details: {
                ...step.details,
                execution: {
                    groupId,
                    operation,
                    step: stepIndex + 1,
                    stepCount: steps.length,
                },
                mutationSteps: 1,
            },
        }));
    });
}

export function orderFluxerGuildStructureActions<
    TAction extends {
        actionType: string;
        sequence?: number;
        targetType: string;
    },
>(actions: readonly TAction[], policy: FluxerGuildStructurePolicy): TAction[] {
    return actions
        .map((action, index) => ({ action, index }))
        .sort((left, right) => compareStructureActions(left, right, policy))
        .map(({ action }) => action);
}

function expandLogicalAction(
    action: FluxerGuildStructurePlannedAction
): Array<{ action: FluxerGuildStructurePlannedAction; operation: ExecutionOperation }> {
    if (action.actionType === 'create' && (action.targetType === 'category' || action.targetType === 'channel')) {
        return expandChannelCreate(action);
    }
    if (action.actionType === 'update' && (action.targetType === 'category' || action.targetType === 'channel')) {
        return expandChannelUpdate(action);
    }
    return [
        {
            action,
            operation:
                action.targetType === 'channel-order'
                    ? 'channel-order'
                    : action.targetType === 'role-order'
                      ? 'role-order'
                      : action.actionType,
        },
    ];
}

function expandChannelCreate(
    action: FluxerGuildStructurePlannedAction
): Array<{ action: FluxerGuildStructurePlannedAction; operation: ExecutionOperation }> {
    const after = recordValue(action.details.after);
    if (!after) throw new Error('structure-execution-plan-create-invalid');
    const overwrites = permissionOverwrites(after.permissionOverwrites);
    const createAction = {
        ...action,
        details: {
            ...action.details,
            after: { ...after, permissionOverwrites: [] },
        },
    };
    return [
        { action: createAction, operation: 'create' },
        ...overwrites.map((overwrite) => ({
            action: permissionOverwriteAction(action, [], [overwrite]),
            operation: 'permission-overwrite-upsert' as const,
        })),
    ];
}

function expandChannelUpdate(
    action: FluxerGuildStructurePlannedAction
): Array<{ action: FluxerGuildStructurePlannedAction; operation: ExecutionOperation }> {
    if (!Array.isArray(action.details.changes)) throw new Error('structure-execution-plan-update-invalid');
    const changes = action.details.changes.map((change) => {
        const record = recordValue(change);
        if (!record || typeof record.field !== 'string') throw new Error('structure-execution-plan-update-invalid');
        return record;
    });
    const changeFields = changes.map((change) => change.field as string);
    if (new Set(changeFields).size !== changeFields.length) throw new Error('structure-execution-plan-update-invalid');
    const metadataChanges = changes.filter((change) => change.field === 'name');
    const placementChanges = changes.filter((change) => change.field === 'parentId' || change.field === 'position');
    const unsupportedCoreChanges = changes.filter(
        (change) =>
            change.field !== 'name' &&
            change.field !== 'parentId' &&
            change.field !== 'position' &&
            change.field !== 'permissionOverwrites'
    );
    if (unsupportedCoreChanges.length > 0) throw new Error('structure-execution-plan-update-invalid');
    const overwriteChanges = changes.filter((change) => change.field === 'permissionOverwrites');
    if (overwriteChanges.length > 1) throw new Error('structure-execution-plan-update-invalid');

    const steps: Array<{ action: FluxerGuildStructurePlannedAction; operation: ExecutionOperation }> = [];
    if (metadataChanges.length > 0) {
        steps.push({
            action: { ...action, details: { ...action.details, changes: metadataChanges } },
            operation: 'update-metadata',
        });
    }
    if (placementChanges.length > 0) {
        steps.push({
            action: { ...action, details: { ...action.details, changes: placementChanges } },
            operation: 'update-placement',
        });
    }
    const overwriteChange = overwriteChanges[0];
    if (overwriteChange) {
        const before = permissionOverwrites(overwriteChange.before);
        const after = permissionOverwrites(overwriteChange.after);
        const beforeByKey = new Map(before.map((overwrite) => [permissionOverwriteKey(overwrite), overwrite]));
        const afterByKey = new Map(after.map((overwrite) => [permissionOverwriteKey(overwrite), overwrite]));
        for (const [key, overwrite] of [...beforeByKey].sort(compareKeyedOverwrite)) {
            if (!afterByKey.has(key)) {
                steps.push({
                    action: permissionOverwriteAction(action, [overwrite], []),
                    operation: 'permission-overwrite-delete',
                });
            }
        }
        for (const [key, overwrite] of [...afterByKey].sort(compareKeyedOverwrite)) {
            const previous = beforeByKey.get(key);
            if (!previous || !samePermissionOverwrite(previous, overwrite)) {
                steps.push({
                    action: permissionOverwriteAction(action, previous ? [previous] : [], [overwrite]),
                    operation: 'permission-overwrite-upsert',
                });
            }
        }
    }
    if (steps.length === 0) throw new Error('structure-execution-plan-update-empty');
    return steps;
}

function permissionOverwriteAction(
    logicalAction: FluxerGuildStructurePlannedAction,
    before: PermissionOverwrite[],
    after: PermissionOverwrite[]
): FluxerGuildStructurePlannedAction {
    return {
        actionType: 'update',
        targetType: logicalAction.targetType,
        ...(logicalAction.targetId ? { targetId: logicalAction.targetId } : {}),
        label: logicalAction.label,
        details: {
            label: logicalAction.label,
            changes: [{ field: 'permissionOverwrites', before, after }],
        },
    };
}

function permissionOverwrites(value: unknown): PermissionOverwrite[] {
    if (!Array.isArray(value)) throw new Error('structure-execution-plan-overwrites-invalid');
    const result = value.map((item): PermissionOverwrite => {
        const overwrite = recordValue(item);
        if (
            !overwrite ||
            typeof overwrite.id !== 'string' ||
            !overwrite.id.trim() ||
            (overwrite.type !== 0 && overwrite.type !== 1) ||
            typeof overwrite.allow !== 'string' ||
            typeof overwrite.deny !== 'string'
        ) {
            throw new Error('structure-execution-plan-overwrites-invalid');
        }
        return {
            allow: overwrite.allow,
            deny: overwrite.deny,
            id: overwrite.id.trim(),
            type: overwrite.type,
        };
    });
    const keys = result.map(permissionOverwriteKey);
    if (new Set(keys).size !== keys.length) throw new Error('structure-execution-plan-overwrites-invalid');
    return result.sort((left, right) => permissionOverwriteKey(left).localeCompare(permissionOverwriteKey(right)));
}

function permissionOverwriteKey(overwrite: PermissionOverwrite): string {
    return `${String(overwrite.type)}:${overwrite.id}`;
}

function compareKeyedOverwrite(left: [string, PermissionOverwrite], right: [string, PermissionOverwrite]): number {
    return left[0].localeCompare(right[0]);
}

function samePermissionOverwrite(left: PermissionOverwrite, right: PermissionOverwrite): boolean {
    return left.type === right.type && left.id === right.id && left.allow === right.allow && left.deny === right.deny;
}

function compareStructureActions<TAction extends { actionType: string; sequence?: number; targetType: string }>(
    left: { action: TAction; index: number },
    right: { action: TAction; index: number },
    policy: FluxerGuildStructurePolicy
): number {
    return (
        readTerminalOrder(left.action) - readTerminalOrder(right.action) ||
        readActionTypeOrder(left.action.actionType, policy) - readActionTypeOrder(right.action.actionType, policy) ||
        readTargetOrder(left.action, policy) - readTargetOrder(right.action, policy) ||
        (left.action.sequence ?? left.index) - (right.action.sequence ?? right.index)
    );
}

function readTerminalOrder(action: { targetType: string }): number {
    if (action.targetType === 'channel-order') return 1;
    if (action.targetType === 'role-order') return 2;
    return 0;
}

function readActionTypeOrder(actionType: string, policy: FluxerGuildStructurePolicy): number {
    const order =
        policy === 'rebuild'
            ? new Map([
                  ['delete', 0],
                  ['create', 1],
                  ['update', 2],
              ])
            : new Map([
                  ['create', 0],
                  ['update', 1],
                  ['delete', 2],
              ]);
    return order.get(actionType) ?? 99;
}

function readTargetOrder(
    action: { actionType: string; targetType: string },
    policy: FluxerGuildStructurePolicy
): number {
    if (action.actionType === 'create') {
        return readOrder(
            action.targetType,
            new Map([
                ['role', 0],
                ['category', 1],
                ['channel', 2],
            ])
        );
    }
    if (action.actionType === 'delete') {
        return readOrder(
            action.targetType,
            new Map([
                ['channel', 0],
                ['category', 1],
                ['role', 2],
            ])
        );
    }
    return readOrder(
        action.targetType,
        policy === 'rebuild'
            ? new Map([
                  ['role', 0],
                  ['category', 1],
                  ['channel', 2],
              ])
            : new Map([
                  ['category', 0],
                  ['channel', 1],
                  ['role', 2],
              ])
    );
}

function readOrder(value: string, order: ReadonlyMap<string, number>): number {
    return order.get(value) ?? 99;
}

function recordValue(value: unknown): Record<string, unknown> | undefined {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : undefined;
}

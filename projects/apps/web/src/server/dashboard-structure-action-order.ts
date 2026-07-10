import type { DashboardStructurePolicy } from './dashboard-structure-v2.js';

type StructureActionForOrdering = {
    actionType: string;
    sequence?: number;
    targetType: string;
};

export function orderDashboardStructureImportActions<TAction extends StructureActionForOrdering>(
    actions: readonly TAction[],
    policy: DashboardStructurePolicy
): TAction[] {
    return actions
        .map((action, index) => ({ action, index }))
        .sort((left, right) => compareStructureActions(left, right, policy))
        .map(({ action }) => action);
}

function compareStructureActions<TAction extends StructureActionForOrdering>(
    left: { action: TAction; index: number },
    right: { action: TAction; index: number },
    policy: DashboardStructurePolicy
): number {
    return (
        readTerminalOrder(left.action) - readTerminalOrder(right.action) ||
        readActionTypeOrder(left.action.actionType, policy) - readActionTypeOrder(right.action.actionType, policy) ||
        readTargetOrder(left.action, policy) - readTargetOrder(right.action, policy) ||
        (left.action.sequence ?? left.index) - (right.action.sequence ?? right.index)
    );
}

function readTerminalOrder(action: StructureActionForOrdering): number {
    if (action.targetType === 'channel-order') return 1;
    if (action.targetType === 'role-order') return 2;
    return 0;
}

function readActionTypeOrder(actionType: string, policy: DashboardStructurePolicy): number {
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

function readTargetOrder(action: StructureActionForOrdering, policy: DashboardStructurePolicy): number {
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

    const updateOrder =
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
              ]);

    return readOrder(action.targetType, updateOrder);
}

function readOrder(value: string, order: ReadonlyMap<string, number>): number {
    return order.get(value) ?? 99;
}

export type DashboardStructureImportMode = 'merge' | 'replace';

type StructureActionForOrdering = {
    actionType: string;
    sequence?: number;
    targetType: string;
};

export function orderDashboardStructureImportActions<TAction extends StructureActionForOrdering>(
    actions: readonly TAction[],
    importMode: DashboardStructureImportMode
): TAction[] {
    return actions
        .map((action, index) => ({ action, index }))
        .sort((left, right) => compareStructureActions(left, right, importMode))
        .map(({ action }) => action);
}

function compareStructureActions<TAction extends StructureActionForOrdering>(
    left: { action: TAction; index: number },
    right: { action: TAction; index: number },
    importMode: DashboardStructureImportMode
): number {
    return (
        readActionTypeOrder(left.action.actionType, importMode) -
            readActionTypeOrder(right.action.actionType, importMode) ||
        readTargetOrder(left.action, importMode) - readTargetOrder(right.action, importMode) ||
        (left.action.sequence ?? left.index) - (right.action.sequence ?? right.index)
    );
}

function readActionTypeOrder(actionType: string, importMode: DashboardStructureImportMode): number {
    const order =
        importMode === 'replace'
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

function readTargetOrder(action: StructureActionForOrdering, importMode: DashboardStructureImportMode): number {
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
        importMode === 'replace'
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

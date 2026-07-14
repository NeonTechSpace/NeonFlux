import type {
    BlueprintCategoryPlanStep,
    BlueprintChannelPlanStep,
    BlueprintProviderOperation,
    BlueprintPlanStep,
    BlueprintPlanStepProviderMetadata,
    BlueprintPolicy,
} from './plan.js';

type PermissionOverwrite = {
    allow: string;
    deny: string;
    id: string;
    type: 0 | 1;
};

type BlueprintChannelEntityPlanStep = BlueprintCategoryPlanStep | BlueprintChannelPlanStep;
type BlueprintChannelCreatePlanStep = Extract<BlueprintChannelEntityPlanStep, { actionType: 'create' }>;
type BlueprintChannelUpdatePlanStep = Extract<BlueprintChannelEntityPlanStep, { actionType: 'update' }>;

export function buildBlueprintProviderSteps(
    changes: readonly BlueprintPlanStep[],
    policy: BlueprintPolicy
): BlueprintPlanStep[] {
    return orderBlueprintPlanSteps(changes, policy).flatMap((step, changeIndex) => {
        const steps = expandLogicalAction(step);
        const groupId = [
            'logical',
            String(changeIndex).padStart(6, '0'),
            step.actionType,
            step.targetType,
            step.targetId,
        ].join(':');
        return steps.map(({ step: step, operation }, stepIndex) =>
            withProviderMetadata(step, {
                groupId,
                operation,
                step: stepIndex + 1,
                stepCount: steps.length,
            })
        );
    });
}

function withProviderMetadata(step: BlueprintPlanStep, provider: BlueprintPlanStepProviderMetadata): BlueprintPlanStep {
    return {
        ...step,
        details: { ...step.details, provider, mutationSteps: 1 },
    } as BlueprintPlanStep;
}

export function orderBlueprintPlanSteps<
    TStep extends {
        actionType: string;
        sequence?: number;
        targetType: string;
    },
>(steps: readonly TStep[], policy: BlueprintPolicy): TStep[] {
    return steps
        .map((step, index) => ({ step, index }))
        .sort((left, right) => compareBlueprintPlanSteps(left, right, policy))
        .map(({ step }) => step);
}

function expandLogicalAction(
    step: BlueprintPlanStep
): Array<{ step: BlueprintPlanStep; operation: BlueprintProviderOperation }> {
    if (step.actionType === 'create' && (step.targetType === 'category' || step.targetType === 'channel')) {
        return expandChannelCreate(step);
    }
    if (step.actionType === 'update' && (step.targetType === 'category' || step.targetType === 'channel')) {
        return expandChannelUpdate(step);
    }
    return [
        {
            step,
            operation:
                step.targetType === 'channel-order'
                    ? 'channel-order'
                    : step.targetType === 'role-order'
                      ? 'role-order'
                      : step.actionType,
        },
    ];
}

function expandChannelCreate(
    step: BlueprintChannelCreatePlanStep
): Array<{ step: BlueprintPlanStep; operation: BlueprintProviderOperation }> {
    const after = step.details.after;
    const overwrites = permissionOverwrites(after.permissionOverwrites);
    const createAction = {
        ...step,
        details: {
            ...step.details,
            after: { ...after, permissionOverwrites: [] },
        },
    } as BlueprintChannelCreatePlanStep;
    return [
        { step: createAction, operation: 'create' },
        ...overwrites.map((overwrite) => ({
            step: permissionOverwriteAction(step, [], [overwrite]),
            operation: 'permission-overwrite-upsert' as const,
        })),
    ];
}

function expandChannelUpdate(
    step: BlueprintChannelUpdatePlanStep
): Array<{ step: BlueprintPlanStep; operation: BlueprintProviderOperation }> {
    const changes = step.details.changes;
    const changeFields = changes.map((change) => change.field);
    if (new Set(changeFields).size !== changeFields.length) throw new Error('structure-provider-steps-update-invalid');
    const metadataChanges = changes.filter((change) => change.field === 'name');
    const placementChanges = changes.filter((change) => change.field === 'parentId' || change.field === 'position');
    const unsupportedCoreChanges = changes.filter((change) => {
        const field: string = change.field;
        return field !== 'name' && field !== 'parentId' && field !== 'position' && field !== 'permissionOverwrites';
    });
    if (unsupportedCoreChanges.length > 0) throw new Error('structure-provider-steps-update-invalid');
    const overwriteChanges = changes.filter((change) => change.field === 'permissionOverwrites');
    if (overwriteChanges.length > 1) throw new Error('structure-provider-steps-update-invalid');

    const steps: Array<{ step: BlueprintPlanStep; operation: BlueprintProviderOperation }> = [];
    if (metadataChanges.length > 0) {
        steps.push({
            step: { ...step, details: { ...step.details, changes: metadataChanges } },
            operation: 'update-metadata',
        });
    }
    if (placementChanges.length > 0) {
        steps.push({
            step: { ...step, details: { ...step.details, changes: placementChanges } },
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
                    step: permissionOverwriteAction(step, [overwrite], []),
                    operation: 'permission-overwrite-delete',
                });
            }
        }
        for (const [key, overwrite] of [...afterByKey].sort(compareKeyedOverwrite)) {
            const previous = beforeByKey.get(key);
            if (!previous || !samePermissionOverwrite(previous, overwrite)) {
                steps.push({
                    step: permissionOverwriteAction(step, previous ? [previous] : [], [overwrite]),
                    operation: 'permission-overwrite-upsert',
                });
            }
        }
    }
    if (steps.length === 0) throw new Error('structure-provider-steps-update-empty');
    return steps;
}

function permissionOverwriteAction(
    change: BlueprintChannelCreatePlanStep | BlueprintChannelUpdatePlanStep,
    before: PermissionOverwrite[],
    after: PermissionOverwrite[]
): BlueprintPlanStep {
    return {
        actionType: 'update',
        targetType: change.targetType,
        targetId: change.targetId,
        label: change.label,
        details: {
            label: change.label,
            changes: [{ field: 'permissionOverwrites', before, after }],
        },
    };
}

function permissionOverwrites(value: unknown): PermissionOverwrite[] {
    if (!Array.isArray(value)) throw new Error('structure-provider-steps-overwrites-invalid');
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
            throw new Error('structure-provider-steps-overwrites-invalid');
        }
        return {
            allow: overwrite.allow,
            deny: overwrite.deny,
            id: overwrite.id.trim(),
            type: overwrite.type,
        };
    });
    const keys = result.map(permissionOverwriteKey);
    if (new Set(keys).size !== keys.length) throw new Error('structure-provider-steps-overwrites-invalid');
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

function compareBlueprintPlanSteps<TStep extends { actionType: string; sequence?: number; targetType: string }>(
    left: { step: TStep; index: number },
    right: { step: TStep; index: number },
    policy: BlueprintPolicy
): number {
    return (
        readTerminalOrder(left.step) - readTerminalOrder(right.step) ||
        readStepTypeOrder(left.step.actionType, policy) - readStepTypeOrder(right.step.actionType, policy) ||
        readTargetOrder(left.step, policy) - readTargetOrder(right.step, policy) ||
        (left.step.sequence ?? left.index) - (right.step.sequence ?? right.index)
    );
}

function readTerminalOrder(step: { targetType: string }): number {
    if (step.targetType === 'channel-order') return 1;
    if (step.targetType === 'role-order') return 2;
    return 0;
}

function readStepTypeOrder(actionType: string, policy: BlueprintPolicy): number {
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

function readTargetOrder(step: { actionType: string; targetType: string }, policy: BlueprintPolicy): number {
    if (step.actionType === 'create') {
        return readOrder(
            step.targetType,
            new Map([
                ['role', 0],
                ['category', 1],
                ['channel', 2],
            ])
        );
    }
    if (step.actionType === 'delete') {
        return readOrder(
            step.targetType,
            new Map([
                ['channel', 0],
                ['category', 1],
                ['role', 2],
            ])
        );
    }
    return readOrder(
        step.targetType,
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

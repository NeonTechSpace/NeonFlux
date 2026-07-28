import type { ReactionRoleMode } from './reaction-role-panel.js';

export type ReactionRoleSelectionTransition = {
    addedOptionIds: string[];
    nextOptionIds: string[];
    removedOptionIds: string[];
};

export function reduceReactionRoleSelection(input: {
    activeOptionIds: readonly string[];
    mode: ReactionRoleMode;
    optionId: string;
    selected: boolean;
}): ReactionRoleSelectionTransition {
    const current = unique(input.activeOptionIds);
    const previousSet = new Set(current);
    let next: string[];

    if (!input.selected) {
        next = current.filter((optionId) => optionId !== input.optionId);
    } else if (input.mode === 'exclusive') {
        next = [input.optionId];
    } else {
        next = previousSet.has(input.optionId) ? current : [...current, input.optionId];
    }

    const nextSet = new Set(next);
    return {
        addedOptionIds: next.filter((optionId) => !previousSet.has(optionId)),
        nextOptionIds: next,
        removedOptionIds: current.filter((optionId) => !nextSet.has(optionId)),
    };
}

export function resolveExclusiveReactionConflict(
    configuredOptionIds: readonly string[],
    selectedOptionIds: readonly string[]
): string | undefined {
    const selected = new Set(selectedOptionIds);
    return configuredOptionIds.find((optionId) => selected.has(optionId));
}

function unique(values: readonly string[]): string[] {
    return [...new Set(values)];
}

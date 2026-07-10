export function canAcceptReactionRoleTransition(input: {
    lifecycle: string | undefined;
    pendingOperationStage: string | null;
}) {
    const lifecycle = input.lifecycle ?? 'ready';
    if (lifecycle === 'ready') return true;
    return lifecycle === 'syncing' && input.pendingOperationStage !== null;
}

export function shouldReopenReactionRoleFinalization(input: {
    lifecycle: string | undefined;
    pendingOperationStage: string | null;
}) {
    return input.lifecycle === 'syncing' && input.pendingOperationStage === 'message';
}

export function shouldUseDesiredConfigForTransition(input: {
    operationStage: string | null;
    operationType: string | null;
}) {
    return input.operationType === 'save' && (input.operationStage === 'message' || input.operationStage === 'verify');
}

export function assignmentMatchesDesiredOption(
    assignment: { emojiKey: string; roleId: string },
    desiredEmojiKeys: ReadonlySet<string>,
    optionsByEmoji: ReadonlyMap<string, { roleId: string }>
) {
    return (
        desiredEmojiKeys.has(assignment.emojiKey) &&
        optionsByEmoji.get(assignment.emojiKey)?.roleId === assignment.roleId
    );
}

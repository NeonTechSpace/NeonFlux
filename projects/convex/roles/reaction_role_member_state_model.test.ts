import { describe, expect, it } from 'vitest';

import {
    assignmentMatchesDesiredOption,
    canAcceptReactionRoleTransition,
    shouldReopenReactionRoleFinalization,
    shouldUseDesiredConfigForTransition,
} from './reaction_role_member_state_model.js';

describe('reaction-role member state model', () => {
    it('persists syncing transitions and reopens finalization when one races the cutoff', () => {
        expect(canAcceptReactionRoleTransition({ lifecycle: 'syncing', pendingOperationStage: 'snapshot' })).toBe(true);
        expect(canAcceptReactionRoleTransition({ lifecycle: 'syncing', pendingOperationStage: 'verify' })).toBe(true);
        expect(canAcceptReactionRoleTransition({ lifecycle: 'syncing', pendingOperationStage: 'message' })).toBe(true);
        expect(shouldReopenReactionRoleFinalization({ lifecycle: 'syncing', pendingOperationStage: 'message' })).toBe(
            true
        );
        expect(shouldUseDesiredConfigForTransition({ operationStage: 'message', operationType: 'save' })).toBe(true);
        expect(shouldUseDesiredConfigForTransition({ operationStage: 'verify', operationType: 'save' })).toBe(true);
        expect(canAcceptReactionRoleTransition({ lifecycle: 'deleting', pendingOperationStage: 'snapshot' })).toBe(
            false
        );
    });

    it('does not overwrite an old grant identity during a role remap', () => {
        const desired = new Set(['✅']);
        const options = new Map([['✅', { roleId: 'role-new' }]]);

        expect(assignmentMatchesDesiredOption({ emojiKey: '✅', roleId: 'role-old' }, desired, options)).toBe(false);
        expect(assignmentMatchesDesiredOption({ emojiKey: '✅', roleId: 'role-new' }, desired, options)).toBe(true);
    });
});

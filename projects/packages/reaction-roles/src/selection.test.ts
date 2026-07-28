import { describe, expect, it } from 'vitest';

import { reduceReactionRoleSelection, resolveExclusiveReactionConflict } from './selection.js';

describe('reaction-role selection semantics', () => {
    it('toggles options independently', () => {
        expect(
            reduceReactionRoleSelection({
                activeOptionIds: ['one'],
                mode: 'independent',
                optionId: 'two',
                selected: true,
            })
        ).toEqual({
            addedOptionIds: ['two'],
            nextOptionIds: ['one', 'two'],
            removedOptionIds: [],
        });
    });

    it('replaces the previous option in exclusive mode', () => {
        expect(
            reduceReactionRoleSelection({
                activeOptionIds: ['one'],
                mode: 'exclusive',
                optionId: 'two',
                selected: true,
            })
        ).toEqual({
            addedOptionIds: ['two'],
            nextOptionIds: ['two'],
            removedOptionIds: ['one'],
        });
    });

    it('resolves unordered exclusive batches by configured order', () => {
        expect(resolveExclusiveReactionConflict(['one', 'two', 'three'], ['three', 'two'])).toBe('two');
    });
});

import { describe, expect, it } from 'vitest';

import { maxCurrentInviteSnapshots } from './growth_overview_model.js';
import { planGuildGrowthCurrentStateCleanup } from './growth_current_state_lifecycle.js';

describe('guild growth current-state lifecycle', () => {
    it('plans bounded removal of every invite snapshot and the guild baseline state', () => {
        expect(planGuildGrowthCurrentStateCleanup(['invite-1', 'invite-2'], 'state-1')).toStrictEqual({
            growthStateId: 'state-1',
            inviteSnapshotIds: ['invite-1', 'invite-2'],
        });
        expect(planGuildGrowthCurrentStateCleanup([], null)).toStrictEqual({
            growthStateId: null,
            inviteSnapshotIds: [],
        });
    });

    it('refuses an unbounded uninstall transaction', () => {
        const overflow = Array.from({ length: maxCurrentInviteSnapshots + 1 }, (_, index) => `invite-${String(index)}`);

        expect(() => planGuildGrowthCurrentStateCleanup(overflow, 'state-1')).toThrow('invite-snapshot-limit-exceeded');
    });
});

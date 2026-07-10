import { describe, expect, it } from 'vitest';

import {
    indexCurrentInviteSnapshotsByCode,
    maxCurrentInviteSnapshots,
    obsoleteCurrentInviteSnapshots,
} from './growth_overview.js';

describe('growth overview input bounds', () => {
    it('accepts the bounded current invite set and rejects overflow before sync planning', () => {
        const bounded = Array.from({ length: maxCurrentInviteSnapshots }, (_, index) => ({
            code: `invite-${String(index)}`,
        }));
        const overflow = [...bounded, { code: 'invite-overflow' }];

        expect(indexCurrentInviteSnapshotsByCode(bounded)).toHaveLength(maxCurrentInviteSnapshots);
        expect(() => indexCurrentInviteSnapshotsByCode(overflow)).toThrow('invite-snapshot-limit-exceeded');
    });

    it('rejects duplicate and blank current invite identities', () => {
        expect(() => indexCurrentInviteSnapshotsByCode([{ code: 'alpha' }, { code: ' alpha ' }])).toThrow(
            'invite-snapshot-identity-invalid'
        );
        expect(() => indexCurrentInviteSnapshotsByCode([{ code: ' ' }])).toThrow('invite-snapshot-identity-invalid');
    });

    it('selects missing and legacy inactive snapshots for current-state deletion', () => {
        const current = indexCurrentInviteSnapshotsByCode([{ code: 'alpha' }]);

        expect(
            obsoleteCurrentInviteSnapshots(
                [
                    { active: true, code: 'alpha' },
                    { active: true, code: 'removed' },
                    { active: false, code: 'legacy-inactive' },
                ],
                current
            )
        ).toStrictEqual([
            { active: true, code: 'removed' },
            { active: false, code: 'legacy-inactive' },
        ]);
    });
});

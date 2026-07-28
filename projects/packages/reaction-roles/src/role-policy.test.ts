import { describe, expect, it } from 'vitest';

import { evaluateReactionRoleRoleEligibility } from './role-policy.js';

describe('reaction-role role policy', () => {
    it('accepts an ordinary role below the bot', () => {
        expect(
            evaluateReactionRoleRoleEligibility({
                botHighestRolePosition: 10,
                role: { id: 'role', name: 'Updates', permissions: '0', position: 2 },
            })
        ).toEqual({ eligible: true });
    });

    it('blocks protected, privileged, and hierarchy-ineligible roles', () => {
        expect(
            evaluateReactionRoleRoleEligibility({
                botHighestRolePosition: 10,
                role: { id: 'everyone', name: '@everyone', permissions: '0', position: 0, protected: true },
            })
        ).toEqual({ eligible: false, reason: 'protected' });
        expect(
            evaluateReactionRoleRoleEligibility({
                botHighestRolePosition: 10,
                role: { id: 'admin', name: 'Admin', permissions: '8', position: 2 },
            })
        ).toEqual({ eligible: false, reason: 'privileged' });
        expect(
            evaluateReactionRoleRoleEligibility({
                botHighestRolePosition: 10,
                role: { id: 'inviter', name: 'Inviter', permissions: '1', position: 2 },
            })
        ).toEqual({ eligible: false, reason: 'privileged' });
        expect(
            evaluateReactionRoleRoleEligibility({
                botHighestRolePosition: 10,
                role: { id: 'future-bit', name: 'Future permission', permissions: '36028797018963968', position: 2 },
            })
        ).toEqual({ eligible: false, reason: 'privileged' });
        expect(
            evaluateReactionRoleRoleEligibility({
                botHighestRolePosition: 10,
                role: {
                    id: 'member-browser',
                    name: 'Member browser',
                    permissions: '18014398509481984',
                    position: 2,
                },
            })
        ).toEqual({ eligible: false, reason: 'privileged' });
        expect(
            evaluateReactionRoleRoleEligibility({
                botHighestRolePosition: 10,
                role: { id: 'high', name: 'High', permissions: '0', position: 10 },
            })
        ).toEqual({ eligible: false, reason: 'hierarchy' });
    });
});

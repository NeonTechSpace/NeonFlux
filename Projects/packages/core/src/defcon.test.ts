import { describe, expect, it } from 'vitest';

import {
    authorizeCommandAction,
    authorizeDashboardAccess,
    resolveEffectiveGuildDefcon,
    type DefconActor,
} from './defcon.js';

const serverOwner: DefconActor = {
    userId: 'owner',
    isServerOwner: true,
    hasManageServer: true,
};

const manager: DefconActor = {
    userId: 'manager',
    roleIds: ['manager-role'],
    isServerOwner: false,
    hasManageServer: true,
};

const member: DefconActor = {
    userId: 'member',
    roleIds: ['member-role'],
    isServerOwner: false,
    hasManageServer: false,
};

describe('resolveEffectiveGuildDefcon', () => {
    it('uses forced env override before stored policy', () => {
        expect(
            resolveEffectiveGuildDefcon({
                appEnv: 'production',
                override: 1,
                storedLevel: 3,
            })
        ).toBe(1);
        expect(
            resolveEffectiveGuildDefcon({
                appEnv: 'development',
                override: 3,
                storedLevel: 1,
            })
        ).toBe(3);
    });

    it('defaults production auto to stored policy or DEFCON 3', () => {
        expect(resolveEffectiveGuildDefcon({ appEnv: 'production', override: 'auto', storedLevel: 1 })).toBe(1);
        expect(resolveEffectiveGuildDefcon({ appEnv: 'production', override: 'auto' })).toBe(3);
    });

    it('defaults development auto to at least DEFCON 2 unless policy is stricter', () => {
        expect(resolveEffectiveGuildDefcon({ appEnv: 'development', override: 'auto', storedLevel: 3 })).toBe(2);
        expect(resolveEffectiveGuildDefcon({ appEnv: 'development', override: 'auto', storedLevel: 1 })).toBe(1);
        expect(resolveEffectiveGuildDefcon({ appEnv: 'development', override: 'auto' })).toBe(2);
    });
});

describe('authorizeCommandAction', () => {
    it('always allows the server owner', () => {
        expect(
            authorizeCommandAction({
                appEnv: 'production',
                override: 1,
                actor: serverOwner,
                category: 'prefix',
                audience: 'guarded',
            })
        ).toStrictEqual({
            allowed: true,
            effectiveDefconLevel: 1,
        });
    });

    it('allows public command categories in DEFCON 2', () => {
        expect(
            authorizeCommandAction({
                appEnv: 'production',
                override: 2,
                actor: member,
                category: 'bot_mention',
                audience: 'public',
            }).allowed
        ).toBe(true);
    });

    it('blocks guarded commands in DEFCON 2 for non-owners', () => {
        expect(
            authorizeCommandAction({
                appEnv: 'production',
                override: 2,
                actor: manager,
                category: 'prefix',
                audience: 'guarded',
            })
        ).toStrictEqual({
            allowed: false,
            effectiveDefconLevel: 2,
            reason: 'defcon-two-owner-only',
        });
    });

    it('allows DEFCON 1 public command exemptions only for configured categories', () => {
        expect(
            authorizeCommandAction({
                appEnv: 'production',
                override: 1,
                actor: member,
                category: 'bot_mention',
                audience: 'public',
                defconOneExemptCategories: ['bot_mention'],
            }).allowed
        ).toBe(true);
        expect(
            authorizeCommandAction({
                appEnv: 'production',
                override: 1,
                actor: member,
                category: 'prefix',
                audience: 'guarded',
                defconOneExemptCategories: ['bot_mention'],
            })
        ).toStrictEqual({
            allowed: false,
            effectiveDefconLevel: 1,
            reason: 'defcon-one-owner-only',
        });
    });

    it('allows DEFCON 3 guarded commands through Manage Server or command grants', () => {
        expect(
            authorizeCommandAction({
                appEnv: 'production',
                override: 3,
                actor: manager,
                category: 'prefix',
                audience: 'guarded',
            }).allowed
        ).toBe(true);
        expect(
            authorizeCommandAction({
                appEnv: 'production',
                override: 3,
                actor: member,
                category: 'prefix',
                audience: 'guarded',
                commandGrant: { roleIds: ['member-role'] },
            }).allowed
        ).toBe(true);
    });

    it('does not use dashboard grants for command authorization', () => {
        expect(
            authorizeCommandAction({
                appEnv: 'production',
                override: 3,
                actor: member,
                category: 'prefix',
                audience: 'guarded',
            })
        ).toStrictEqual({
            allowed: false,
            effectiveDefconLevel: 3,
            reason: 'missing-command-permission',
        });
    });
});

describe('authorizeDashboardAccess', () => {
    it('allows dashboard access for the server owner', () => {
        expect(
            authorizeDashboardAccess({
                appEnv: 'production',
                override: 1,
                actor: serverOwner,
            }).allowed
        ).toBe(true);
    });

    it('blocks dashboard access in DEFCON 1 and DEFCON 2 for non-owners', () => {
        expect(
            authorizeDashboardAccess({
                appEnv: 'production',
                override: 1,
                actor: manager,
            })
        ).toStrictEqual({
            allowed: false,
            effectiveDefconLevel: 1,
            reason: 'defcon-one-owner-only',
        });
        expect(
            authorizeDashboardAccess({
                appEnv: 'production',
                override: 2,
                actor: manager,
            })
        ).toStrictEqual({
            allowed: false,
            effectiveDefconLevel: 2,
            reason: 'defcon-two-owner-only',
        });
    });

    it('allows DEFCON 3 dashboard access through Manage Server or dashboard grants', () => {
        expect(
            authorizeDashboardAccess({
                appEnv: 'production',
                override: 3,
                actor: manager,
            }).allowed
        ).toBe(true);
        expect(
            authorizeDashboardAccess({
                appEnv: 'production',
                override: 3,
                actor: member,
                dashboardGrant: { userIds: ['member'] },
            }).allowed
        ).toBe(true);
    });

    it('does not use command grants for dashboard authorization', () => {
        expect(
            authorizeDashboardAccess({
                appEnv: 'production',
                override: 3,
                actor: member,
            })
        ).toStrictEqual({
            allowed: false,
            effectiveDefconLevel: 3,
            reason: 'missing-dashboard-permission',
        });
    });
});

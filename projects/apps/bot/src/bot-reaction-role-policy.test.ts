import { readReactionRoleExecutionPolicy } from '@neonflux/db';
import type * as NeonFluxDb from '@neonflux/db';
import { err, ok } from 'neverthrow';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { BotFeatureHandlerContext } from './bot-feature-types.js';
import { reactionRolesAllowed } from './bot-reaction-role-policy.js';

vi.mock('@neonflux/db', async (importActual) => ({
    ...(await importActual<typeof NeonFluxDb>()),
    readReactionRoleExecutionPolicy: vi.fn(),
}));

describe('reactionRolesAllowed', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('allows an installed in-scope guild when effective DEFCON is not critical', async () => {
        vi.mocked(readReactionRoleExecutionPolicy).mockResolvedValue(ok({ botInstalled: true, storedDefconLevel: 2 }));

        await expect(reactionRolesAllowed(createContext(), 'guild-1')).resolves.toBe(true);
        expect(readReactionRoleExecutionPolicy).toHaveBeenCalledWith(expect.anything(), { guildId: 'guild-1' });
    });

    it('fails closed for missing installation, critical DEFCON, or a policy read failure', async () => {
        vi.mocked(readReactionRoleExecutionPolicy)
            .mockResolvedValueOnce(ok({ botInstalled: false, storedDefconLevel: 2 }))
            .mockResolvedValueOnce(ok({ botInstalled: true, storedDefconLevel: 1 }))
            .mockResolvedValueOnce(err({ type: 'database-error' }));

        await expect(reactionRolesAllowed(createContext(), 'guild-1')).resolves.toBe(false);
        await expect(reactionRolesAllowed(createContext(), 'guild-1')).resolves.toBe(false);
        await expect(reactionRolesAllowed(createContext(), 'guild-1')).resolves.toBe(false);
    });

    it('rejects an out-of-scope guild without reading policy state', async () => {
        await expect(
            reactionRolesAllowed(createContext({ instanceMode: 'single', singleGuildId: 'guild-2' }), 'guild-1')
        ).resolves.toBe(false);
        expect(readReactionRoleExecutionPolicy).not.toHaveBeenCalled();
    });
});

function createContext(mode: BotFeatureHandlerContext['mode'] = { instanceMode: 'multi' }): BotFeatureHandlerContext {
    return {
        appEnv: 'production',
        client: {} as BotFeatureHandlerContext['client'],
        db: {} as BotFeatureHandlerContext['db'],
        guildDefconOverride: 'auto',
        logger: { warn: vi.fn() },
        mode,
    };
}

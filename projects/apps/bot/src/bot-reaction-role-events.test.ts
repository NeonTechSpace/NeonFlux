import { readReactionRoleExecutionPolicy, recordReactionRoleReactionIntent } from '@neonflux/db';
import type * as NeonFluxDb from '@neonflux/db';
import { ok } from 'neverthrow';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { BotFeatureHandlerContext } from './bot-feature-types.js';
import { handleBotReactionRoleEvent } from './bot-reaction-role-events.js';

vi.mock('@neonflux/db', async (importActual) => ({
    ...(await importActual<typeof NeonFluxDb>()),
    readReactionRoleExecutionPolicy: vi.fn(),
    recordReactionRoleReactionIntent: vi.fn(),
}));

describe('handleBotReactionRoleEvent', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('ignores the local selected-reaction event emitted after the bot seeds a reaction', async () => {
        const result = await handleBotReactionRoleEvent(createContext(), createBotReactionEvent(true));

        expect(result).toBe('ignored');
        expect(readReactionRoleExecutionPolicy).not.toHaveBeenCalled();
        expect(recordReactionRoleReactionIntent).not.toHaveBeenCalled();
    });

    it('keeps bot reaction removals so seed repair can observe them', async () => {
        vi.mocked(readReactionRoleExecutionPolicy).mockResolvedValue(ok({ botInstalled: true, storedDefconLevel: 2 }));
        vi.mocked(recordReactionRoleReactionIntent).mockResolvedValue(ok({ type: 'ignored' }));

        const result = await handleBotReactionRoleEvent(createContext(), createBotReactionEvent(false));

        expect(result).toBe('ignored');
        expect(recordReactionRoleReactionIntent).toHaveBeenCalledWith(expect.anything(), {
            channelId: 'channel-1',
            emoji: { kind: 'unicode', value: '✅' },
            guildId: 'guild-1',
            messageId: 'message-1',
            selected: false,
            userId: 'bot-user',
            userIsBot: true,
        });
    });
});

function createContext(): BotFeatureHandlerContext {
    return {
        appEnv: 'production',
        botUserId: 'bot-user',
        client: {} as BotFeatureHandlerContext['client'],
        db: {} as BotFeatureHandlerContext['db'],
        guildDefconOverride: 'auto',
        logger: { warn: vi.fn() },
        mode: { instanceMode: 'multi' },
    };
}

function createBotReactionEvent(selected: boolean) {
    return {
        channelId: 'channel-1',
        emoji: { kind: 'unicode', value: '✅' } as const,
        guildId: 'guild-1',
        messageId: 'message-1',
        selected,
        type: 'reaction' as const,
        userId: 'bot-user',
        userIsBot: true,
    };
}

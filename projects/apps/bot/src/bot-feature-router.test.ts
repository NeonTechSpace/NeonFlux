import { err, ok } from 'neverthrow';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { BotFeatureRoutingContext } from './bot-feature-types.js';
import { routeBotFeatureEvent } from './bot-feature-router.js';

const { recordBotInstallationEvent, removeBotInstallationEvent } = vi.hoisted(() => ({
    recordBotInstallationEvent: vi.fn(),
    removeBotInstallationEvent: vi.fn(),
}));

vi.mock('./bot-installation-sync.js', () => ({
    recordBotInstallationEvent,
    removeBotInstallationEvent,
}));

describe('guild availability routing', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        recordBotInstallationEvent.mockResolvedValue(ok({ status: 'recorded', guildId: 'guild-1' }));
        removeBotInstallationEvent.mockResolvedValue(ok({ status: 'removed', guildId: 'guild-1' }));
    });

    it.each(['guild.lifecycle.created', 'guild.lifecycle.available'] as const)(
        'upserts installation state for %s',
        async (type) => {
            const result = await routeBotFeatureEvent(createContext(), { type, guildId: 'guild-1' });

            expect(result).toStrictEqual(ok({ eventType: type, status: 'handled' }));
            expect(recordBotInstallationEvent).toHaveBeenCalledWith(
                {},
                { instanceMode: 'multi' },
                {
                    guildId: 'guild-1',
                }
            );
            expect(removeBotInstallationEvent).not.toHaveBeenCalled();
        }
    );

    it('does not delete installation state while a guild is temporarily unavailable', async () => {
        const result = await routeBotFeatureEvent(createContext(), {
            type: 'guild.lifecycle.unavailable',
            guildId: 'guild-1',
        });

        expect(result).toStrictEqual(
            ok({ eventType: 'guild.lifecycle.unavailable', status: 'ignored', reason: 'no-feature-handler' })
        );
        expect(recordBotInstallationEvent).not.toHaveBeenCalled();
        expect(removeBotInstallationEvent).not.toHaveBeenCalled();
    });

    it('removes installation state only for a permanent guild delete', async () => {
        const result = await routeBotFeatureEvent(createContext(), {
            type: 'guild.lifecycle.deleted',
            guildId: 'guild-1',
        });

        expect(result).toStrictEqual(ok({ eventType: 'guild.lifecycle.deleted', status: 'handled' }));
        expect(removeBotInstallationEvent).toHaveBeenCalledWith(
            {},
            { instanceMode: 'multi' },
            {
                guildId: 'guild-1',
            }
        );
    });

    it('maps installation persistence failures without falling through to feature handlers', async () => {
        recordBotInstallationEvent.mockResolvedValue(err('database-error'));

        const result = await routeBotFeatureEvent(createContext(), {
            type: 'guild.lifecycle.available',
            guildId: 'guild-1',
        });

        expect(result).toStrictEqual(err('database-error'));
    });
});

function createContext(): BotFeatureRoutingContext {
    return {
        appEnv: 'production',
        client: {} as BotFeatureRoutingContext['client'],
        db: {} as BotFeatureRoutingContext['db'],
        growthTelemetry: { enqueue: vi.fn(() => 'accepted' as const) },
        guildDefconOverride: 'auto',
        logger: { warn: vi.fn() },
        mode: { instanceMode: 'multi' },
    };
}

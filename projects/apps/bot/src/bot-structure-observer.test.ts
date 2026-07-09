import { recordStructureObservedEvent } from '@neonflux/db';
import { err, ok } from 'neverthrow';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { routeBotFeatureEvent } from './bot-feature-router.js';
import type { BotFeatureHandlerContext } from './bot-feature-types.js';
import { recordObservedStructureEvent } from './bot-structure-observer.js';

vi.mock('@neonflux/db', () => ({
    recordStructureObservedEvent: vi.fn(),
}));

const testDb = {} as BotFeatureHandlerContext['db'];
const testClient = {} as BotFeatureHandlerContext['client'];

describe('recordObservedStructureEvent', () => {
    beforeEach(() => {
        vi.resetAllMocks();
        vi.mocked(recordStructureObservedEvent).mockResolvedValue(
            ok({
                guildId: 'guild-1',
                observedChangeCount: 1,
                targetChangeCounts: { role: 1 },
            })
        );
    });

    it('records role structure changes with the import/export dashboard action', async () => {
        const result = await recordObservedStructureEvent(createContext(), {
            type: 'role.updated',
            guildId: 'guild-1',
            roleId: 'role-1',
        });

        expect(result.isOk()).toBe(true);
        expect(result._unsafeUnwrap()).toStrictEqual({
            status: 'recorded',
            action: 'event.import_export.structure_observed',
        });
        expect(recordStructureObservedEvent).toHaveBeenCalledWith(testDb, {
            guildId: 'guild-1',
            eventType: 'role.updated',
            targetType: 'role',
            targetId: 'role-1',
        });
    });

    it('routes channel structure changes through the bot feature router', async () => {
        const result = await routeBotFeatureEvent(createContext(), {
            type: 'channel.updated',
            guildId: 'guild-1',
            channelId: 'channel-1',
            channelType: 0,
        });

        expect(result.isOk()).toBe(true);
        expect(result._unsafeUnwrap()).toStrictEqual({
            eventType: 'channel.updated',
            status: 'handled',
            action: 'event.import_export.structure_observed',
        });
        expect(recordStructureObservedEvent).toHaveBeenCalledWith(testDb, {
            guildId: 'guild-1',
            eventType: 'channel.updated',
            targetType: 'channel',
            targetId: 'channel-1',
        });
    });

    it('respects single-mode guild gating before recording structure changes', async () => {
        const result = await routeBotFeatureEvent(createContext({ instanceMode: 'single', singleGuildId: 'target' }), {
            type: 'channel.updated',
            guildId: 'other',
            channelId: 'channel-1',
            channelType: 0,
        });

        expect(result.isOk()).toBe(true);
        expect(result._unsafeUnwrap()).toStrictEqual({
            eventType: 'channel.updated',
            status: 'ignored',
            reason: 'guild-not-processable',
        });
        expect(recordStructureObservedEvent).not.toHaveBeenCalled();
    });

    it('does not route unrelated bot events through the structure observer', async () => {
        const result = await routeBotFeatureEvent(createContext(), {
            type: 'voice_state.updated',
            guildId: 'guild-1',
            userId: 'user-1',
            channelId: 'channel-1',
            oldChannelId: null,
            oldChannelOccupancy: 1,
        });

        expect(result.isOk()).toBe(true);
        expect(result._unsafeUnwrap()).toStrictEqual({
            eventType: 'voice_state.updated',
            status: 'ignored',
            reason: 'no-feature-handler',
        });
        expect(recordStructureObservedEvent).not.toHaveBeenCalled();
    });

    it('maps structure database failures to router errors', async () => {
        vi.mocked(recordStructureObservedEvent).mockResolvedValueOnce(err({ type: 'database-error' }));

        const result = await routeBotFeatureEvent(createContext(), {
            type: 'guild.lifecycle.updated',
            guildId: 'guild-1',
        });

        expect(result.isErr()).toBe(true);
        expect(result._unsafeUnwrapErr()).toBe('database-error');
    });
});

function createContext(mode: BotFeatureHandlerContext['mode'] = { instanceMode: 'multi' }): BotFeatureHandlerContext {
    return {
        db: testDb,
        mode,
        appEnv: 'production',
        guildDefconOverride: 'auto',
        client: testClient,
        botUserId: 'bot-user',
    };
}

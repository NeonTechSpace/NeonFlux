import {
    findActiveGiveawayByGuildMessageId,
    removeGiveawayEntry,
    upsertGiveawayEntry,
    type GiveawayRecord,
} from '@neonflux/db';
import type * as NeonFluxDb from '@neonflux/db';
import { err, ok } from 'neverthrow';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { BotFeatureHandlerContext } from './bot-feature-types.js';
import { routeGiveawayReactionEvent } from './bot-giveaways.js';

vi.mock('@neonflux/db', async (importActual) => {
    const actual = await importActual<typeof NeonFluxDb>();

    return {
        ...actual,
        findActiveGiveawayByGuildMessageId: vi.fn(),
        removeGiveawayEntry: vi.fn(),
        upsertGiveawayEntry: vi.fn(),
    };
});

describe('routeGiveawayReactionEvent', () => {
    beforeEach(() => {
        vi.mocked(findActiveGiveawayByGuildMessageId).mockResolvedValue(ok(createGiveaway()));
        vi.mocked(upsertGiveawayEntry).mockResolvedValue(ok(createEntry()));
        vi.mocked(removeGiveawayEntry).mockResolvedValue(ok(createEntry()));
    });

    afterEach(() => {
        vi.clearAllMocks();
    });

    it('adds entries for matching active giveaway reactions', async () => {
        const result = await routeGiveawayReactionEvent(createContext(), createReactionEvent());

        expect(result._unsafeUnwrap()).toStrictEqual({
            status: 'applied',
            action: 'event.giveaways.entry_added',
        });
        expect(upsertGiveawayEntry).toHaveBeenCalledWith(
            {},
            {
                giveawayId: 'giveaway-1',
                userId: 'user-1',
            }
        );
    });

    it('removes entries when the giveaway reaction is removed', async () => {
        const result = await routeGiveawayReactionEvent(
            createContext(),
            createReactionEvent({
                type: 'reaction.removed',
            })
        );

        expect(result._unsafeUnwrap()).toStrictEqual({
            status: 'applied',
            action: 'event.giveaways.entry_removed',
        });
        expect(removeGiveawayEntry).toHaveBeenCalledWith(
            {},
            {
                giveawayId: 'giveaway-1',
                userId: 'user-1',
            }
        );
    });

    it('ignores unrelated reactions and bot-authored reactions', async () => {
        const wrongEmoji = await routeGiveawayReactionEvent(createContext(), createReactionEvent({ emojiKey: '❌' }));
        const botReaction = await routeGiveawayReactionEvent(createContext(), createReactionEvent({ userId: 'bot-1' }));

        expect(wrongEmoji._unsafeUnwrap()).toStrictEqual({
            status: 'ignored',
            reason: 'no-feature-handler',
        });
        expect(botReaction._unsafeUnwrap()).toStrictEqual({
            status: 'ignored',
            reason: 'no-feature-handler',
        });
        expect(upsertGiveawayEntry).not.toHaveBeenCalled();
    });

    it('ignores missing giveaway messages and maps database failures', async () => {
        vi.mocked(findActiveGiveawayByGuildMessageId).mockResolvedValueOnce(err({ type: 'not-found' }));
        const missing = await routeGiveawayReactionEvent(createContext(), createReactionEvent());
        vi.mocked(findActiveGiveawayByGuildMessageId).mockResolvedValueOnce(err({ type: 'database-error' }));
        const failure = await routeGiveawayReactionEvent(createContext(), createReactionEvent());

        expect(missing._unsafeUnwrap()).toStrictEqual({
            status: 'ignored',
            reason: 'no-feature-handler',
        });
        expect(failure._unsafeUnwrapErr()).toBe('database-error');
    });
});

function createContext(): BotFeatureHandlerContext {
    return {
        db: {},
        mode: {
            instanceMode: 'multi',
        },
        appEnv: 'production',
        guildDefconOverride: 'auto',
        client: {},
        botUserId: 'bot-1',
    } as BotFeatureHandlerContext;
}

function createReactionEvent(overrides: Partial<Parameters<typeof routeGiveawayReactionEvent>[1]> = {}) {
    return {
        type: 'reaction.added' as const,
        guildId: 'guild-1',
        messageId: 'message-1',
        userId: 'user-1',
        emojiKey: '🎉',
        ...overrides,
    };
}

function createGiveaway(overrides: Partial<GiveawayRecord> = {}): GiveawayRecord {
    const timestamp = new Date('2026-06-26T00:00:00.000Z');

    return {
        id: 'giveaway-1',
        guildId: 'guild-1',
        channelId: 'channel-1',
        messageId: 'message-1',
        title: 'Launch',
        prize: 'Nitro',
        description: null,
        entryEmoji: '🎉',
        winnerCount: 1,
        status: 'active',
        endsAt: null,
        createdByUserId: 'actor-1',
        closedByUserId: null,
        closedAt: null,
        config: {},
        createdAt: timestamp,
        updatedAt: timestamp,
        ...overrides,
    };
}

function createEntry() {
    const timestamp = new Date('2026-06-26T00:00:00.000Z');

    return {
        id: 'entry-1',
        giveawayId: 'giveaway-1',
        userId: 'user-1',
        enteredAt: timestamp,
        removedAt: null,
    };
}

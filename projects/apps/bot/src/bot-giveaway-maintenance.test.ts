import {
    drawGiveawayWinners,
    listExpiredActiveGiveaways,
    listReactionReconciliationGiveaways,
    listStaleActiveGiveaways,
    reconcileGiveawayEntries,
    updateGiveawaySyncStatus,
    type GiveawayRecord,
    type GiveawayWinnerRecord,
} from '@neonflux/db';
import type * as NeonFluxDb from '@neonflux/db';
import { createFluxerPlatform } from '@neonflux/fluxer';
import type * as Fluxer from '@neonflux/fluxer';
import { err, ok } from 'neverthrow';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { BotFeatureHandlerContext } from './bot-feature-types.js';
import {
    closeExpiredGiveaways,
    reconcileGiveawayReactionEntries,
    repairStaleGiveawayReactions,
    runGiveawayMaintenance,
} from './bot-giveaways.js';

vi.mock('@neonflux/db', async (importActual) => {
    const actual = await importActual<typeof NeonFluxDb>();

    return {
        ...actual,
        drawGiveawayWinners: vi.fn(),
        listExpiredActiveGiveaways: vi.fn(),
        listReactionReconciliationGiveaways: vi.fn(),
        listStaleActiveGiveaways: vi.fn(),
        reconcileGiveawayEntries: vi.fn(),
        updateGiveawaySyncStatus: vi.fn(),
    };
});

vi.mock('@neonflux/fluxer', async (importActual) => {
    const actual = await importActual<typeof Fluxer>();

    return {
        ...actual,
        createFluxerPlatform: vi.fn(),
    };
});

const sendMock = vi.fn();
const reactMock = vi.fn();
const listReactionUsersMock = vi.fn();

describe('giveaway maintenance', () => {
    beforeEach(() => {
        vi.mocked(listExpiredActiveGiveaways).mockResolvedValue(ok([createGiveaway()]));
        vi.mocked(listStaleActiveGiveaways).mockResolvedValue(
            ok([createGiveaway({ config: { syncStatus: 'stale' } })])
        );
        vi.mocked(listReactionReconciliationGiveaways).mockResolvedValue(ok([createGiveaway()]));
        vi.mocked(drawGiveawayWinners).mockResolvedValue(
            ok({
                giveaway: createGiveaway({ status: 'closed' }),
                winners: [createWinner()],
            })
        );
        vi.mocked(reconcileGiveawayEntries).mockResolvedValue(ok({ added: 1, removed: 1, kept: 1 }));
        vi.mocked(updateGiveawaySyncStatus).mockResolvedValue(ok(createGiveaway({ config: { syncStatus: 'active' } })));
        sendMock.mockResolvedValue(ok({ id: 'announcement-1', channelId: 'channel-1', guildId: 'guild-1' }));
        reactMock.mockResolvedValue(ok(undefined));
        listReactionUsersMock.mockResolvedValue(
            ok([
                { id: 'user-1', bot: false },
                { id: 'bot-1', bot: true },
                { id: 'bot-user', bot: false },
            ])
        );
        vi.mocked(createFluxerPlatform).mockReturnValue({
            messages: {
                send: sendMock,
                react: reactMock,
                listReactionUsers: listReactionUsersMock,
            },
        } as never);
    });

    afterEach(() => {
        vi.clearAllMocks();
    });

    it('closes expired active giveaways and announces winners', async () => {
        const result = await closeExpiredGiveaways(createContext(), {
            now: new Date('2026-06-26T10:00:00.000Z'),
        });

        expect(result._unsafeUnwrap()).toStrictEqual({
            expiredChecked: 1,
            closed: 1,
            closeSkipped: 0,
            closeAnnouncementFailed: 0,
        });
        expect(drawGiveawayWinners).toHaveBeenCalledWith(
            {},
            {
                guildId: 'guild-1',
                giveawayId: 'giveaway-1',
            }
        );
        expect(sendMock).toHaveBeenCalledWith({
            channelId: 'channel-1',
            content: 'Giveaway closed: Launch\nWinners: <@winner-1>',
        });
    });

    it('keeps expiry closing idempotent under race conditions', async () => {
        vi.mocked(drawGiveawayWinners).mockResolvedValueOnce(
            err({ type: 'invalid-status-transition', from: 'cancelled', to: 'closed' })
        );

        const result = await closeExpiredGiveaways(createContext(), {
            now: new Date('2026-06-26T10:00:00.000Z'),
        });

        expect(result._unsafeUnwrap()).toMatchObject({
            expiredChecked: 1,
            closed: 0,
            closeSkipped: 1,
        });
        expect(sendMock).not.toHaveBeenCalled();
    });

    it('counts announcement failures after the giveaway has been closed', async () => {
        sendMock.mockResolvedValueOnce(err({ type: 'send-failed', error: new Error('missing access') }));

        const result = await closeExpiredGiveaways(createContext(), {
            now: new Date('2026-06-26T10:00:00.000Z'),
        });

        expect(result._unsafeUnwrap()).toMatchObject({
            closed: 1,
            closeAnnouncementFailed: 1,
        });
    });

    it('repairs stale giveaway reactions and marks them synced', async () => {
        const result = await repairStaleGiveawayReactions(createContext());

        expect(result._unsafeUnwrap()).toStrictEqual({
            staleChecked: 1,
            repaired: 1,
            repairFailed: 0,
        });
        expect(reactMock).toHaveBeenCalledWith({
            channelId: 'channel-1',
            messageId: 'message-1',
            emoji: '🎉',
        });
        expect(updateGiveawaySyncStatus).toHaveBeenCalledWith(
            {},
            {
                guildId: 'guild-1',
                giveawayId: 'giveaway-1',
                syncStatus: 'active',
            }
        );
    });

    it('does not mark stale reactions repaired when reacting fails', async () => {
        reactMock.mockResolvedValueOnce(err({ type: 'react-failed', error: new Error('missing message') }));

        const result = await repairStaleGiveawayReactions(createContext());

        expect(result._unsafeUnwrap()).toStrictEqual({
            staleChecked: 1,
            repaired: 0,
            repairFailed: 1,
        });
        expect(updateGiveawaySyncStatus).not.toHaveBeenCalled();
    });

    it('runs close and repair as one maintenance pass', async () => {
        const result = await runGiveawayMaintenance(createContext(), {
            now: new Date('2026-06-26T10:00:00.000Z'),
        });

        expect(result._unsafeUnwrap()).toMatchObject({
            expiredChecked: 1,
            closed: 1,
            staleChecked: 1,
            repaired: 1,
            reactionChecked: 1,
            reactionReconciled: 1,
        });
    });

    it('reconciles giveaway entries from reaction users', async () => {
        const result = await reconcileGiveawayReactionEntries(createContext());

        expect(result._unsafeUnwrap()).toStrictEqual({
            reactionChecked: 1,
            reactionReconciled: 1,
            reactionReconcileFailed: 0,
            reactionEntriesAdded: 1,
            reactionEntriesRemoved: 1,
        });
        expect(listReactionUsersMock).toHaveBeenCalledWith({
            channelId: 'channel-1',
            messageId: 'message-1',
            emoji: '🎉',
            limit: 100,
        });
        expect(reconcileGiveawayEntries).toHaveBeenCalledWith(
            {},
            {
                giveawayId: 'giveaway-1',
                userIds: ['user-1'],
            }
        );
    });

    it('counts reaction reconciliation failures without changing entries', async () => {
        listReactionUsersMock.mockResolvedValueOnce(err({ type: 'unsupported', feature: 'message-reaction-users' }));

        const result = await reconcileGiveawayReactionEntries(createContext());

        expect(result._unsafeUnwrap()).toMatchObject({
            reactionChecked: 1,
            reactionReconciled: 0,
            reactionReconcileFailed: 1,
        });
        expect(reconcileGiveawayEntries).not.toHaveBeenCalled();
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
        botUserId: 'bot-user',
    } as BotFeatureHandlerContext;
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
        endsAt: new Date('2026-06-26T09:00:00.000Z'),
        createdByUserId: 'actor-1',
        closedByUserId: null,
        closedAt: null,
        config: {},
        createdAt: timestamp,
        updatedAt: timestamp,
        ...overrides,
    };
}

function createWinner(overrides: Partial<GiveawayWinnerRecord> = {}): GiveawayWinnerRecord {
    return {
        id: 'winner-1',
        giveawayId: 'giveaway-1',
        userId: 'winner-1',
        drawNumber: 1,
        selectedAt: new Date('2026-06-26T10:00:00.000Z'),
        ...overrides,
    };
}

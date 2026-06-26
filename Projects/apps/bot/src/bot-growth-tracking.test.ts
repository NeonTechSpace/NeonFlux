import type { AppMode } from '@neonflux/config';
import {
    incrementGuildMessageActivityDay,
    listGuildInviteSnapshots,
    recordGuildMemberFlowEvent,
    syncGuildInviteSnapshots,
} from '@neonflux/db';
import { readFluxerGuildInvites, type FluxerBot, type FluxerGuildInvite } from '@neonflux/fluxer';
import { err, ok } from 'neverthrow';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { trackGrowthOverviewEvent } from './bot-growth-tracking.js';
import type { BotFeatureHandlerContext, BotFeatureEvent } from './bot-feature-types.js';

vi.mock('@neonflux/db', () => ({
    incrementGuildMessageActivityDay: vi.fn(),
    listGuildInviteSnapshots: vi.fn(),
    recordGuildMemberFlowEvent: vi.fn(),
    syncGuildInviteSnapshots: vi.fn(),
}));

vi.mock('@neonflux/fluxer', () => ({
    readFluxerGuildInvites: vi.fn(),
}));

const testDb = {} as BotFeatureHandlerContext['db'];
const testClient = {} as FluxerBot['client'];

describe('trackGrowthOverviewEvent', () => {
    beforeEach(() => {
        vi.resetAllMocks();
        vi.mocked(incrementGuildMessageActivityDay).mockResolvedValue(ok(createMessageActivityRecord()));
        vi.mocked(listGuildInviteSnapshots).mockResolvedValue(ok([createInviteSnapshot()]));
        vi.mocked(readFluxerGuildInvites).mockResolvedValue(
            ok([
                createFluxerInvite({
                    code: 'alpha',
                    uses: 2,
                }),
            ])
        );
        vi.mocked(recordGuildMemberFlowEvent).mockResolvedValue(ok(createMemberFlowRecord()));
        vi.mocked(syncGuildInviteSnapshots).mockResolvedValue(ok([createInviteSnapshot({ uses: 2 })]));
    });

    it('respects single-mode guild gating before tracking member joins', async () => {
        const result = await trackGrowthOverviewEvent(createContext(createSingleMode()), {
            type: 'member.joined',
            guildId: 'other',
            userId: 'user-1',
            roleIds: [],
        });

        expect(result.isOk()).toBe(true);
        expect(result._unsafeUnwrap()).toStrictEqual({
            status: 'ignored',
            reason: 'guild-not-processable',
        });
        expect(listGuildInviteSnapshots).not.toHaveBeenCalled();
    });

    it('attributes member joins by comparing current invite uses against prior snapshots', async () => {
        const result = await trackGrowthOverviewEvent(createContext(createMultiMode()), {
            type: 'member.joined',
            guildId: 'guild-1',
            userId: 'user-1',
            roleIds: [],
        });

        expect(result.isOk()).toBe(true);
        expect(result._unsafeUnwrap()).toStrictEqual({ status: 'tracked' });
        expect(readFluxerGuildInvites).toHaveBeenCalledWith({
            client: testClient,
            guildId: 'guild-1',
        });
        expect(syncGuildInviteSnapshots).toHaveBeenCalledWith(testDb, {
            guildId: 'guild-1',
            invites: [
                {
                    code: 'alpha',
                    inviterUserId: 'inviter-1',
                    channelId: 'channel-1',
                    uses: 2,
                    temporary: false,
                },
            ],
        });
        expect(recordGuildMemberFlowEvent).toHaveBeenCalledWith(testDb, {
            guildId: 'guild-1',
            userId: 'user-1',
            eventType: 'join',
            attributionStatus: 'attributed',
            inviteCode: 'alpha',
            inviterUserId: 'inviter-1',
        });
    });

    it('marks joins as baseline-missing when no prior invite snapshot exists', async () => {
        vi.mocked(listGuildInviteSnapshots).mockResolvedValueOnce(ok([]));

        const result = await trackGrowthOverviewEvent(createContext(createMultiMode()), {
            type: 'member.joined',
            guildId: 'guild-1',
            userId: 'user-1',
            roleIds: [],
        });

        expect(result.isOk()).toBe(true);
        expect(recordGuildMemberFlowEvent).toHaveBeenCalledWith(testDb, {
            guildId: 'guild-1',
            userId: 'user-1',
            eventType: 'join',
            attributionStatus: 'baseline-missing',
        });
    });

    it('marks joins as unavailable when invite reading is denied', async () => {
        vi.mocked(readFluxerGuildInvites).mockResolvedValueOnce(err({ type: 'permission-denied' }));

        const result = await trackGrowthOverviewEvent(createContext(createMultiMode()), {
            type: 'member.joined',
            guildId: 'guild-1',
            userId: 'user-1',
            roleIds: [],
        });

        expect(result.isOk()).toBe(true);
        expect(syncGuildInviteSnapshots).not.toHaveBeenCalled();
        expect(recordGuildMemberFlowEvent).toHaveBeenCalledWith(testDb, {
            guildId: 'guild-1',
            userId: 'user-1',
            eventType: 'join',
            attributionStatus: 'unavailable',
        });
    });

    it('records member leaves without invite attribution', async () => {
        const result = await trackGrowthOverviewEvent(createContext(createMultiMode()), {
            type: 'member.left',
            guildId: 'guild-1',
            userId: 'user-1',
            roleIds: [],
        });

        expect(result.isOk()).toBe(true);
        expect(recordGuildMemberFlowEvent).toHaveBeenCalledWith(testDb, {
            guildId: 'guild-1',
            userId: 'user-1',
            eventType: 'leave',
            attributionStatus: 'not-applicable',
        });
    });

    it('increments message activity for non-bot guild messages', async () => {
        const result = await trackGrowthOverviewEvent(createContext(createMultiMode()), createMessageEvent());

        expect(result.isOk()).toBe(true);
        expect(result._unsafeUnwrap()).toStrictEqual({ status: 'tracked' });
        expect(incrementGuildMessageActivityDay).toHaveBeenCalledWith(testDb, {
            guildId: 'guild-1',
            channelId: 'channel-1',
        });
    });

    it('ignores bot-authored messages before counting activity', async () => {
        const result = await trackGrowthOverviewEvent(
            createContext(createMultiMode()),
            createMessageEvent({ authorIsBot: true })
        );

        expect(result.isOk()).toBe(true);
        expect(result._unsafeUnwrap()).toStrictEqual({
            status: 'ignored',
            reason: 'bot-authored-message',
        });
        expect(incrementGuildMessageActivityDay).not.toHaveBeenCalled();
    });
});

function createContext(mode: AppMode): BotFeatureHandlerContext {
    return {
        db: testDb,
        mode,
        appEnv: 'production',
        guildDefconOverride: 'auto',
        client: testClient,
        botUserId: 'bot-user',
    };
}

function createSingleMode(): AppMode {
    return {
        instanceMode: 'single',
        singleGuildId: 'target',
    };
}

function createMultiMode(): AppMode {
    return {
        instanceMode: 'multi',
    };
}

function createMessageEvent(
    overrides: Partial<Extract<BotFeatureEvent, { type: 'message.created' }>> = {}
): Extract<BotFeatureEvent, { type: 'message.created' }> {
    return {
        type: 'message.created',
        messageId: 'message-1',
        channelId: 'channel-1',
        guildId: 'guild-1',
        authorId: 'author-1',
        authorIsBot: false,
        authorRoleIds: [],
        authorIsServerOwner: false,
        authorHasManageServer: false,
        content: 'hello',
        mentionedUserIds: [],
        ...overrides,
    };
}

function createFluxerInvite(overrides: Partial<FluxerGuildInvite> = {}): FluxerGuildInvite {
    return {
        code: 'alpha',
        inviterUserId: 'inviter-1',
        channelId: 'channel-1',
        uses: 1,
        maxUses: null,
        expiresAt: null,
        temporary: false,
        ...overrides,
    };
}

function createInviteSnapshot(overrides: Record<string, unknown> = {}) {
    const timestamp = new Date('2026-06-26T00:00:00.000Z');

    return {
        id: 'snapshot-1',
        guildId: 'guild-1',
        code: 'alpha',
        inviterUserId: 'inviter-1',
        channelId: 'channel-1',
        uses: 1,
        maxUses: null,
        expiresAt: null,
        temporary: false,
        active: true,
        firstSeenAt: timestamp,
        lastSeenAt: timestamp,
        revokedAt: null,
        ...overrides,
    };
}

function createMemberFlowRecord(overrides: Record<string, unknown> = {}) {
    return {
        id: 'flow-1',
        guildId: 'guild-1',
        userId: 'user-1',
        eventType: 'join',
        inviteCode: 'alpha',
        inviterUserId: 'inviter-1',
        attributionStatus: 'attributed',
        occurredAt: new Date('2026-06-26T00:00:00.000Z'),
        ...overrides,
    };
}

function createMessageActivityRecord(overrides: Record<string, unknown> = {}) {
    return {
        id: 'activity-1',
        guildId: 'guild-1',
        channelId: 'channel-1',
        activityDate: '2026-06-26',
        messageCount: 1,
        updatedAt: new Date('2026-06-26T00:00:00.000Z'),
        ...overrides,
    };
}

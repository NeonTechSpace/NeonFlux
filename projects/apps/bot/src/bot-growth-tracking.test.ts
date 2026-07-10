import type { AppMode } from '@neonflux/config';
import {
    listGuildInviteSnapshots,
    recordGuildMemberFlowEvent,
    recordGuildMemberJoinWithInviteSnapshots,
    recordGuildMessageActivity,
    type GuildInviteSnapshotRecord,
    type GuildMemberFlowEventRecord,
    type GuildMessageActivityRecord,
} from '@neonflux/db';
import { readFluxerGuildInvites, type FluxerBot, type FluxerGuildInvite } from '@neonflux/fluxer';
import { err, ok } from 'neverthrow';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { trackGrowthOverviewEvent } from './bot-growth-tracking.js';
import type { BotFeatureHandlerContext, BotFeatureEvent } from './bot-feature-types.js';

vi.mock('@neonflux/db', () => ({
    listGuildInviteSnapshots: vi.fn(),
    recordGuildMemberFlowEvent: vi.fn(),
    recordGuildMemberJoinWithInviteSnapshots: vi.fn(),
    recordGuildMessageActivity: vi.fn(),
}));

vi.mock('@neonflux/fluxer', () => ({
    readFluxerGuildInvites: vi.fn(),
}));

const testDb = {} as BotFeatureHandlerContext['db'];
const testClient = {} as FluxerBot['client'];

describe('trackGrowthOverviewEvent', () => {
    beforeEach(() => {
        vi.resetAllMocks();
        vi.mocked(recordGuildMessageActivity).mockResolvedValue(ok(createMessageActivityRecord()));
        vi.mocked(listGuildInviteSnapshots).mockResolvedValue(
            ok({ baselineObserved: true, snapshots: [createInviteSnapshot()] })
        );
        vi.mocked(readFluxerGuildInvites).mockResolvedValue(
            ok([
                createFluxerInvite({
                    code: 'alpha',
                    uses: 2,
                }),
            ])
        );
        vi.mocked(recordGuildMemberFlowEvent).mockResolvedValue(ok(createMemberFlowRecord()));
        vi.mocked(recordGuildMemberJoinWithInviteSnapshots).mockResolvedValue(ok(createMemberFlowRecord()));
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
        expect(recordGuildMemberJoinWithInviteSnapshots).toHaveBeenCalledWith(testDb, {
            attributionStatus: 'attributed',
            guildId: 'guild-1',
            inviteCode: 'alpha',
            inviterUserId: 'inviter-1',
            invites: [
                {
                    code: 'alpha',
                    inviterUserId: 'inviter-1',
                    channelId: 'channel-1',
                    uses: 2,
                    temporary: false,
                },
            ],
            userId: 'user-1',
        });
        expect(recordGuildMemberFlowEvent).not.toHaveBeenCalled();
    });

    it('marks joins as baseline-missing when no prior invite snapshot exists', async () => {
        vi.mocked(listGuildInviteSnapshots).mockResolvedValueOnce(ok({ baselineObserved: false, snapshots: [] }));

        const result = await trackGrowthOverviewEvent(createContext(createMultiMode()), {
            type: 'member.joined',
            guildId: 'guild-1',
            userId: 'user-1',
            roleIds: [],
        });

        expect(result.isOk()).toBe(true);
        expect(recordGuildMemberJoinWithInviteSnapshots).toHaveBeenCalledWith(
            testDb,
            expect.objectContaining({ attributionStatus: 'baseline-missing' })
        );
    });

    it('distinguishes a successfully observed empty baseline from a missing baseline', async () => {
        vi.mocked(listGuildInviteSnapshots).mockResolvedValueOnce(ok({ baselineObserved: true, snapshots: [] }));
        vi.mocked(readFluxerGuildInvites).mockResolvedValueOnce(ok([]));

        await trackGrowthOverviewEvent(createContext(createMultiMode()), {
            type: 'member.joined',
            guildId: 'guild-1',
            userId: 'user-1',
            roleIds: [],
        });

        expect(recordGuildMemberJoinWithInviteSnapshots).toHaveBeenCalledWith(
            testDb,
            expect.objectContaining({ attributionStatus: 'unavailable' })
        );
    });

    it('falls back to an unavailable event when invite-sync input is invalid', async () => {
        vi.mocked(recordGuildMemberJoinWithInviteSnapshots).mockResolvedValueOnce(
            err({ field: 'uses', type: 'invalid-value' })
        );

        const result = await trackGrowthOverviewEvent(createContext(createMultiMode()), {
            type: 'member.joined',
            guildId: 'guild-1',
            userId: 'user-1',
            roleIds: [],
        });

        expect(result.isOk()).toBe(true);
        expect(recordGuildMemberFlowEvent).toHaveBeenCalledWith(
            testDb,
            expect.objectContaining({ attributionStatus: 'unavailable' })
        );
    });

    it('does not double-write after an ambiguous atomic mutation outcome', async () => {
        vi.mocked(recordGuildMemberJoinWithInviteSnapshots).mockResolvedValueOnce(err({ type: 'database-error' }));

        const result = await trackGrowthOverviewEvent(createContext(createMultiMode()), {
            type: 'member.joined',
            guildId: 'guild-1',
            userId: 'user-1',
            roleIds: [],
        });

        expect(result._unsafeUnwrapErr()).toBe('database-error');
        expect(recordGuildMemberFlowEvent).not.toHaveBeenCalled();
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
        expect(recordGuildMemberJoinWithInviteSnapshots).not.toHaveBeenCalled();
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

    it('records sharded message activity for non-bot guild messages', async () => {
        const result = await trackGrowthOverviewEvent(createContext(createMultiMode()), createMessageEvent());

        expect(result.isOk()).toBe(true);
        expect(result._unsafeUnwrap()).toStrictEqual({ status: 'tracked' });
        expect(recordGuildMessageActivity).toHaveBeenCalledWith(testDb, {
            guildId: 'guild-1',
            messageId: 'message-1',
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
        expect(recordGuildMessageActivity).not.toHaveBeenCalled();
    });

    it('serializes invite baseline updates for concurrent joins in one guild', async () => {
        let releaseFirstRead: (() => void) | undefined;
        const firstRead = new Promise<void>((resolve) => {
            releaseFirstRead = resolve;
        });
        vi.mocked(readFluxerGuildInvites)
            .mockImplementationOnce(async () => {
                await firstRead;
                return ok([createFluxerInvite({ uses: 2 })]);
            })
            .mockResolvedValueOnce(ok([createFluxerInvite({ uses: 3 })]));

        const first = trackGrowthOverviewEvent(createContext(createMultiMode()), {
            type: 'member.joined',
            guildId: 'guild-1',
            userId: 'user-1',
            roleIds: [],
        });
        const second = trackGrowthOverviewEvent(createContext(createMultiMode()), {
            type: 'member.joined',
            guildId: 'guild-1',
            userId: 'user-2',
            roleIds: [],
        });

        await vi.waitFor(() => expect(listGuildInviteSnapshots).toHaveBeenCalledTimes(1));
        releaseFirstRead?.();
        await Promise.all([first, second]);

        expect(listGuildInviteSnapshots).toHaveBeenCalledTimes(2);
        expect(recordGuildMemberJoinWithInviteSnapshots).toHaveBeenCalledTimes(2);
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

function createInviteSnapshot(overrides: Partial<GuildInviteSnapshotRecord> = {}): GuildInviteSnapshotRecord {
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

function createMemberFlowRecord(overrides: Partial<GuildMemberFlowEventRecord> = {}): GuildMemberFlowEventRecord {
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

function createMessageActivityRecord(overrides: Partial<GuildMessageActivityRecord> = {}): GuildMessageActivityRecord {
    return {
        guildId: 'guild-1',
        activityDate: '2026-06-26',
        shard: 12,
        ...overrides,
    };
}

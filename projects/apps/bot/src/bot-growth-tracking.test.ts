import type { AppMode } from '@neonflux/config';
import {
    recordGuildMemberFlowEvent,
    recordGuildMessageActivity,
    type GuildMemberFlowEventRecord,
    type GuildMessageActivityRecord,
} from '@neonflux/db';
import type { FluxerBot } from '@neonflux/fluxer';
import { err, ok } from 'neverthrow';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { trackGrowthOverviewEvent } from './bot-growth-tracking.js';
import type { BotFeatureHandlerContext, BotGrowthTelemetryEvent } from './bot-feature-types.js';

vi.mock('@neonflux/db', () => ({
    recordGuildMemberFlowEvent: vi.fn(),
    recordGuildMessageActivity: vi.fn(),
}));

const testDb = {} as BotFeatureHandlerContext['db'];
const testClient = {} as FluxerBot['client'];

describe('trackGrowthOverviewEvent', () => {
    beforeEach(() => {
        vi.resetAllMocks();
        vi.mocked(recordGuildMessageActivity).mockResolvedValue(ok(createMessageActivityRecord()));
        vi.mocked(recordGuildMemberFlowEvent).mockResolvedValue(ok(createMemberFlowRecord()));
    });

    it('applies guild gating before writing telemetry', async () => {
        const result = await trackGrowthOverviewEvent(createContext(createSingleMode()), {
            type: 'member.joined',
            guildId: 'other',
            userId: 'user-1',
            membershipStartedAt: new Date('2026-07-14T01:00:00.000Z'),
        });

        expect(result._unsafeUnwrap()).toStrictEqual({
            status: 'ignored',
            reason: 'guild-not-processable',
        });
        expect(recordGuildMemberFlowEvent).not.toHaveBeenCalled();
    });

    it('records member joins directly from provider event identity', async () => {
        const membershipStartedAt = new Date('2026-07-14T01:00:00.000Z');
        const result = await trackGrowthOverviewEvent(createContext(createMultiMode()), {
            type: 'member.joined',
            guildId: 'guild-1',
            userId: 'user-1',
            membershipStartedAt,
        });

        expect(result._unsafeUnwrap()).toStrictEqual({ status: 'tracked' });
        expect(recordGuildMemberFlowEvent).toHaveBeenCalledWith(testDb, {
            eventType: 'join',
            guildId: 'guild-1',
            membershipStartedAt,
            occurredAt: membershipStartedAt,
            userId: 'user-1',
        });
    });

    it('records member leaves without speculative attribution', async () => {
        const result = await trackGrowthOverviewEvent(createContext(createMultiMode()), {
            type: 'member.left',
            guildId: 'guild-1',
            userId: 'user-1',
        });

        expect(result._unsafeUnwrap()).toStrictEqual({ status: 'tracked' });
        expect(recordGuildMemberFlowEvent).toHaveBeenCalledWith(testDb, {
            eventType: 'leave',
            guildId: 'guild-1',
            userId: 'user-1',
        });
    });

    it('records non-bot member messages and ignores bot-authored messages', async () => {
        const tracked = await trackGrowthOverviewEvent(createContext(createMultiMode()), createMessageEvent());
        const ignored = await trackGrowthOverviewEvent(
            createContext(createMultiMode()),
            createMessageEvent({ authorIsBot: true })
        );

        expect(tracked._unsafeUnwrap()).toStrictEqual({ status: 'tracked' });
        expect(ignored._unsafeUnwrap()).toStrictEqual({
            status: 'ignored',
            reason: 'bot-authored-message',
        });
        expect(recordGuildMessageActivity).toHaveBeenCalledExactlyOnceWith(testDb, {
            guildId: 'guild-1',
            messageId: 'message-1',
            occurredAt: new Date('2026-07-14T01:02:03.000Z'),
        });
    });

    it('forwards processor cancellation to each repository write', async () => {
        const signal = new AbortController().signal;
        const context = createContext(createMultiMode());

        await trackGrowthOverviewEvent(context, createMessageEvent(), { signal });
        await trackGrowthOverviewEvent(
            context,
            {
                type: 'member.joined',
                guildId: 'guild-1',
                userId: 'user-1',
                membershipStartedAt: new Date('2026-07-14T01:00:00.000Z'),
            },
            { signal }
        );

        expect(recordGuildMessageActivity).toHaveBeenCalledWith(
            testDb,
            expect.objectContaining({ messageId: 'message-1' }),
            { signal }
        );
        expect(recordGuildMemberFlowEvent).toHaveBeenCalledWith(
            testDb,
            expect.objectContaining({ eventType: 'join' }),
            { signal }
        );
    });

    it('surfaces persistence failures without retrying a second write path', async () => {
        vi.mocked(recordGuildMemberFlowEvent).mockResolvedValueOnce(err({ type: 'database-error' }));

        const result = await trackGrowthOverviewEvent(createContext(createMultiMode()), {
            type: 'member.left',
            guildId: 'guild-1',
            userId: 'user-1',
        });

        expect(result._unsafeUnwrapErr()).toBe('database-error');
        expect(recordGuildMemberFlowEvent).toHaveBeenCalledOnce();
    });
});

function createContext(mode: AppMode): BotFeatureHandlerContext {
    return {
        db: testDb,
        mode,
        appEnv: 'production',
        guildDefconOverride: 'auto',
        logger: { warn: vi.fn() },
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
    overrides: Partial<Extract<BotGrowthTelemetryEvent, { type: 'message.created' }>> = {}
): Extract<BotGrowthTelemetryEvent, { type: 'message.created' }> {
    return {
        type: 'message.created',
        messageId: 'message-1',
        guildId: 'guild-1',
        authorIsBot: false,
        occurredAt: new Date('2026-07-14T01:02:03.000Z'),
        ...overrides,
    };
}

function createMemberFlowRecord(overrides: Partial<GuildMemberFlowEventRecord> = {}): GuildMemberFlowEventRecord {
    return {
        id: 'flow-1',
        guildId: 'guild-1',
        userId: 'user-1',
        eventType: 'join',
        membershipStartedAt: new Date('2026-06-26T00:00:00.000Z'),
        occurredAt: new Date('2026-06-26T00:00:00.000Z'),
        ...overrides,
    };
}

function createMessageActivityRecord(overrides: Partial<GuildMessageActivityRecord> = {}): GuildMessageActivityRecord {
    return {
        guildId: 'guild-1',
        activityDate: '2026-06-26',
        shard: 12,
        status: 'recorded',
        ...overrides,
    };
}

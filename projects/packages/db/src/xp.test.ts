import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createPgliteTestDatabase, type PgliteTestDatabase } from '../test-support/pglite-test-database.js';

import { upsertGuild } from './guilds.js';
import {
    findGuildUserXp,
    findGuildUserXpRank,
    findXpSettingsByGuildId,
    grantGuildUserXp,
    listGuildXpLeaderboard,
    upsertXpSettings,
} from './xp.js';
import { closeXpVoiceSession, transitionXpVoiceSession } from './xp-voice-sessions.js';

let testDatabase: TestDatabase | undefined;

beforeAll(async () => {
    testDatabase = await createTestDatabase();
});

beforeEach(async () => {
    await resetTestDatabase();
});

afterAll(async () => {
    await testDatabase?.close();
    testDatabase = undefined;
});

describe('XP repository', () => {
    beforeEach(async () => {
        await expectOk(upsertGuild(getDb(), { guildId: 'guild-1' }));
    });

    it('stores dashboard-configurable message and voice settings', async () => {
        const settings = await expectOk(
            upsertXpSettings(getDb(), {
                guildId: 'guild-1',
                enabled: true,
                messageXpMin: 4,
                messageXpMax: 12,
                cooldownSeconds: 45,
                voiceXpPerMinute: 3,
                voiceMinimumMinutes: 2,
            })
        );
        const loaded = await expectOk(findXpSettingsByGuildId(getDb(), { guildId: 'guild-1' }));

        expect(settings).toMatchObject({
            guildId: 'guild-1',
            enabled: true,
            messageXpMin: 4,
            messageXpMax: 12,
            cooldownSeconds: 45,
            voiceXpPerMinute: 3,
            voiceMinimumMinutes: 2,
        });
        expect(loaded).toMatchObject(settings);
    });

    it('rejects invalid settings ranges before writing', async () => {
        const result = await upsertXpSettings(getDb(), {
            guildId: 'guild-1',
            messageXpMin: 20,
            messageXpMax: 10,
        });

        expect(result.isErr()).toBe(true);
        expect(result._unsafeUnwrapErr()).toStrictEqual({
            type: 'invalid-value',
            field: 'messageXpMin',
        });
    });

    it('records idempotent XP grants and source-specific aggregates', async () => {
        const messageGrant = await expectOk(
            grantGuildUserXp(getDb(), {
                guildId: 'guild-1',
                userId: 'user-1',
                source: 'message',
                xp: 25,
                idempotencyKey: 'message-1',
                occurredAt: new Date('2026-01-01T00:00:00.000Z'),
            })
        );
        const voiceGrant = await expectOk(
            grantGuildUserXp(getDb(), {
                guildId: 'guild-1',
                userId: 'user-1',
                source: 'voice',
                xp: 15,
                voiceSeconds: 600,
                idempotencyKey: 'voice-session-1',
                occurredAt: new Date('2026-01-01T00:10:00.000Z'),
            })
        );
        const duplicate = await expectOk(
            grantGuildUserXp(getDb(), {
                guildId: 'guild-1',
                userId: 'user-1',
                source: 'message',
                xp: 25,
                idempotencyKey: 'message-1',
            })
        );
        const userXp = await expectOk(findGuildUserXp(getDb(), { guildId: 'guild-1', userId: 'user-1' }));

        expect(messageGrant.status).toBe('granted');
        expect(voiceGrant.status).toBe('granted');
        expect(duplicate.status).toBe('duplicate');
        expect(userXp).toMatchObject({
            xp: 40,
            messageXp: 25,
            voiceXp: 15,
            messageCount: 1,
            voiceSeconds: 600,
        });
    });

    it('orders leaderboard entries and reports rank', async () => {
        await seedGrant('user-1', 30);
        await seedGrant('user-2', 80);
        await seedGrant('user-3', 50);

        const leaderboard = await expectOk(listGuildXpLeaderboard(getDb(), { guildId: 'guild-1', limit: 3 }));
        const rank = await expectOk(findGuildUserXpRank(getDb(), { guildId: 'guild-1', userId: 'user-3' }));

        expect(leaderboard.map((entry) => entry.userId)).toStrictEqual(['user-2', 'user-3', 'user-1']);
        expect(rank.rank).toBe(2);
        expect(rank.userXp.userId).toBe('user-3');
    });

    it('transitions and closes voice sessions with credited duration', async () => {
        const firstStart = new Date('2026-01-01T00:00:00.000Z');
        const moveAt = new Date('2026-01-01T00:05:30.000Z');
        const leaveAt = new Date('2026-01-01T00:09:00.000Z');

        const started = await expectOk(
            transitionXpVoiceSession(getDb(), {
                guildId: 'guild-1',
                userId: 'user-1',
                channelId: 'voice-1',
                occurredAt: firstStart,
            })
        );
        const unchanged = await expectOk(
            transitionXpVoiceSession(getDb(), {
                guildId: 'guild-1',
                userId: 'user-1',
                channelId: 'voice-1',
                occurredAt: new Date('2026-01-01T00:01:00.000Z'),
            })
        );
        const moved = await expectOk(
            transitionXpVoiceSession(getDb(), {
                guildId: 'guild-1',
                userId: 'user-1',
                channelId: 'voice-2',
                occurredAt: moveAt,
            })
        );
        const closed = await expectOk(
            closeXpVoiceSession(getDb(), {
                guildId: 'guild-1',
                userId: 'user-1',
                endedAt: leaveAt,
            })
        );

        expect(started.status).toBe('started');
        expect(unchanged.status).toBe('unchanged');
        expect(moved.status).toBe('started');
        expect(moved.status === 'started' ? moved.closed?.durationSeconds : undefined).toBe(330);
        expect(closed.durationSeconds).toBe(210);
    });
});

async function seedGrant(userId: string, xp: number): Promise<void> {
    await expectOk(
        grantGuildUserXp(getDb(), {
            guildId: 'guild-1',
            userId,
            source: 'message',
            xp,
            idempotencyKey: `grant-${userId}`,
        })
    );
}

async function expectOk<TValue>(promise: Promise<{ isOk(): boolean; _unsafeUnwrap(): TValue }>): Promise<TValue> {
    const result = await promise;

    expect(result.isOk()).toBe(true);

    return result._unsafeUnwrap();
}

async function resetTestDatabase(): Promise<void> {
    if (!testDatabase) {
        throw new Error('Test database was not initialized');
    }

    await testDatabase.reset();
}

function getDb(): Parameters<typeof upsertGuild>[0] {
    if (!testDatabase) {
        throw new Error('Test database was not initialized');
    }

    return testDatabase.db;
}

type TestDatabase = PgliteTestDatabase;

function createTestDatabase(): Promise<TestDatabase> {
    return createPgliteTestDatabase('xp');
}

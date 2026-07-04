import { describe, expect, it } from 'vitest';

import type { ConvexDatabase } from './convex.js';
import {
    closeXpVoiceSession,
    findGuildUserXpRank,
    findXpSettingsByGuildId,
    grantGuildUserXp,
    listGuildXpLeaderboard,
    transitionXpVoiceSession,
    upsertXpRoleReward,
    upsertXpSettings,
} from './index.js';

const settings = {
    config: { curve: 'default' },
    cooldownSeconds: 45,
    enabled: true,
    guildId: 'guild-1',
    messageXpMax: 12,
    messageXpMin: 4,
    updatedAt: '2026-07-03T08:00:00.000Z',
    voiceMinimumMinutes: 2,
    voiceXpPerMinute: 3,
};
const userXp = {
    guildId: 'guild-1',
    id: 'user-xp-1',
    lastMessageXpAt: '2026-07-03T08:00:00.000Z',
    lastVoiceXpAt: null,
    legacyId: 'user-xp-1',
    level: 1,
    messageCount: 1,
    messageXp: 25,
    updatedAt: '2026-07-03T08:00:00.000Z',
    userId: 'user-1',
    voiceSeconds: 0,
    voiceXp: 0,
    xp: 25,
};
const grant = {
    grantedAt: '2026-07-03T08:00:00.000Z',
    guildId: 'guild-1',
    id: 'grant-1',
    idempotencyKey: 'message-1',
    legacyId: 'grant-1',
    levelAfter: 1,
    levelBefore: 0,
    metadata: { messageId: 'message-1' },
    source: 'message' as const,
    userId: 'user-1',
    xp: 25,
};
const reward = {
    createdAt: '2026-07-03T08:00:00.000Z',
    guildId: 'guild-1',
    id: 'reward-1',
    legacyId: 'reward-1',
    level: 3,
    roleId: 'role-1',
    updatedAt: '2026-07-03T08:00:00.000Z',
};
const voiceSession = {
    channelId: 'voice-1',
    createdAt: '2026-07-03T08:00:00.000Z',
    creditedSeconds: 0,
    endedAt: null,
    guildId: 'guild-1',
    id: 'voice-session-1',
    legacyId: 'voice-session-1',
    startedAt: '2026-07-03T08:00:00.000Z',
    status: 'active' as const,
    updatedAt: '2026-07-03T08:00:00.000Z',
    userId: 'user-1',
};
const closedVoiceSession = {
    durationSeconds: 300,
    session: {
        ...voiceSession,
        creditedSeconds: 300,
        endedAt: '2026-07-03T08:05:00.000Z',
        status: 'closed' as const,
        updatedAt: '2026-07-03T08:05:00.000Z',
    },
};

describe('Convex XP database functions', () => {
    it('reads and upserts XP settings through Convex', async () => {
        const db = createConvexDb({
            mutationResults: [settings],
            queryResults: [settings],
        });

        const saved = await upsertXpSettings(db, {
            cooldownSeconds: 45,
            enabled: true,
            guildId: ' guild-1 ',
            messageXpMax: 12,
            messageXpMin: 4,
            voiceMinimumMinutes: 2,
            voiceXpPerMinute: 3,
        });
        const loaded = await findXpSettingsByGuildId(db, { guildId: 'guild-1' });

        expect(saved._unsafeUnwrap()).toStrictEqual(toSettingsRecord(settings));
        expect(loaded._unsafeUnwrap()).toStrictEqual(toSettingsRecord(settings));
        expect(db.client.mutationCalls[0]?.args).toStrictEqual({
            cooldownSeconds: 45,
            enabled: true,
            guildId: 'guild-1',
            messageXpMax: 12,
            messageXpMin: 4,
            voiceMinimumMinutes: 2,
            voiceXpPerMinute: 3,
        });
    });

    it('converts grants, duplicate grants, rank, leaderboard, and role rewards', async () => {
        const db = createConvexDb({
            mutationResults: [{ grant, status: 'granted', userXp }, { status: 'duplicate', userXp: null }, reward],
            queryResults: [{ rank: 2, userXp }, [userXp]],
        });

        const granted = await grantGuildUserXp(db, {
            guildId: ' guild-1 ',
            idempotencyKey: ' message-1 ',
            metadata: { messageId: 'message-1' },
            occurredAt: new Date('2026-07-03T08:00:00.000Z'),
            source: 'message',
            userId: ' user-1 ',
            xp: 25,
        });
        const duplicate = await grantGuildUserXp(db, {
            guildId: 'guild-1',
            idempotencyKey: 'message-1',
            source: 'message',
            userId: 'user-1',
            xp: 25,
        });
        const savedReward = await upsertXpRoleReward(db, {
            guildId: 'guild-1',
            level: 3,
            roleId: 'role-1',
        });
        const rank = await findGuildUserXpRank(db, { guildId: 'guild-1', userId: 'user-1' });
        const leaderboard = await listGuildXpLeaderboard(db, { guildId: 'guild-1', limit: 10 });

        expect(granted._unsafeUnwrap()).toStrictEqual({
            grant: toGrantRecord(grant),
            status: 'granted',
            userXp: toUserXpRecord(userXp),
        });
        expect(duplicate._unsafeUnwrap()).toStrictEqual({ status: 'duplicate', userXp: undefined });
        expect(savedReward._unsafeUnwrap()).toStrictEqual(toRewardRecord(reward));
        expect(rank._unsafeUnwrap()).toStrictEqual({ rank: 2, userXp: toUserXpRecord(userXp) });
        expect(leaderboard._unsafeUnwrap()).toStrictEqual([toUserXpRecord(userXp)]);
    });

    it('transitions and closes XP voice sessions through Convex', async () => {
        const db = createConvexDb({
            mutationResults: [
                { active: voiceSession, closed: closedVoiceSession, status: 'started' },
                closedVoiceSession,
            ],
        });

        const transition = await transitionXpVoiceSession(db, {
            channelId: ' voice-1 ',
            guildId: ' guild-1 ',
            occurredAt: new Date('2026-07-03T08:00:00.000Z'),
            userId: ' user-1 ',
        });
        const closed = await closeXpVoiceSession(db, {
            endedAt: new Date('2026-07-03T08:05:00.000Z'),
            guildId: 'guild-1',
            userId: 'user-1',
        });

        expect(transition._unsafeUnwrap()).toStrictEqual({
            active: toVoiceSessionRecord(voiceSession),
            closed: toClosedVoiceSession(closedVoiceSession),
            status: 'started',
        });
        expect(closed._unsafeUnwrap()).toStrictEqual(toClosedVoiceSession(closedVoiceSession));
        expect(db.client.mutationCalls[0]?.args).toStrictEqual({
            channelId: 'voice-1',
            guildId: 'guild-1',
            occurredAt: '2026-07-03T08:00:00.000Z',
            userId: 'user-1',
        });
    });

    it('maps not-found results and validates before Convex calls', async () => {
        const db = createConvexDb({ mutationResults: [null], queryResults: [null, null] });

        const missingSettings = await findXpSettingsByGuildId(db, { guildId: 'guild-1' });
        const missingRank = await findGuildUserXpRank(db, { guildId: 'guild-1', userId: 'user-1' });
        const missingVoice = await closeXpVoiceSession(db, { guildId: 'guild-1', userId: 'user-1' });
        const invalidSettings = await upsertXpSettings(db, {
            guildId: 'guild-1',
            messageXpMin: 20,
            messageXpMax: 10,
        });
        const invalidGrant = await grantGuildUserXp(db, {
            guildId: 'guild-1',
            idempotencyKey: 'message-1',
            source: 'message',
            userId: 'user-1',
            xp: 0,
        });

        expect(missingSettings._unsafeUnwrapErr()).toStrictEqual({ type: 'not-found' });
        expect(missingRank._unsafeUnwrapErr()).toStrictEqual({ type: 'not-found' });
        expect(missingVoice._unsafeUnwrapErr()).toStrictEqual({ type: 'not-found' });
        expect(invalidSettings._unsafeUnwrapErr()).toStrictEqual({
            field: 'messageXpMin',
            type: 'invalid-value',
        });
        expect(invalidGrant._unsafeUnwrapErr()).toStrictEqual({
            field: 'xp',
            type: 'invalid-value',
        });
    });
});

function toSettingsRecord(record: typeof settings) {
    return { ...record, updatedAt: new Date(record.updatedAt) };
}

function toUserXpRecord(record: typeof userXp) {
    return {
        guildId: record.guildId,
        id: record.id,
        lastMessageXpAt: record.lastMessageXpAt ? new Date(record.lastMessageXpAt) : null,
        lastVoiceXpAt: record.lastVoiceXpAt ? new Date(record.lastVoiceXpAt) : null,
        level: record.level,
        messageCount: record.messageCount,
        messageXp: record.messageXp,
        updatedAt: new Date(record.updatedAt),
        userId: record.userId,
        voiceSeconds: record.voiceSeconds,
        voiceXp: record.voiceXp,
        xp: record.xp,
    };
}

function toGrantRecord(record: typeof grant) {
    return {
        grantedAt: new Date(record.grantedAt),
        guildId: record.guildId,
        id: record.id,
        idempotencyKey: record.idempotencyKey,
        levelAfter: record.levelAfter,
        levelBefore: record.levelBefore,
        metadata: record.metadata,
        source: record.source,
        userId: record.userId,
        xp: record.xp,
    };
}

function toRewardRecord(record: typeof reward) {
    return {
        createdAt: new Date(record.createdAt),
        guildId: record.guildId,
        id: record.id,
        level: record.level,
        roleId: record.roleId,
        updatedAt: new Date(record.updatedAt),
    };
}

function toVoiceSessionRecord(record: typeof voiceSession | typeof closedVoiceSession.session) {
    return {
        channelId: record.channelId,
        createdAt: new Date(record.createdAt),
        creditedSeconds: record.creditedSeconds,
        endedAt: record.endedAt ? new Date(record.endedAt) : null,
        guildId: record.guildId,
        id: record.id,
        startedAt: new Date(record.startedAt),
        status: record.status,
        updatedAt: new Date(record.updatedAt),
        userId: record.userId,
    };
}

function toClosedVoiceSession(record: typeof closedVoiceSession) {
    return {
        durationSeconds: record.durationSeconds,
        session: toVoiceSessionRecord(record.session),
    };
}

function createConvexDb(input: {
    mutationErrors?: Error[];
    mutationResults?: unknown[];
    queryErrors?: Error[];
    queryResults?: unknown[];
}): ConvexDatabase & {
    client: {
        mutationCalls: Array<{ args: unknown; reference: unknown }>;
        queryCalls: Array<{ args: unknown; reference: unknown }>;
    };
} {
    const mutationErrors = [...(input.mutationErrors ?? [])];
    const mutationResults = [...(input.mutationResults ?? [])];
    const queryErrors = [...(input.queryErrors ?? [])];
    const queryResults = [...(input.queryResults ?? [])];
    const client = {
        mutationCalls: [] as Array<{ args: unknown; reference: unknown }>,
        queryCalls: [] as Array<{ args: unknown; reference: unknown }>,
        async mutation(reference: unknown, args: unknown): Promise<unknown> {
            this.mutationCalls.push({ args, reference });
            const error = mutationErrors.shift();

            if (error) throw error;

            return mutationResults.shift();
        },
        async query(reference: unknown, args: unknown): Promise<unknown> {
            this.queryCalls.push({ args, reference });
            const error = queryErrors.shift();

            if (error) throw error;

            return queryResults.shift();
        },
    };

    return {
        client: client as unknown as ConvexDatabase['client'] & typeof client,
        kind: 'convex',
        serviceName: 'web',
    };
}

import { describe, expect, it } from 'vitest';

import {
    buildActiveXpVoiceSessionDocument,
    calculateDurationSeconds,
    closeXpVoiceSessionDocument,
    normalizeRequiredChannelId,
    normalizeRequiredGuildId,
    normalizeRequiredUserId,
    toXpVoiceSessionRecord,
} from './xp_voice_sessions_model.js';

const now = '2026-07-03T08:00:00.000Z';
const endedAt = '2026-07-03T08:05:42.000Z';

describe('xp voice sessions model', () => {
    it('builds active voice session documents with normalized IDs', () => {
        const session = buildActiveXpVoiceSessionDocument(
            {
                channelId: ' channel-1 ',
                guildId: ' guild-1 ',
                startedAt: now,
                userId: ' user-1 ',
            },
            now
        );

        expect(session).toEqual({
            ok: true,
            value: {
                channelId: 'channel-1',
                createdAt: now,
                creditedSeconds: 0,
                guildId: 'guild-1',
                startedAt: now,
                status: 'active',
                updatedAt: now,
                userId: 'user-1',
            },
        });
    });

    it('closes sessions with non-negative credited duration', () => {
        const session = buildActiveXpVoiceSessionDocument(
            { channelId: 'channel-1', guildId: 'guild-1', startedAt: now, userId: 'user-1' },
            now
        );

        if (!session.ok) throw new Error('Expected active session.');
        const storedSession = { ...session.value, _id: 'session-1' };

        expect(closeXpVoiceSessionDocument(storedSession, endedAt)).toEqual({
            ok: true,
            value: {
                durationSeconds: 342,
                session: {
                    ...storedSession,
                    creditedSeconds: 342,
                    endedAt,
                    status: 'closed',
                    updatedAt: endedAt,
                },
            },
        });
        expect(calculateDurationSeconds(endedAt, now)).toBe(0);
    });

    it('normalizes records and required IDs', () => {
        const session = buildActiveXpVoiceSessionDocument(
            { channelId: 'channel-1', guildId: 'guild-1', startedAt: now, userId: 'user-1' },
            now
        );

        if (!session.ok) throw new Error('Expected active session.');

        expect(toXpVoiceSessionRecord({ ...session.value, _id: 'session-1' })).toMatchObject({
            endedAt: null,
            id: 'session-1',
        });
        expect(normalizeRequiredGuildId(' guild-1 ')).toEqual({ ok: true, value: 'guild-1' });
        expect(normalizeRequiredUserId(' user-1 ')).toEqual({ ok: true, value: 'user-1' });
        expect(normalizeRequiredChannelId(' channel-1 ')).toEqual({ ok: true, value: 'channel-1' });
    });
});

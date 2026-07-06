import { describe, expect, it } from 'vitest';

import {
    applyXpGrant,
    buildGuildUserXpDocument,
    buildXpGrantDocument,
    buildXpRoleRewardDocument,
    buildXpSettingsDocument,
    calculateXpLevel,
    normalizeRequiredGuildId,
    normalizeRequiredRoleId,
    normalizeRequiredUserId,
    normalizeXpLimit,
    toGuildUserXpRecord,
    toXpGrantRecord,
    toXpRoleRewardRecord,
} from './xp_model.js';

const now = '2026-07-03T08:00:00.000Z';

describe('xp model', () => {
    it('normalizes XP settings and rejects invalid ranges', () => {
        expect(
            buildXpSettingsDocument(
                {
                    cooldownSeconds: 45,
                    enabled: true,
                    guildId: ' guild-1 ',
                    messageXpMax: 12,
                    messageXpMin: 4,
                    voiceMinimumMinutes: 2,
                    voiceXpPerMinute: 3,
                },
                now
            )
        ).toEqual({
            ok: true,
            value: {
                config: {},
                cooldownSeconds: 45,
                enabled: true,
                guildId: 'guild-1',
                messageXpMax: 12,
                messageXpMin: 4,
                updatedAt: now,
                voiceMinimumMinutes: 2,
                voiceXpPerMinute: 3,
            },
        });
        expect(buildXpSettingsDocument({ guildId: 'guild-1', messageXpMax: 10, messageXpMin: 20 }, now)).toEqual({
            error: { field: 'messageXpMin', type: 'invalid-value' },
            ok: false,
        });
    });

    it('builds XP grants and applies source-specific aggregates', () => {
        const grant = buildXpGrantDocument(
            {
                guildId: ' guild-1 ',
                idempotencyKey: ' message-1 ',
                source: ' message ',
                userId: ' user-1 ',
                xp: 25,
            },
            0,
            0,
            now
        );

        expect(grant).toMatchObject({
            ok: true,
            value: {
                guildId: 'guild-1',
                idempotencyKey: 'message-1',
                source: 'message',
                userId: 'user-1',
                xp: 25,
            },
        });

        if (!grant.ok) throw new Error('Expected normalized grant.');

        const userXp = applyXpGrant(null, grant.value, 0);

        expect(toXpGrantRecord({ ...grant.value, _id: 'grant-1' })).toMatchObject({ id: 'grant-1' });
        expect(toGuildUserXpRecord({ ...userXp, _id: 'xp-1' })).toMatchObject({
            id: 'xp-1',
            lastMessageXpAt: now,
            messageCount: 1,
            messageXp: 25,
            userId: 'user-1',
            voiceSeconds: 0,
            voiceXp: 0,
            xp: 25,
        });
    });

    it('applies voice grants with credited seconds', () => {
        const voiceGrant = buildXpGrantDocument(
            { guildId: 'guild-1', idempotencyKey: 'voice-1', source: 'voice', userId: 'user-1', xp: 15 },
            0,
            0,
            now
        );

        if (!voiceGrant.ok) throw new Error('Expected normalized voice grant.');

        const userXp = applyXpGrant(null, voiceGrant.value, 600);

        expect(toGuildUserXpRecord({ ...userXp, _id: 'xp-1' })).toMatchObject({
            lastVoiceXpAt: now,
            messageCount: 0,
            messageXp: 0,
            voiceSeconds: 600,
            voiceXp: 15,
            xp: 15,
        });
    });

    it('normalizes direct aggregate and role reward inputs', () => {
        const aggregate = buildGuildUserXpDocument({ guildId: 'guild-1', level: 2, userId: 'user-1', xp: 450 }, now);
        const reward = buildXpRoleRewardDocument({ guildId: 'guild-1', level: 5, roleId: 'role-1' }, now, undefined);

        expect(aggregate).toMatchObject({
            ok: true,
            value: { level: 2, messageCount: 1, messageXp: 450, xp: 450 },
        });
        expect(reward).toMatchObject({
            ok: true,
            value: { createdAt: now, level: 5, roleId: 'role-1', updatedAt: now },
        });

        if (!reward.ok) throw new Error('Expected normalized reward.');

        expect(toXpRoleRewardRecord({ ...reward.value, _id: 'reward-1' })).toMatchObject({ id: 'reward-1' });
    });

    it('normalizes helpers and level math', () => {
        expect(calculateXpLevel(0)).toBe(0);
        expect(calculateXpLevel(400)).toBe(2);
        expect(normalizeRequiredGuildId(' guild-1 ')).toEqual({ ok: true, value: 'guild-1' });
        expect(normalizeRequiredUserId(' user-1 ')).toEqual({ ok: true, value: 'user-1' });
        expect(normalizeRequiredRoleId(' role-1 ')).toEqual({ ok: true, value: 'role-1' });
        expect(normalizeXpLimit(undefined)).toBe(10);
        expect(normalizeXpLimit(0)).toBe(1);
        expect(normalizeXpLimit(500)).toBe(100);
    });
});

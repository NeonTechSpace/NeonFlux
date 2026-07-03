import { describe, expect, it } from 'vitest';

import {
    buildVerificationFlowDocument,
    buildVerificationRecordDocument,
    buildVerificationRecordRevokePatch,
    toVerificationFlowRecord,
    toVerificationRecord,
} from './verification_model.js';

const now = '2026-07-03T08:00:00.000Z';
const createLegacyId = (): string => 'legacy-1';

describe('verification model', () => {
    it('builds verification flows with defaults and app-facing IDs', () => {
        const result = buildVerificationFlowDocument(
            {
                channelId: ' channel-1 ',
                emojiKey: ' unicode:check ',
                guildId: ' guild-1 ',
                messageId: ' message-1 ',
                verifiedRoleId: ' role-1 ',
            },
            now,
            undefined,
            createLegacyId
        );

        expect(result.ok).toBe(true);
        if (!result.ok) return;

        expect(result.value).toMatchObject({
            channelId: 'channel-1',
            emojiKey: 'unicode:check',
            enabled: true,
            guildId: 'guild-1',
            legacyId: 'legacy-1',
            messageId: 'message-1',
            verifiedRoleId: 'role-1',
        });
        expect(toVerificationFlowRecord(result.value).id).toBe('legacy-1');
    });

    it('preserves verification flow identity and created timestamp on update', () => {
        const result = buildVerificationFlowDocument(
            {
                channelId: 'channel-2',
                emojiKey: 'unicode:star',
                enabled: false,
                guildId: 'guild-1',
                messageId: 'message-1',
                updatedAt: '2026-07-03T09:00:00.000Z',
                verifiedRoleId: 'role-2',
            },
            now,
            {
                createdAt: '2026-07-02T08:00:00.000Z',
                legacyId: 'flow-1',
            }
        );

        expect(result.ok).toBe(true);
        if (!result.ok) return;

        expect(result.value).toMatchObject({
            createdAt: '2026-07-02T08:00:00.000Z',
            enabled: false,
            legacyId: 'flow-1',
            updatedAt: '2026-07-03T09:00:00.000Z',
        });
    });

    it('rejects blank flow fields', () => {
        expect(
            buildVerificationFlowDocument(
                {
                    channelId: 'channel-1',
                    emojiKey: ' ',
                    guildId: 'guild-1',
                    messageId: 'message-1',
                    verifiedRoleId: 'role-1',
                },
                now
            )
        ).toStrictEqual({
            error: { field: 'emojiKey', type: 'missing-input' },
            ok: false,
        });
    });

    it('upserts verification records as active and app-facing', () => {
        const result = buildVerificationRecordDocument(
            {
                guildId: ' guild-1 ',
                method: ' reaction ',
                userId: ' user-1 ',
            },
            now,
            undefined,
            createLegacyId
        );

        expect(result.ok).toBe(true);
        if (!result.ok) return;

        expect(toVerificationRecord(result.value)).toStrictEqual({
            guildId: 'guild-1',
            id: 'legacy-1',
            method: 'reaction',
            revokedAt: null,
            userId: 'user-1',
            verifiedAt: now,
        });
    });

    it('preserves record identity on reactivation and validates revocation time', () => {
        const reactivated = buildVerificationRecordDocument(
            {
                guildId: 'guild-1',
                method: 'reaction',
                userId: 'user-1',
            },
            now,
            { legacyId: 'record-1' }
        );

        expect(reactivated.ok).toBe(true);
        if (!reactivated.ok) return;
        expect(reactivated.value.legacyId).toBe('record-1');
        expect(reactivated.value.revokedAt).toBeUndefined();
        expect(buildVerificationRecordRevokePatch('bad-date')).toStrictEqual({
            error: { field: 'revokedAt', type: 'invalid-value' },
            ok: false,
        });
    });
});

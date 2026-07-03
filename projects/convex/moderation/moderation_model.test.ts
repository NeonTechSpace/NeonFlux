import { describe, expect, it } from 'vitest';

import {
    buildCaseStatusPatch,
    buildModerationCaseDocument,
    buildModerationCaseEventDocument,
    buildModerationTemporaryActionDocument,
    buildTemporaryActionStatusPatch,
    normalizeModerationListLimit,
    normalizeSinceTimestamp,
    toModerationCaseEventRecord,
    toModerationCaseRecord,
    toModerationTemporaryActionRecord,
} from './moderation_model.js';

const now = '2026-07-03T08:00:00.000Z';
const createLegacyId = (): string => 'legacy-1';

describe('moderation model', () => {
    it('builds user moderation cases with app-facing null optional fields', () => {
        const result = buildModerationCaseDocument(
            {
                action: 'warn',
                actorUserId: ' mod-1 ',
                caseNumber: 3,
                guildId: ' guild-1 ',
                reason: ' spam ',
                targetType: 'user',
                targetUserId: ' user-1 ',
            },
            now,
            createLegacyId
        );

        expect(result.ok).toBe(true);
        if (!result.ok) return;

        expect(result.value).toMatchObject({
            action: 'warn',
            actorUserId: 'mod-1',
            caseNumber: 3,
            guildId: 'guild-1',
            legacyId: 'legacy-1',
            reason: 'spam',
            status: 'open',
            targetType: 'user',
            targetUserId: 'user-1',
        });
        expect(toModerationCaseRecord(result.value)).toMatchObject({
            id: 'legacy-1',
            targetChannelId: null,
        });
    });

    it('requires the right target field for channel and user cases', () => {
        const userResult = buildModerationCaseDocument(
            { action: 'warn', caseNumber: 1, guildId: 'guild-1', targetType: 'user' },
            now
        );
        const channelResult = buildModerationCaseDocument(
            { action: 'purge', caseNumber: 1, guildId: 'guild-1', targetType: 'channel' },
            now
        );

        expect(userResult).toStrictEqual({
            error: { field: 'targetUserId', type: 'missing-input' },
            ok: false,
        });
        expect(channelResult).toStrictEqual({
            error: { field: 'targetChannelId', type: 'missing-input' },
            ok: false,
        });
    });

    it('builds case events without requiring actor details', () => {
        const result = buildModerationCaseEventDocument(
            {
                caseId: ' case-1 ',
                details: { note: 'Internal note' },
                eventType: ' note.added ',
            },
            now,
            createLegacyId
        );

        expect(result.ok).toBe(true);
        if (!result.ok) return;

        expect(toModerationCaseEventRecord(result.value)).toStrictEqual({
            actorUserId: null,
            caseId: 'case-1',
            createdAt: now,
            details: { note: 'Internal note' },
            eventType: 'note.added',
            id: 'legacy-1',
        });
    });

    it('enforces moderation case status transitions', () => {
        expect(buildCaseStatusPatch('open', 'resolved', now)).toStrictEqual({
            ok: true,
            value: { status: 'resolved', updatedAt: now },
        });
        expect(buildCaseStatusPatch('resolved', 'void', now)).toStrictEqual({
            error: { from: 'resolved', to: 'void', type: 'invalid-status-transition' },
            ok: false,
        });
    });

    it('builds temporary action records and enforces status transitions', () => {
        const result = buildModerationTemporaryActionDocument(
            {
                action: 'timeout',
                caseId: 'case-1',
                expiresAt: '2026-07-03T09:00:00.000Z',
                guildId: 'guild-1',
                targetUserId: 'user-1',
            },
            now,
            createLegacyId
        );

        expect(result.ok).toBe(true);
        if (!result.ok) return;

        expect(toModerationTemporaryActionRecord(result.value)).toMatchObject({
            caseId: 'case-1',
            id: 'legacy-1',
            status: 'pending',
        });
        expect(buildTemporaryActionStatusPatch('pending', 'completed', now)).toStrictEqual({
            ok: true,
            value: { status: 'completed', updatedAt: now },
        });
        expect(buildTemporaryActionStatusPatch('completed', 'failed', now)).toStrictEqual({
            error: { from: 'completed', to: 'failed', type: 'invalid-status-transition' },
            ok: false,
        });
    });

    it('bounds list limits and validates recent timestamps', () => {
        expect(normalizeModerationListLimit(undefined, 5, 100)).toBe(5);
        expect(normalizeModerationListLimit(250, 5, 100)).toBe(100);
        expect(normalizeSinceTimestamp('not-a-date')).toStrictEqual({
            error: { field: 'since', type: 'invalid-value' },
            ok: false,
        });
    });
});

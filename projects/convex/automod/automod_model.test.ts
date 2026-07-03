import { describe, expect, it } from 'vitest';

import {
    buildAutomodEventDocument,
    buildAutomodEventStatusPatch,
    buildAutomodRuleDocument,
    normalizeAutomodListLimit,
    normalizeRequiredEventId,
    normalizeRequiredGuildId,
    normalizeRequiredRuleId,
    toAutomodEventRecord,
    toAutomodRuleRecord,
} from './automod_model.js';

describe('automod model', () => {
    it('normalizes blocked-term rules like the Postgres repository', () => {
        const document = buildAutomodRuleDocument(
            {
                config: {
                    ignoredChannelIds: [' channel-1 ', 'channel-1'],
                    ignoredRoleIds: [' role-1 '],
                    ignoredUserIds: [' user-1 '],
                    terms: [' spam ', 'spam', 'phish'],
                },
                guildId: ' guild-1 ',
                name: ' Blocked terms ',
                triggerType: 'blocked_terms',
            },
            '2026-07-03T08:00:00.000Z',
            undefined,
            () => 'rule-1'
        );

        expect(document).toEqual({
            ok: true,
            value: {
                actionType: 'record',
                config: {
                    ignoredChannelIds: ['channel-1'],
                    ignoredRoleIds: ['role-1'],
                    ignoredUserIds: ['user-1'],
                    terms: ['spam', 'phish'],
                },
                createdAt: '2026-07-03T08:00:00.000Z',
                enabled: true,
                guildId: 'guild-1',
                legacyId: 'rule-1',
                name: 'Blocked terms',
                triggerType: 'blocked_terms',
                updatedAt: '2026-07-03T08:00:00.000Z',
            },
        });

        if (!document.ok) {
            throw new Error('Expected normalized automod rule.');
        }

        expect(toAutomodRuleRecord(document.value)).toEqual({
            actionType: 'record',
            config: {
                ignoredChannelIds: ['channel-1'],
                ignoredRoleIds: ['role-1'],
                ignoredUserIds: ['user-1'],
                terms: ['spam', 'phish'],
            },
            createdAt: '2026-07-03T08:00:00.000Z',
            enabled: true,
            guildId: 'guild-1',
            id: 'rule-1',
            name: 'Blocked terms',
            triggerType: 'blocked_terms',
            updatedAt: '2026-07-03T08:00:00.000Z',
        });
    });

    it('normalizes invite-link timeout rules', () => {
        expect(
            buildAutomodRuleDocument(
                {
                    actionType: 'timeout',
                    config: { timeoutDurationSeconds: 600 },
                    enabled: false,
                    guildId: 'guild-1',
                    name: 'Invite links',
                    triggerType: 'invite_links',
                },
                '2026-07-03T08:00:00.000Z',
                undefined,
                () => 'rule-1'
            )
        ).toEqual({
            ok: true,
            value: {
                actionType: 'timeout',
                config: { timeoutDurationSeconds: 600 },
                createdAt: '2026-07-03T08:00:00.000Z',
                enabled: false,
                guildId: 'guild-1',
                legacyId: 'rule-1',
                name: 'Invite links',
                triggerType: 'invite_links',
                updatedAt: '2026-07-03T08:00:00.000Z',
            },
        });
    });

    it('preserves rule legacy identity and created timestamp on update', () => {
        expect(
            buildAutomodRuleDocument(
                {
                    config: { terms: ['scam'] },
                    guildId: 'guild-1',
                    name: 'Blocked terms',
                    triggerType: 'blocked_terms',
                },
                '2026-07-03T08:00:00.000Z',
                {
                    createdAt: '2026-07-02T08:00:00.000Z',
                    legacyId: 'existing-rule',
                }
            )
        ).toMatchObject({
            ok: true,
            value: {
                createdAt: '2026-07-02T08:00:00.000Z',
                legacyId: 'existing-rule',
                updatedAt: '2026-07-03T08:00:00.000Z',
            },
        });
    });

    it('rejects invalid rules', () => {
        expect(
            buildAutomodRuleDocument(
                { config: { terms: [] }, guildId: 'guild-1', name: ' ', triggerType: 'blocked_terms' },
                '2026-07-03T08:00:00.000Z'
            )
        ).toEqual({
            error: { field: 'name', type: 'missing-input' },
            ok: false,
        });
        expect(
            buildAutomodRuleDocument(
                { config: { terms: [] }, guildId: 'guild-1', name: 'Bad', triggerType: 'blocked_terms' },
                '2026-07-03T08:00:00.000Z'
            )
        ).toEqual({
            error: { field: 'config.terms', type: 'invalid-value' },
            ok: false,
        });
        expect(
            buildAutomodRuleDocument(
                {
                    actionType: 'timeout',
                    config: { timeoutDurationSeconds: 10 },
                    guildId: 'guild-1',
                    name: 'Bad',
                    triggerType: 'invite_links',
                },
                '2026-07-03T08:00:00.000Z'
            )
        ).toEqual({
            error: { field: 'config.timeoutDurationSeconds', type: 'invalid-value' },
            ok: false,
        });
    });

    it('normalizes automod events without raw message content', () => {
        const document = buildAutomodEventDocument(
            {
                authorUserId: ' user-1 ',
                channelId: ' channel-1 ',
                details: {
                    matchedTermCount: 1,
                    matchedTerms: ['spam'],
                },
                guildId: ' guild-1 ',
                messageId: ' message-1 ',
                ruleId: ' rule-1 ',
                triggerType: 'blocked_terms',
            },
            '2026-07-03T08:00:00.000Z',
            () => 'event-1'
        );

        expect(document).toEqual({
            ok: true,
            value: {
                actionType: 'record',
                authorUserId: 'user-1',
                channelId: 'channel-1',
                createdAt: '2026-07-03T08:00:00.000Z',
                details: {
                    matchedTermCount: 1,
                    matchedTerms: ['spam'],
                },
                guildId: 'guild-1',
                legacyId: 'event-1',
                messageId: 'message-1',
                ruleLegacyId: 'rule-1',
                status: 'recorded',
                triggerType: 'blocked_terms',
            },
        });

        if (!document.ok) {
            throw new Error('Expected normalized automod event.');
        }

        expect(toAutomodEventRecord(document.value)).toMatchObject({
            id: 'event-1',
            ruleId: 'rule-1',
            status: 'recorded',
        });
    });

    it('preserves existing event details when no status details are supplied', () => {
        expect(buildAutomodEventStatusPatch({ status: 'enforced' }, { matchedTermCount: 1 })).toEqual({
            ok: true,
            value: {
                details: { matchedTermCount: 1 },
                status: 'enforced',
            },
        });
    });

    it('normalizes ids and limits', () => {
        expect(normalizeRequiredGuildId(' guild-1 ')).toEqual({ ok: true, value: 'guild-1' });
        expect(normalizeRequiredRuleId(' rule-1 ')).toEqual({ ok: true, value: 'rule-1' });
        expect(normalizeRequiredEventId(' event-1 ')).toEqual({ ok: true, value: 'event-1' });
        expect(normalizeAutomodListLimit(undefined)).toEqual({ ok: true, value: 50 });
        expect(normalizeAutomodListLimit(200)).toEqual({ ok: true, value: 200 });
        expect(normalizeAutomodListLimit(201)).toEqual({
            error: { field: 'limit', type: 'invalid-value' },
            ok: false,
        });
    });
});

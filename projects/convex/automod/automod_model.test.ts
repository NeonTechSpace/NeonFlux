import { describe, expect, it } from 'vitest';
import type { GenericId } from 'convex/values';

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

const ruleId = 'rule-1' as GenericId<'automodRules'>;
const eventId = 'event-1' as GenericId<'automodEvents'>;

describe('automod model', () => {
    it('normalizes blocked-term rules to the app-facing contract', () => {
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
            '2026-07-03T08:00:00.000Z'
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
                name: 'Blocked terms',
                triggerType: 'blocked_terms',
                updatedAt: '2026-07-03T08:00:00.000Z',
            },
        });

        if (!document.ok) {
            throw new Error('Expected normalized automod rule.');
        }

        expect(toAutomodRuleRecord({ ...document.value, _id: ruleId })).toEqual({
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
            id: ruleId,
            name: 'Blocked terms',
            triggerType: 'blocked_terms',
            updatedAt: '2026-07-03T08:00:00.000Z',
        });
    });

    it('preserves rule created timestamp on update', () => {
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
                }
            )
        ).toMatchObject({
            ok: true,
            value: {
                createdAt: '2026-07-02T08:00:00.000Z',
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
                    config: { terms: ['spam'], timeoutDurationSeconds: 10 },
                    guildId: 'guild-1',
                    name: 'Bad',
                    triggerType: 'blocked_terms',
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
            '2026-07-03T08:00:00.000Z'
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
                messageId: 'message-1',
                ruleId,
                status: 'recorded',
                triggerType: 'blocked_terms',
            },
        });

        if (!document.ok) {
            throw new Error('Expected normalized automod event.');
        }

        expect(toAutomodEventRecord({ ...document.value, _id: eventId })).toMatchObject({
            id: eventId,
            ruleId,
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

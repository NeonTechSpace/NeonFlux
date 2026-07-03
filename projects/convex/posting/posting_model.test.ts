import { describe, expect, it } from 'vitest';

import {
    buildMessageTemplateDocument,
    buildPostedMessageDocument,
    normalizeMessageTemplateLimit,
    normalizePostedMessageLookupInput,
    normalizeRequiredGuildId,
    normalizeRequiredTemplateId,
    toMessageTemplateRecord,
    toPostedMessageRecord,
} from './posting_model.js';

describe('posting model', () => {
    it('normalizes message template input like the Postgres repository', () => {
        const document = buildMessageTemplateDocument(
            {
                content: ' Ship it ',
                createdByUserId: ' user-1 ',
                embeds: [{ title: 'Release' }],
                guildId: ' guild-1 ',
                name: ' Release update ',
            },
            '2026-07-03T08:00:00.000Z',
            undefined,
            () => 'template-1'
        );

        expect(document).toEqual({
            ok: true,
            value: {
                content: 'Ship it',
                createdAt: '2026-07-03T08:00:00.000Z',
                createdByUserId: 'user-1',
                embeds: [{ title: 'Release' }],
                guildId: 'guild-1',
                legacyId: 'template-1',
                name: 'Release update',
                updatedAt: '2026-07-03T08:00:00.000Z',
            },
        });

        if (!document.ok) {
            throw new Error('Expected normalized message template.');
        }

        expect(toMessageTemplateRecord(document.value)).toEqual({
            content: 'Ship it',
            createdAt: '2026-07-03T08:00:00.000Z',
            createdByUserId: 'user-1',
            embeds: [{ title: 'Release' }],
            guildId: 'guild-1',
            id: 'template-1',
            name: 'Release update',
            updatedAt: '2026-07-03T08:00:00.000Z',
        });
    });

    it('preserves template legacy identity, creator, and created timestamp on update', () => {
        expect(
            buildMessageTemplateDocument(
                {
                    content: 'Updated',
                    createdByUserId: 'user-2',
                    guildId: 'guild-1',
                    name: 'Release update',
                },
                '2026-07-03T08:00:00.000Z',
                {
                    createdAt: '2026-07-02T08:00:00.000Z',
                    createdByUserId: 'user-1',
                    legacyId: 'existing-template',
                }
            )
        ).toEqual({
            ok: true,
            value: {
                content: 'Updated',
                createdAt: '2026-07-02T08:00:00.000Z',
                createdByUserId: 'user-1',
                embeds: [],
                guildId: 'guild-1',
                legacyId: 'existing-template',
                name: 'Release update',
                updatedAt: '2026-07-03T08:00:00.000Z',
            },
        });
    });

    it('rejects empty template messages and invalid embeds', () => {
        expect(
            buildMessageTemplateDocument({ guildId: 'guild-1', name: 'Release' }, '2026-07-03T08:00:00.000Z')
        ).toEqual({
            error: { field: 'message', type: 'missing-input' },
            ok: false,
        });
        expect(
            buildMessageTemplateDocument(
                {
                    content: 'Ship it',
                    embeds: 'bad' as unknown as unknown[],
                    guildId: 'guild-1',
                    name: 'Release',
                },
                '2026-07-03T08:00:00.000Z'
            )
        ).toEqual({
            error: { field: 'embeds', type: 'invalid-value' },
            ok: false,
        });
    });

    it('preserves imported template timestamps and legacy ids', () => {
        expect(
            buildMessageTemplateDocument(
                {
                    content: 'Ship it',
                    createdAt: '2026-07-02 09:30:00+02',
                    guildId: 'guild-1',
                    legacyId: 'legacy-template',
                    name: 'Release',
                    updatedAt: '2026-07-03 09:30:00+02',
                },
                '2026-07-03T08:00:00.000Z'
            )
        ).toMatchObject({
            ok: true,
            value: {
                createdAt: '2026-07-02T07:30:00.000Z',
                legacyId: 'legacy-template',
                updatedAt: '2026-07-03T07:30:00.000Z',
            },
        });
    });

    it('normalizes posted message input and defaults purpose', () => {
        const document = buildPostedMessageDocument(
            {
                channelId: ' channel-1 ',
                createdByUserId: ' user-1 ',
                guildId: ' guild-1 ',
                messageId: ' message-1 ',
                templateLegacyId: ' template-1 ',
            },
            '2026-07-03T08:00:00.000Z',
            undefined,
            () => 'posted-1'
        );

        expect(document).toEqual({
            ok: true,
            value: {
                channelId: 'channel-1',
                createdAt: '2026-07-03T08:00:00.000Z',
                createdByUserId: 'user-1',
                guildId: 'guild-1',
                legacyId: 'posted-1',
                messageId: 'message-1',
                purpose: 'manual',
                templateLegacyId: 'template-1',
                updatedAt: '2026-07-03T08:00:00.000Z',
            },
        });

        if (!document.ok) {
            throw new Error('Expected normalized posted message.');
        }

        expect(toPostedMessageRecord(document.value)).toEqual({
            channelId: 'channel-1',
            createdAt: '2026-07-03T08:00:00.000Z',
            createdByUserId: 'user-1',
            guildId: 'guild-1',
            id: 'posted-1',
            messageId: 'message-1',
            purpose: 'manual',
            templateId: 'template-1',
            updatedAt: '2026-07-03T08:00:00.000Z',
        });
    });

    it('preserves posted message legacy identity and created timestamp on update', () => {
        expect(
            buildPostedMessageDocument(
                {
                    channelId: 'channel-1',
                    createdByUserId: 'user-2',
                    guildId: 'guild-1',
                    messageId: 'message-1',
                    purpose: 'dashboard',
                },
                '2026-07-03T08:00:00.000Z',
                {
                    createdAt: '2026-07-02T08:00:00.000Z',
                    legacyId: 'existing-posted',
                }
            )
        ).toEqual({
            ok: true,
            value: {
                channelId: 'channel-1',
                createdAt: '2026-07-02T08:00:00.000Z',
                createdByUserId: 'user-2',
                guildId: 'guild-1',
                legacyId: 'existing-posted',
                messageId: 'message-1',
                purpose: 'dashboard',
                updatedAt: '2026-07-03T08:00:00.000Z',
            },
        });
    });

    it('normalizes lookup and limit helpers', () => {
        expect(normalizePostedMessageLookupInput({ channelId: ' c ', guildId: ' g ', messageId: ' m ' })).toEqual({
            ok: true,
            value: {
                channelId: 'c',
                guildId: 'g',
                messageId: 'm',
            },
        });
        expect(normalizeRequiredGuildId(' guild-1 ')).toEqual({ ok: true, value: 'guild-1' });
        expect(normalizeRequiredTemplateId(' template-1 ')).toEqual({ ok: true, value: 'template-1' });
        expect(normalizeMessageTemplateLimit(undefined)).toBe(50);
        expect(normalizeMessageTemplateLimit(0)).toBe(1);
        expect(normalizeMessageTemplateLimit(500)).toBe(100);
    });
});

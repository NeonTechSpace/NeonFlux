import { describe, expect, it } from 'vitest';

import { buildMessageTemplateDocument, buildPostedMessageDocument } from './posting_model.js';

describe('posting model', () => {
    it('normalizes message template input to the app-facing contract', () => {
        const document = buildMessageTemplateDocument(
            {
                content: ' Ship it ',
                createdByUserId: ' user-1 ',
                embeds: [{ title: 'Release' }],
                guildId: ' guild-1 ',
                name: ' Release update ',
            },
            '2026-07-03T08:00:00.000Z',
            undefined
        );

        expect(document).toEqual({
            ok: true,
            value: {
                content: 'Ship it',
                createdAt: '2026-07-03T08:00:00.000Z',
                createdByUserId: 'user-1',
                embeds: [{ title: 'Release' }],
                guildId: 'guild-1',
                name: 'Release update',
                updatedAt: '2026-07-03T08:00:00.000Z',
            },
        });
    });

    it('preserves template creator and created timestamp on update', () => {
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
                    embeds: 'bad',
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

    it('preserves imported template timestamps', () => {
        expect(
            buildMessageTemplateDocument(
                {
                    content: 'Ship it',
                    createdAt: '2026-07-02 09:30:00+02',
                    guildId: 'guild-1',
                    name: 'Release',
                    updatedAt: '2026-07-03 09:30:00+02',
                },
                '2026-07-03T08:00:00.000Z'
            )
        ).toMatchObject({
            ok: true,
            value: {
                createdAt: '2026-07-02T07:30:00.000Z',
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
                templateId: ' template-1 ',
            },
            '2026-07-03T08:00:00.000Z',
            undefined
        );

        expect(document).toEqual({
            ok: true,
            value: {
                channelId: 'channel-1',
                createdAt: '2026-07-03T08:00:00.000Z',
                createdByUserId: 'user-1',
                guildId: 'guild-1',
                messageId: 'message-1',
                purpose: 'manual',
                templateId: 'template-1',
                updatedAt: '2026-07-03T08:00:00.000Z',
            },
        });
    });

    it('preserves posted message created timestamp on update', () => {
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
                }
            )
        ).toEqual({
            ok: true,
            value: {
                channelId: 'channel-1',
                createdAt: '2026-07-02T08:00:00.000Z',
                createdByUserId: 'user-2',
                guildId: 'guild-1',
                messageId: 'message-1',
                purpose: 'dashboard',
                updatedAt: '2026-07-03T08:00:00.000Z',
            },
        });
    });
});

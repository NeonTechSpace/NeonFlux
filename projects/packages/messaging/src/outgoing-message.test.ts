import { describe, expect, it } from 'vitest';

import {
    hashDashboardPostingPayload,
    parseOutgoingMessage,
    serializeDashboardPostingPayload,
} from './outgoing-message.js';

describe('outgoing message contract', () => {
    it('normalizes the supported contract into deterministic serialization', () => {
        const result = parseOutgoingMessage({
            content: ' hello ',
            embeds: [
                {
                    author: { name: ' NeonFlux ', iconUrl: 'https://example.com/icon.png' },
                    color: 0x00ffd5,
                    description: ' Update ',
                    fields: [{ name: 'Status', value: 'Ready', inline: true }],
                    footer: { text: ' Footer ' },
                    imageUrl: 'https://example.com/image.png',
                    timestamp: '2026-07-14T10:00:00+02:00',
                    title: ' Launch ',
                    url: 'https://example.com/launch',
                },
            ],
        });

        expect(result.isOk()).toBe(true);
        expect(serializeDashboardPostingPayload(' channel-1 ', result._unsafeUnwrap())).toBe(
            '{"channelId":"channel-1","content":"hello","embeds":[{"author":{"name":"NeonFlux","iconUrl":"https://example.com/icon.png"},"color":65493,"description":"Update","fields":[{"name":"Status","value":"Ready","inline":true}],"footer":{"text":"Footer"},"imageUrl":"https://example.com/image.png","timestamp":"2026-07-14T08:00:00.000Z","title":"Launch","url":"https://example.com/launch"}]}'
        );
    });

    it('rejects provider escape hatches and malformed nested data', () => {
        const unknownKey = parseOutgoingMessage({ embeds: [{ title: 'Launch', video: { url: 'https://x.test' } }] });
        const invalidFooter = parseOutgoingMessage({ embeds: [{ footer: { iconUrl: 'https://x.test/icon.png' } }] });

        expect(unknownKey._unsafeUnwrapErr()).toStrictEqual({ code: 'unknown-field', path: 'message.embeds.0.video' });
        expect(invalidFooter._unsafeUnwrapErr()).toStrictEqual({
            code: 'missing-required-field',
            path: 'message.embeds.0.footer.text',
        });
    });

    it('hashes the canonical channel and message payload', async () => {
        const message = parseOutgoingMessage({ content: 'hello', embeds: [] })._unsafeUnwrap();

        await expect(hashDashboardPostingPayload('channel-1', message)).resolves.toBe(
            '3042ce5f5d0fe8731787fdb927c1c5d897827130fc37b0d6b6927eaebb1d5e29'
        );
        expect(serializeDashboardPostingPayload('channel-1', message, { allowMassMentions: true })).toBe(
            '{"channelId":"channel-1","content":"hello","embeds":[],"allowMassMentions":true}'
        );
        await expect(hashDashboardPostingPayload('channel-1', message, { allowMassMentions: true })).resolves.not.toBe(
            '3042ce5f5d0fe8731787fdb927c1c5d897827130fc37b0d6b6927eaebb1d5e29'
        );
    });

    it('rejects empty messages and unsafe URL schemes', () => {
        expect(parseOutgoingMessage({ content: ' ', embeds: [] })._unsafeUnwrapErr().code).toBe('empty-message');
        expect(
            parseOutgoingMessage({ embeds: [{ title: 'Launch', url: 'javascript:alert(1)' }] })._unsafeUnwrapErr()
        ).toStrictEqual({ code: 'invalid-url', path: 'message.embeds.0.url' });
    });
});

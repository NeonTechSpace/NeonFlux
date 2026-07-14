import { afterEach, describe, expect, it, vi } from 'vitest';

import type { BotMessageCreatedEvent } from './bot-feature-types.js';
import { getBotPresenceReply } from './bot-presence.js';

describe('contextless mention state', () => {
    afterEach(() => {
        vi.useRealTimers();
    });

    it('expires an inactive actor so public traffic does not create permanent state', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-07-10T08:00:00.000Z'));
        const event = createMessageEvent();

        const firstReply = getBotPresenceReply(event, { type: 'contextless-mention' });
        const secondReply = getBotPresenceReply(event, { type: 'contextless-mention' });

        expect(secondReply).not.toBe(firstReply);

        vi.advanceTimersByTime(16 * 60 * 1000);

        expect(getBotPresenceReply(event, { type: 'contextless-mention' })).toBe(firstReply);
    });
});

function createMessageEvent(): BotMessageCreatedEvent {
    return {
        type: 'message.created',
        createdAt: new Date('2026-07-14T01:02:03.000Z'),
        messageId: 'message-1',
        channelId: 'channel-1',
        guildId: 'guild-1',
        authorId: 'actor-with-expiring-state',
        authorIsBot: false,
        authorRoleIds: [],
        authorIsServerOwner: false,
        authorHasManageServer: false,
        content: '<@bot-user>',
        mentionedUserIds: ['bot-user'],
    };
}

import { describe, expect, it, vi } from 'vitest';

import type { BotFeatureRoutingContext, BotMessageCreatedEvent } from './bot-feature-types.js';
import { routeMessageCreatedEvent } from './bot-message-created-router.js';

describe('message-created growth observability', () => {
    it('does not block normal routing when telemetry is saturated', async () => {
        const enqueue = vi.fn(() => 'overloaded' as const);
        const result = await routeMessageCreatedEvent(createContext(enqueue), createEvent());

        expect(result._unsafeUnwrap()).toEqual({
            eventType: 'message.created',
            reason: 'bot-user-unavailable',
            status: 'ignored',
        });
        expect(enqueue).toHaveBeenCalledWith({
            authorIsBot: false,
            guildId: 'guild-1',
            messageId: 'private-message',
            occurredAt: new Date('2026-07-14T01:02:03.000Z'),
            type: 'message.created',
        });
        expect(JSON.stringify(enqueue.mock.calls)).not.toContain('private message content');
    });
});

function createContext(enqueue: BotFeatureRoutingContext['growthTelemetry']['enqueue']): BotFeatureRoutingContext {
    return {
        appEnv: 'production',
        client: {} as BotFeatureRoutingContext['client'],
        db: {} as BotFeatureRoutingContext['db'],
        growthTelemetry: { enqueue },
        guildDefconOverride: 'auto',
        logger: { warn: vi.fn() },
        mode: { instanceMode: 'multi' },
    };
}

function createEvent(): BotMessageCreatedEvent {
    return {
        authorHasManageServer: false,
        authorId: 'private-author',
        authorIsBot: false,
        authorIsServerOwner: false,
        authorRoleIds: ['private-role'],
        channelId: 'private-channel',
        content: 'private message content',
        createdAt: new Date('2026-07-14T01:02:03.000Z'),
        guildId: 'guild-1',
        mentionedUserIds: [],
        messageId: 'private-message',
        type: 'message.created',
    };
}

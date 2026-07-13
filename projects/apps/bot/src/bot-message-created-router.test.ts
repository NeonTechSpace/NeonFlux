import { recordGuildMessageActivity } from '@neonflux/db';
import { err } from 'neverthrow';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { BotFeatureHandlerContext, BotMessageCreatedEvent } from './bot-feature-types.js';
import { routeMessageCreatedEvent } from './bot-message-created-router.js';

vi.mock('@neonflux/db', () => ({ recordGuildMessageActivity: vi.fn() }));

describe('message-created growth observability', () => {
    const logger = { warn: vi.fn() };
    const context: BotFeatureHandlerContext = {
        appEnv: 'production',
        client: {} as BotFeatureHandlerContext['client'],
        db: {} as BotFeatureHandlerContext['db'],
        guildDefconOverride: 'auto',
        logger,
        mode: { instanceMode: 'multi' },
    };
    const event: BotMessageCreatedEvent = {
        authorHasManageServer: false,
        authorId: 'private-author',
        authorIsBot: false,
        authorIsServerOwner: false,
        authorRoleIds: ['private-role'],
        channelId: 'private-channel',
        content: 'private message content',
        guildId: 'guild-1',
        mentionedUserIds: [],
        messageId: 'private-message',
        type: 'message.created',
    };

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('warns on a recoverable growth database error and still routes the message', async () => {
        vi.mocked(recordGuildMessageActivity).mockResolvedValue(err({ type: 'database-error' }));

        const result = await routeMessageCreatedEvent(context, event);

        expect(result._unsafeUnwrap()).toEqual({
            eventType: 'message.created',
            reason: 'bot-user-unavailable',
            status: 'ignored',
        });
        expect(logger.warn).toHaveBeenCalledExactlyOnceWith('bot.growth_tracking_failed', {
            error: 'database-error',
            eventType: 'message.created',
            guildId: 'guild-1',
        });
    });

    it('normalizes a thrown database-boundary failure without logging its cause and still routes the message', async () => {
        vi.mocked(recordGuildMessageActivity).mockRejectedValue(
            new Error('private message content private-author private-message')
        );

        const result = await routeMessageCreatedEvent(context, event);

        expect(result._unsafeUnwrap()).toEqual({
            eventType: 'message.created',
            reason: 'bot-user-unavailable',
            status: 'ignored',
        });
        expect(logger.warn).toHaveBeenCalledExactlyOnceWith('bot.growth_tracking_failed', {
            error: 'unexpected-error',
            eventType: 'message.created',
            guildId: 'guild-1',
        });
        expect(JSON.stringify(logger.warn.mock.calls)).not.toContain('private');
    });
});

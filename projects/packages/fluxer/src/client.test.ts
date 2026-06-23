import { Events, type Guild, type Message, type User } from '@fluxerjs/core';
import type { AppLogger } from '@neonflux/core/logging';
import { describe, expect, it, vi } from 'vitest';

import {
    createFluxerBot,
    type FluxerBotConfig,
    type FluxerBotGuildEvent,
    type FluxerBotMessageEvent,
} from './client.js';

describe('createFluxerBot lifecycle handlers', () => {
    it('calls guildCreated with only the guild id on GuildCreate', () => {
        const guildCreated = vi.fn<(event: FluxerBotGuildEvent) => void>();
        const bot = createFluxerBot(createConfig(), createLogger(), {
            guildCreated,
        });

        bot.client.emit(Events.GuildCreate, createGuild('guild-1'));

        const event = guildCreated.mock.calls[0]?.[0];

        expect(event).toStrictEqual({
            guildId: 'guild-1',
        });
        expect(event ? Object.keys(event) : []).toStrictEqual(['guildId']);
    });

    it('calls guildDeleted with only the guild id on GuildDelete', () => {
        const guildDeleted = vi.fn<(event: FluxerBotGuildEvent) => void>();
        const bot = createFluxerBot(createConfig(), createLogger(), {
            guildDeleted,
        });

        bot.client.emit(Events.GuildDelete, createGuild('guild-1'));

        const event = guildDeleted.mock.calls[0]?.[0];

        expect(event).toStrictEqual({
            guildId: 'guild-1',
        });
        expect(event ? Object.keys(event) : []).toStrictEqual(['guildId']);
    });

    it('catches and logs guild handler failures', async () => {
        const logger = createLogger();
        const handlerError = new Error('handler failed');
        const bot = createFluxerBot(createConfig(), logger, {
            guildCreated: () => Promise.reject(handlerError),
        });

        bot.client.emit(Events.GuildCreate, createGuild('guild-1'));
        await settleAsyncHandler();

        expect(logger.error).toHaveBeenCalledWith('fluxer.guild_created_handler_failed', {
            guildId: 'guild-1',
        });
    });

    it('treats guild events without handlers as harmless', () => {
        const logger = createLogger();
        const bot = createFluxerBot(createConfig(), logger);

        expect(() => {
            bot.client.emit(Events.GuildCreate, createGuild('guild-1'));
            bot.client.emit(Events.GuildDelete, createGuild('guild-1'));
        }).not.toThrow();
        expect(logger.error).not.toHaveBeenCalled();
    });

    it('calls messageCreated with normalized message data on MessageCreate', () => {
        const messageCreated = vi.fn<(event: FluxerBotMessageEvent) => void>();
        const bot = createFluxerBot(createConfig(), createLogger(), {
            messageCreated,
        });

        bot.client.emit(
            Events.MessageCreate,
            createMessage({
                mentions: [createUser('mentioned-1'), createUser('mentioned-2')],
            })
        );

        const event = messageCreated.mock.calls[0]?.[0];

        expect(event).toStrictEqual({
            messageId: 'message-1',
            channelId: 'channel-1',
            guildId: 'guild-1',
            authorId: 'author-1',
            authorIsBot: false,
            content: '<@bot-user>',
            mentionedUserIds: ['mentioned-1', 'mentioned-2'],
        });
        expect(event ? Object.keys(event) : []).toStrictEqual([
            'messageId',
            'channelId',
            'guildId',
            'authorId',
            'authorIsBot',
            'content',
            'mentionedUserIds',
        ]);
    });

    it('catches and logs message handler failures', async () => {
        const logger = createLogger();
        const bot = createFluxerBot(createConfig(), logger, {
            messageCreated: () => Promise.reject(new Error('handler failed')),
        });

        bot.client.emit(Events.MessageCreate, createMessage());
        await settleAsyncHandler();

        expect(logger.error).toHaveBeenCalledWith('fluxer.message_created_handler_failed', {
            messageId: 'message-1',
            channelId: 'channel-1',
            guildId: 'guild-1',
        });
    });

    it('treats message events without handlers as harmless', () => {
        const logger = createLogger();
        const bot = createFluxerBot(createConfig(), logger);

        expect(() => {
            bot.client.emit(Events.MessageCreate, createMessage());
        }).not.toThrow();
        expect(logger.error).not.toHaveBeenCalled();
    });
});

function createGuild(id: string): Guild {
    return {
        id,
    } as Guild;
}

function createMessage(overrides: Partial<Message> = {}): Message {
    return {
        id: 'message-1',
        channelId: 'channel-1',
        guildId: 'guild-1',
        author: createUser('author-1'),
        content: '<@bot-user>',
        mentions: [],
        ...overrides,
    } as Message;
}

function createUser(id: string, overrides: Partial<User> = {}): User {
    return {
        id,
        bot: false,
        ...overrides,
    } as User;
}

function createConfig(): FluxerBotConfig {
    return {
        instanceMode: 'multi',
    };
}

function createLogger() {
    return {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
    } satisfies AppLogger;
}

function settleAsyncHandler(): Promise<void> {
    return new Promise((resolve) => {
        setTimeout(resolve, 0);
    });
}

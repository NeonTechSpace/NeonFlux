import type { AppMode } from '@neonflux/config';
import {
    deleteBotInstallation,
    findGuildSecurityPolicyByGuildId,
    listGuildDefconExemptionCategories,
    upsertBotInstallation,
    type BotInstallationRecord,
} from '@neonflux/db';
import { sendFluxerChannelMessage, type FluxerBot } from '@neonflux/fluxer';
import { err, ok } from 'neverthrow';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
    DEFAULT_BOT_COMMAND_PREFIX,
    routeBotFeatureEvent,
    type BotFeatureHandlerContext,
} from './bot-feature-router.js';

vi.mock('@neonflux/db', () => {
    return {
        deleteBotInstallation: vi.fn(),
        findGuildSecurityPolicyByGuildId: vi.fn(),
        listGuildDefconExemptionCategories: vi.fn(),
        upsertBotInstallation: vi.fn(),
    };
});

vi.mock('@neonflux/fluxer', () => {
    return {
        sendFluxerChannelMessage: vi.fn(),
    };
});

const upsertBotInstallationMock = vi.mocked(upsertBotInstallation);
const deleteBotInstallationMock = vi.mocked(deleteBotInstallation);
const findGuildSecurityPolicyByGuildIdMock = vi.mocked(findGuildSecurityPolicyByGuildId);
const listGuildDefconExemptionCategoriesMock = vi.mocked(listGuildDefconExemptionCategories);
const sendFluxerChannelMessageMock = vi.mocked(sendFluxerChannelMessage);
const testDb = {} as BotFeatureHandlerContext['db'];
const testClient = {} as FluxerBot['client'];

describe('routeBotFeatureEvent', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        findGuildSecurityPolicyByGuildIdMock.mockResolvedValue(err('not-found'));
        listGuildDefconExemptionCategoriesMock.mockResolvedValue(ok([]));
        sendFluxerChannelMessageMock.mockResolvedValue(
            ok({
                id: 'reply-1',
                channelId: 'channel-1',
                guildId: 'guild-1',
            })
        );
    });

    it('uses ! as the default bot command prefix', () => {
        expect(DEFAULT_BOT_COMMAND_PREFIX).toBe('!');
    });

    it('records only the configured guild in single mode', async () => {
        upsertBotInstallationMock.mockResolvedValue(ok(createInstallation('target')));

        const ignoredResult = await routeBotFeatureEvent(createContext(createSingleMode()), {
            type: 'guild.lifecycle.created',
            guildId: 'other',
        });

        expect(ignoredResult.isOk()).toBe(true);
        expect(ignoredResult._unsafeUnwrap()).toStrictEqual({
            eventType: 'guild.lifecycle.created',
            status: 'ignored',
        });
        expect(upsertBotInstallationMock).not.toHaveBeenCalled();

        const handledResult = await routeBotFeatureEvent(createContext(createSingleMode()), {
            type: 'guild.lifecycle.created',
            guildId: 'target',
        });

        expect(handledResult.isOk()).toBe(true);
        expect(handledResult._unsafeUnwrap()).toStrictEqual({
            eventType: 'guild.lifecycle.created',
            status: 'handled',
        });
        expect(upsertBotInstallationMock).toHaveBeenCalledWith(testDb, {
            guildId: 'target',
        });
    });

    it('records any guild in multi mode', async () => {
        upsertBotInstallationMock.mockResolvedValue(ok(createInstallation('guild-1')));

        const result = await routeBotFeatureEvent(createContext(createMultiMode()), {
            type: 'guild.lifecycle.created',
            guildId: 'guild-1',
        });

        expect(result.isOk()).toBe(true);
        expect(result._unsafeUnwrap()).toStrictEqual({
            eventType: 'guild.lifecycle.created',
            status: 'handled',
        });
        expect(upsertBotInstallationMock).toHaveBeenCalledWith(testDb, {
            guildId: 'guild-1',
        });
    });

    it('removes only the configured guild in single mode', async () => {
        deleteBotInstallationMock.mockResolvedValue(ok(createInstallation('target')));

        const ignoredResult = await routeBotFeatureEvent(createContext(createSingleMode()), {
            type: 'guild.lifecycle.deleted',
            guildId: 'other',
        });

        expect(ignoredResult.isOk()).toBe(true);
        expect(ignoredResult._unsafeUnwrap()).toStrictEqual({
            eventType: 'guild.lifecycle.deleted',
            status: 'ignored',
        });
        expect(deleteBotInstallationMock).not.toHaveBeenCalled();

        const handledResult = await routeBotFeatureEvent(createContext(createSingleMode()), {
            type: 'guild.lifecycle.deleted',
            guildId: 'target',
        });

        expect(handledResult.isOk()).toBe(true);
        expect(handledResult._unsafeUnwrap()).toStrictEqual({
            eventType: 'guild.lifecycle.deleted',
            status: 'handled',
        });
        expect(deleteBotInstallationMock).toHaveBeenCalledWith(testDb, {
            guildId: 'target',
        });
    });

    it('removes any guild in multi mode', async () => {
        deleteBotInstallationMock.mockResolvedValue(ok(createInstallation('guild-1')));

        const result = await routeBotFeatureEvent(createContext(createMultiMode()), {
            type: 'guild.lifecycle.deleted',
            guildId: 'guild-1',
        });

        expect(result.isOk()).toBe(true);
        expect(result._unsafeUnwrap()).toStrictEqual({
            eventType: 'guild.lifecycle.deleted',
            status: 'handled',
        });
        expect(deleteBotInstallationMock).toHaveBeenCalledWith(testDb, {
            guildId: 'guild-1',
        });
    });

    it('ignores stale delete events when the installation is already gone', async () => {
        deleteBotInstallationMock.mockResolvedValue(err('not-found'));

        const result = await routeBotFeatureEvent(createContext(createMultiMode()), {
            type: 'guild.lifecycle.deleted',
            guildId: 'guild-1',
        });

        expect(result.isOk()).toBe(true);
        expect(result._unsafeUnwrap()).toStrictEqual({
            eventType: 'guild.lifecycle.deleted',
            status: 'ignored',
        });
    });

    it('returns database-error when installation tracking cannot write', async () => {
        upsertBotInstallationMock.mockResolvedValue(err('database-error'));

        const result = await routeBotFeatureEvent(createContext(createMultiMode()), {
            type: 'guild.lifecycle.created',
            guildId: 'guild-1',
        });

        expect(result.isErr()).toBe(true);
        expect(result._unsafeUnwrapErr()).toBe('database-error');
    });

    it('returns handler-error when a feature handler throws unexpectedly', async () => {
        upsertBotInstallationMock.mockRejectedValue(new Error('unexpected'));

        const result = await routeBotFeatureEvent(createContext(createMultiMode()), {
            type: 'guild.lifecycle.created',
            guildId: 'guild-1',
        });

        expect(result.isErr()).toBe(true);
        expect(result._unsafeUnwrapErr()).toBe('handler-error');
    });

    it('replies to !ping with the no-pong message', async () => {
        const result = await routeBotFeatureEvent(
            createContext(createMultiMode(), {
                botUserId: undefined,
            }),
            createMessageEvent({
                content: '!ping',
                mentionedUserIds: [],
            })
        );

        expect(result.isOk()).toBe(true);
        expect(result._unsafeUnwrap()).toStrictEqual({
            eventType: 'message.created',
            status: 'handled',
        });
        expect(sendFluxerChannelMessageMock).toHaveBeenCalledWith({
            client: testClient,
            channelId: 'channel-1',
            content: "Yes, I'm here, and no, I don't pong",
        });
        expect(findGuildSecurityPolicyByGuildIdMock).toHaveBeenCalledWith(testDb, { guildId: 'guild-1' });
    });

    it('treats ping command casing and whitespace as a ping command', async () => {
        const result = await routeBotFeatureEvent(
            createContext(createMultiMode()),
            createMessageEvent({
                content: '  !PiNg  ',
                mentionedUserIds: [],
            })
        );

        expect(result.isOk()).toBe(true);
        expect(result._unsafeUnwrap()).toStrictEqual({
            eventType: 'message.created',
            status: 'handled',
        });
        expect(sendFluxerChannelMessageMock).toHaveBeenCalledWith({
            client: testClient,
            channelId: 'channel-1',
            content: "Yes, I'm here, and no, I don't pong",
        });
    });

    it('escalates contextless bot mention replies before cooldown', async () => {
        const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(new Date('2026-06-23T20:00:00.000Z').getTime());
        const context = createContext(createMultiMode());
        const authorId = 'contextless-author-1';

        for (const content of [
            "I hate it when people think that saying someone's name just to see if they're there is proper communication. Just say what's on your mind please",
            "I don't appreciate being called for nothing",
            'I will no longer respond to that...',
        ]) {
            const result = await routeBotFeatureEvent(
                context,
                createMessageEvent({
                    authorId,
                    content: '<@bot-user>',
                    mentionedUserIds: ['bot-user'],
                })
            );

            expect(result.isOk()).toBe(true);
            expect(result._unsafeUnwrap()).toStrictEqual({
                eventType: 'message.created',
                status: 'handled',
            });
            expect(sendFluxerChannelMessageMock).toHaveBeenLastCalledWith({
                client: testClient,
                channelId: 'channel-1',
                content,
            });
        }

        nowSpy.mockRestore();
    });

    it('ignores contextless bot mentions during cooldown', async () => {
        const startedAt = new Date('2026-06-23T20:00:00.000Z').getTime();
        const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(startedAt);
        const context = createContext(createMultiMode());
        const authorId = 'contextless-author-2';

        for (let index = 0; index < 3; index += 1) {
            await routeBotFeatureEvent(
                context,
                createMessageEvent({
                    authorId,
                    content: '<@bot-user>',
                    mentionedUserIds: ['bot-user'],
                })
            );
        }

        const result = await routeBotFeatureEvent(
            context,
            createMessageEvent({
                authorId,
                content: '<@bot-user>',
                mentionedUserIds: ['bot-user'],
            })
        );

        expect(result.isOk()).toBe(true);
        expect(result._unsafeUnwrap()).toStrictEqual({
            eventType: 'message.created',
            reason: 'contextless-mention-cooldown',
            status: 'ignored',
        });
        expect(sendFluxerChannelMessageMock).toHaveBeenCalledTimes(3);

        nowSpy.mockRestore();
    });

    it('reminds after contextless mention cooldown expires and starts another cooldown', async () => {
        const startedAt = new Date('2026-06-23T20:00:00.000Z').getTime();
        const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(startedAt);
        const context = createContext(createMultiMode());
        const authorId = 'contextless-author-3';

        for (let index = 0; index < 3; index += 1) {
            await routeBotFeatureEvent(
                context,
                createMessageEvent({
                    authorId,
                    content: '<@bot-user>',
                    mentionedUserIds: ['bot-user'],
                })
            );
        }

        nowSpy.mockReturnValue(startedAt + 5 * 60 * 1000);

        const reminderResult = await routeBotFeatureEvent(
            context,
            createMessageEvent({
                authorId,
                content: '<@bot-user>',
                mentionedUserIds: ['bot-user'],
            })
        );

        expect(reminderResult.isOk()).toBe(true);
        expect(reminderResult._unsafeUnwrap()).toStrictEqual({
            eventType: 'message.created',
            status: 'handled',
        });
        expect(sendFluxerChannelMessageMock).toHaveBeenLastCalledWith({
            client: testClient,
            channelId: 'channel-1',
            content: "We've been here before... back to ignoring I suppose",
        });

        const ignoredResult = await routeBotFeatureEvent(
            context,
            createMessageEvent({
                authorId,
                content: '<@bot-user>',
                mentionedUserIds: ['bot-user'],
            })
        );

        expect(ignoredResult.isOk()).toBe(true);
        expect(ignoredResult._unsafeUnwrap()).toStrictEqual({
            eventType: 'message.created',
            reason: 'contextless-mention-cooldown',
            status: 'ignored',
        });

        nowSpy.mockRestore();
    });

    it('ignores messages that do not mention the bot', async () => {
        const result = await routeBotFeatureEvent(
            createContext(createMultiMode()),
            createMessageEvent({
                mentionedUserIds: ['other-user'],
            })
        );

        expect(result.isOk()).toBe(true);
        expect(result._unsafeUnwrap()).toStrictEqual({
            eventType: 'message.created',
            reason: 'bot-not-mentioned',
            status: 'ignored',
        });
        expect(sendFluxerChannelMessageMock).not.toHaveBeenCalled();
        expect(findGuildSecurityPolicyByGuildIdMock).not.toHaveBeenCalled();
    });

    it('ignores bot mentions when the message includes context', async () => {
        const result = await routeBotFeatureEvent(
            createContext(createMultiMode()),
            createMessageEvent({
                content: '<@bot-user> please help with logging',
                mentionedUserIds: ['bot-user'],
            })
        );

        expect(result.isOk()).toBe(true);
        expect(result._unsafeUnwrap()).toStrictEqual({
            eventType: 'message.created',
            reason: 'bot-mentioned-with-context',
            status: 'ignored',
        });
        expect(sendFluxerChannelMessageMock).not.toHaveBeenCalled();
        expect(findGuildSecurityPolicyByGuildIdMock).not.toHaveBeenCalled();
    });

    it('ignores bot-authored mention messages', async () => {
        const result = await routeBotFeatureEvent(
            createContext(createMultiMode()),
            createMessageEvent({
                authorIsBot: true,
            })
        );

        expect(result.isOk()).toBe(true);
        expect(result._unsafeUnwrap()).toStrictEqual({
            eventType: 'message.created',
            reason: 'bot-authored-message',
            status: 'ignored',
        });
        expect(sendFluxerChannelMessageMock).not.toHaveBeenCalled();
        expect(findGuildSecurityPolicyByGuildIdMock).not.toHaveBeenCalled();
    });

    it('uses single-mode guild gating before replying to mentions', async () => {
        const ignoredResult = await routeBotFeatureEvent(
            createContext(createSingleMode()),
            createMessageEvent({
                guildId: 'other',
            })
        );

        expect(ignoredResult.isOk()).toBe(true);
        expect(ignoredResult._unsafeUnwrap()).toStrictEqual({
            eventType: 'message.created',
            reason: 'guild-not-processable',
            status: 'ignored',
        });
        expect(sendFluxerChannelMessageMock).not.toHaveBeenCalled();
        expect(findGuildSecurityPolicyByGuildIdMock).not.toHaveBeenCalled();

        const handledResult = await routeBotFeatureEvent(
            createContext(createSingleMode()),
            createMessageEvent({
                content: '!ping',
                guildId: 'target',
                mentionedUserIds: [],
            })
        );

        expect(handledResult.isOk()).toBe(true);
        expect(handledResult._unsafeUnwrap()).toStrictEqual({
            eventType: 'message.created',
            status: 'handled',
        });
        expect(sendFluxerChannelMessageMock).toHaveBeenCalledWith({
            client: testClient,
            channelId: 'channel-1',
            content: "Yes, I'm here, and no, I don't pong",
        });
    });

    it('ignores mention messages when the bot user id is unavailable', async () => {
        const result = await routeBotFeatureEvent(createContext(createMultiMode(), { botUserId: undefined }), {
            ...createMessageEvent(),
        });

        expect(result.isOk()).toBe(true);
        expect(result._unsafeUnwrap()).toStrictEqual({
            eventType: 'message.created',
            reason: 'bot-user-unavailable',
            status: 'ignored',
        });
        expect(sendFluxerChannelMessageMock).not.toHaveBeenCalled();
        expect(findGuildSecurityPolicyByGuildIdMock).not.toHaveBeenCalled();
    });

    it('allows public bot mentions in development DEFCON 2 default', async () => {
        const result = await routeBotFeatureEvent(
            createContext(createMultiMode(), {
                appEnv: 'development',
                guildDefconOverride: 'auto',
            }),
            createMessageEvent()
        );

        expect(result.isOk()).toBe(true);
        expect(result._unsafeUnwrap()).toStrictEqual({
            eventType: 'message.created',
            status: 'handled',
        });
        expect(sendFluxerChannelMessageMock).toHaveBeenCalledOnce();
    });

    it('blocks public bot mentions in DEFCON 1 unless the category is exempt', async () => {
        findGuildSecurityPolicyByGuildIdMock.mockResolvedValueOnce(
            ok({
                guildId: 'guild-1',
                defconLevel: 1,
                createdAt: new Date('2026-06-23T00:00:00.000Z'),
                updatedAt: new Date('2026-06-23T00:00:00.000Z'),
            })
        );

        const blockedResult = await routeBotFeatureEvent(createContext(createMultiMode()), createMessageEvent());

        expect(blockedResult.isOk()).toBe(true);
        expect(blockedResult._unsafeUnwrap()).toStrictEqual({
            eventType: 'message.created',
            reason: 'defcon-denied',
            status: 'ignored',
        });
        expect(sendFluxerChannelMessageMock).not.toHaveBeenCalled();

        findGuildSecurityPolicyByGuildIdMock.mockResolvedValueOnce(
            ok({
                guildId: 'guild-1',
                defconLevel: 1,
                createdAt: new Date('2026-06-23T00:00:00.000Z'),
                updatedAt: new Date('2026-06-23T00:00:00.000Z'),
            })
        );
        listGuildDefconExemptionCategoriesMock.mockResolvedValueOnce(ok(['bot_mention']));

        const exemptResult = await routeBotFeatureEvent(createContext(createMultiMode()), createMessageEvent());

        expect(exemptResult.isOk()).toBe(true);
        expect(exemptResult._unsafeUnwrap()).toStrictEqual({
            eventType: 'message.created',
            status: 'handled',
        });
        expect(sendFluxerChannelMessageMock).toHaveBeenCalledOnce();
    });

    it('returns database-error when bot mention DEFCON lookup fails', async () => {
        findGuildSecurityPolicyByGuildIdMock.mockResolvedValueOnce(err('database-error'));

        const result = await routeBotFeatureEvent(createContext(createMultiMode()), createMessageEvent());

        expect(result.isErr()).toBe(true);
        expect(result._unsafeUnwrapErr()).toBe('database-error');
        expect(sendFluxerChannelMessageMock).not.toHaveBeenCalled();
    });

    it('returns message-send-error when the mention reply cannot be sent', async () => {
        sendFluxerChannelMessageMock.mockResolvedValueOnce(err({ type: 'send-failed', error: new Error('no access') }));

        const result = await routeBotFeatureEvent(createContext(createMultiMode()), createMessageEvent());

        expect(result.isErr()).toBe(true);
        expect(result._unsafeUnwrapErr()).toBe('message-send-error');
    });
});

function createContext(
    mode: AppMode,
    options: {
        botUserId?: string | undefined;
        appEnv?: BotFeatureHandlerContext['appEnv'];
        guildDefconOverride?: BotFeatureHandlerContext['guildDefconOverride'];
    } = {}
): BotFeatureHandlerContext {
    const botUserId = 'botUserId' in options ? options.botUserId : 'bot-user';

    return {
        db: testDb,
        mode,
        appEnv: options.appEnv ?? 'production',
        guildDefconOverride: options.guildDefconOverride ?? 'auto',
        client: testClient,
        ...(botUserId ? { botUserId } : {}),
    };
}

function createSingleMode(): AppMode {
    return {
        instanceMode: 'single',
        singleGuildId: 'target',
    };
}

function createMultiMode(): AppMode {
    return {
        instanceMode: 'multi',
    };
}

function createInstallation(guildId: string): BotInstallationRecord {
    const timestamp = new Date('2026-06-21T00:00:00.000Z');

    return {
        guildId,
        installedAt: timestamp,
        updatedAt: timestamp,
    };
}

function createMessageEvent(
    overrides: Partial<Extract<Parameters<typeof routeBotFeatureEvent>[1], { type: 'message.created' }>> = {}
): Extract<Parameters<typeof routeBotFeatureEvent>[1], { type: 'message.created' }> {
    return {
        type: 'message.created',
        messageId: 'message-1',
        channelId: 'channel-1',
        guildId: 'guild-1',
        authorId: 'author-1',
        authorIsBot: false,
        content: '<@bot-user>',
        mentionedUserIds: ['bot-user'],
        ...overrides,
    };
}

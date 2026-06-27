import type { AppMode } from '@neonflux/config';
import { COMMAND_PREFIX_INVALID_MESSAGE, DEFAULT_COMMAND_PREFIX } from '@neonflux/core/command-prefix';
import { DEFCON_FEATURE_CATEGORY } from '@neonflux/core/defcon';
import {
    deleteBotInstallation,
    findGuildCommandPermissionRule,
    findGuildCommandSettingsByGuildId,
    findGuildSecurityPolicyByGuildId,
    incrementGuildMessageActivityDay,
    listGuildDefconExemptionCategories,
    listGuildInviteSnapshots,
    recordGuildMemberFlowEvent,
    syncGuildInviteSnapshots,
    upsertGuildCommandPrefix,
    upsertBotInstallation,
    type BotInstallationRecord,
    type GuildCommandSettingsRecord,
} from '@neonflux/db';
import { readFluxerGuildInvites, sendFluxerChannelMessage, type FluxerBot } from '@neonflux/fluxer';
import { err, ok } from 'neverthrow';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { routeBotFeatureEvent, type BotFeatureHandlerContext } from './bot-feature-router.js';

vi.mock('@neonflux/db', () => {
    return {
        deleteBotInstallation: vi.fn(),
        findGuildCommandPermissionRule: vi.fn(),
        findGuildCommandSettingsByGuildId: vi.fn(),
        findGuildSecurityPolicyByGuildId: vi.fn(),
        incrementGuildMessageActivityDay: vi.fn(),
        listGuildDefconExemptionCategories: vi.fn(),
        listGuildInviteSnapshots: vi.fn(),
        recordGuildMemberFlowEvent: vi.fn(),
        syncGuildInviteSnapshots: vi.fn(),
        upsertGuildCommandPrefix: vi.fn(),
        upsertBotInstallation: vi.fn(),
    };
});

vi.mock('@neonflux/fluxer', () => {
    return {
        readFluxerGuildInvites: vi.fn(),
        sendFluxerChannelMessage: vi.fn(),
    };
});

const upsertBotInstallationMock = vi.mocked(upsertBotInstallation);
const deleteBotInstallationMock = vi.mocked(deleteBotInstallation);
const findGuildCommandPermissionRuleMock = vi.mocked(findGuildCommandPermissionRule);
const findGuildCommandSettingsByGuildIdMock = vi.mocked(findGuildCommandSettingsByGuildId);
const findGuildSecurityPolicyByGuildIdMock = vi.mocked(findGuildSecurityPolicyByGuildId);
const incrementGuildMessageActivityDayMock = vi.mocked(incrementGuildMessageActivityDay);
const listGuildDefconExemptionCategoriesMock = vi.mocked(listGuildDefconExemptionCategories);
const listGuildInviteSnapshotsMock = vi.mocked(listGuildInviteSnapshots);
const recordGuildMemberFlowEventMock = vi.mocked(recordGuildMemberFlowEvent);
const syncGuildInviteSnapshotsMock = vi.mocked(syncGuildInviteSnapshots);
const upsertGuildCommandPrefixMock = vi.mocked(upsertGuildCommandPrefix);
const readFluxerGuildInvitesMock = vi.mocked(readFluxerGuildInvites);
const sendFluxerChannelMessageMock = vi.mocked(sendFluxerChannelMessage);
const testDb = {} as BotFeatureHandlerContext['db'];
const testClient = {} as FluxerBot['client'];

describe('routeBotFeatureEvent', () => {
    beforeEach(() => {
        vi.resetAllMocks();
        findGuildCommandPermissionRuleMock.mockResolvedValue(err('not-found'));
        findGuildCommandSettingsByGuildIdMock.mockResolvedValue(err('not-found'));
        findGuildSecurityPolicyByGuildIdMock.mockResolvedValue(err('not-found'));
        incrementGuildMessageActivityDayMock.mockResolvedValue(ok(createMessageActivityRecord()));
        listGuildDefconExemptionCategoriesMock.mockResolvedValue(ok([]));
        listGuildInviteSnapshotsMock.mockResolvedValue(ok([]));
        recordGuildMemberFlowEventMock.mockResolvedValue(ok(createMemberFlowRecord()));
        syncGuildInviteSnapshotsMock.mockResolvedValue(ok([]));
        upsertGuildCommandPrefixMock.mockResolvedValue(ok(createCommandSettings('guild-1', '?')));
        readFluxerGuildInvitesMock.mockResolvedValue(ok([]));
        sendFluxerChannelMessageMock.mockResolvedValue(
            ok({
                id: 'reply-1',
                channelId: 'channel-1',
                guildId: 'guild-1',
            })
        );
    });

    it('uses ! as the default bot command prefix', () => {
        expect(DEFAULT_COMMAND_PREFIX).toBe('!');
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

    it('mode-gates scaffold events before planned features claim them', async () => {
        const ignoredByMode = await routeBotFeatureEvent(createContext(createSingleMode()), {
            type: 'reaction.added',
            messageId: 'message-1',
            channelId: 'channel-1',
            guildId: 'other',
            userId: 'user-1',
            emojiKey: 'emoji:1',
        });
        const ignoredWithoutHandler = await routeBotFeatureEvent(createContext(createMultiMode()), {
            type: 'reaction.added',
            messageId: 'message-1',
            channelId: 'channel-1',
            guildId: 'guild-1',
            userId: 'user-1',
            emojiKey: 'emoji:1',
        });

        expect(ignoredByMode.isOk()).toBe(true);
        expect(ignoredByMode._unsafeUnwrap()).toStrictEqual({
            eventType: 'reaction.added',
            status: 'ignored',
            reason: 'guild-not-processable',
        });
        expect(ignoredWithoutHandler.isOk()).toBe(true);
        expect(ignoredWithoutHandler._unsafeUnwrap()).toStrictEqual({
            eventType: 'reaction.added',
            status: 'ignored',
            reason: 'no-feature-handler',
        });
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
            action: 'command.ping',
        });
        expect(sendFluxerChannelMessageMock).toHaveBeenCalledWith({
            client: testClient,
            channelId: 'channel-1',
            content: "Yes, I'm here, and no, I don't pong",
        });
        expect(findGuildSecurityPolicyByGuildIdMock).toHaveBeenCalledWith(testDb, { guildId: 'guild-1' });
    });

    it('does not block command replies when message activity tracking fails', async () => {
        incrementGuildMessageActivityDayMock.mockResolvedValueOnce(err({ type: 'database-error' }));

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
            action: 'command.ping',
        });
        expect(sendFluxerChannelMessageMock).toHaveBeenCalledWith({
            client: testClient,
            channelId: 'channel-1',
            content: "Yes, I'm here, and no, I don't pong",
        });
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
            action: 'command.ping',
        });
        expect(sendFluxerChannelMessageMock).toHaveBeenCalledWith({
            client: testClient,
            channelId: 'channel-1',
            content: "Yes, I'm here, and no, I don't pong",
        });
    });

    it('uses stored guild prefix for ping commands', async () => {
        findGuildCommandSettingsByGuildIdMock.mockResolvedValueOnce(ok(createCommandSettings('guild-1', '?')));

        const result = await routeBotFeatureEvent(
            createContext(createMultiMode()),
            createMessageEvent({
                content: '?ping',
                mentionedUserIds: [],
            })
        );

        expect(result.isOk()).toBe(true);
        expect(result._unsafeUnwrap()).toStrictEqual({
            eventType: 'message.created',
            status: 'handled',
            action: 'command.ping',
        });
        expect(sendFluxerChannelMessageMock).toHaveBeenCalledWith({
            client: testClient,
            channelId: 'channel-1',
            content: "Yes, I'm here, and no, I don't pong",
        });
    });

    it('replies to default-prefix help with available command pages', async () => {
        const result = await routeBotFeatureEvent(
            createContext(createMultiMode()),
            createMessageEvent({
                content: '!help',
                mentionedUserIds: [],
            })
        );

        expect(result.isOk()).toBe(true);
        expect(result._unsafeUnwrap()).toStrictEqual({
            eventType: 'message.created',
            status: 'handled',
            action: 'command.help',
        });
        expect(getLastReplyContent()).toContain('NeonFlux help');
        expect(getLastReplyContent()).toContain('`!help general`');
        expect(getLastReplyContent()).toContain('`!ping`');
        expect(getLastReplyContent()).toContain('`@NeonFlux prefix ?`');
    });

    it('lists guarded commands in help even when the user cannot run them', async () => {
        const result = await routeBotFeatureEvent(
            createContext(createMultiMode()),
            createMessageEvent({
                content: '!help',
                mentionedUserIds: [],
                authorHasManageServer: false,
                authorIsServerOwner: false,
                authorRoleIds: [],
            })
        );

        expect(result.isOk()).toBe(true);
        expect(result._unsafeUnwrap()).toStrictEqual({
            eventType: 'message.created',
            status: 'handled',
            action: 'command.help',
        });
        expect(getLastReplyContent()).toContain('`@NeonFlux prefix ?`');
        expect(findGuildCommandPermissionRuleMock).not.toHaveBeenCalled();
    });

    it('uses the stored guild prefix in help examples', async () => {
        findGuildCommandSettingsByGuildIdMock.mockResolvedValueOnce(ok(createCommandSettings('guild-1', '?')));

        const result = await routeBotFeatureEvent(
            createContext(createMultiMode()),
            createMessageEvent({
                content: '?help',
                mentionedUserIds: [],
            })
        );

        expect(result.isOk()).toBe(true);
        expect(result._unsafeUnwrap()).toStrictEqual({
            eventType: 'message.created',
            status: 'handled',
            action: 'command.help',
        });
        expect(getLastReplyContent()).toContain('`?help general`');
        expect(getLastReplyContent()).toContain('`?ping`');
        expect(getLastReplyContent()).not.toContain('`!ping`');
    });

    it('uses the stored guild prefix in category help examples', async () => {
        findGuildCommandSettingsByGuildIdMock.mockResolvedValueOnce(ok(createCommandSettings('guild-1', '?')));

        const result = await routeBotFeatureEvent(
            createContext(createMultiMode()),
            createMessageEvent({
                content: '?help general',
                mentionedUserIds: [],
            })
        );

        expect(result.isOk()).toBe(true);
        expect(result._unsafeUnwrap()).toStrictEqual({
            eventType: 'message.created',
            status: 'handled',
            action: 'command.help',
        });
        expect(getLastReplyContent()).toContain('`?help [category]`');
        expect(getLastReplyContent()).toContain('`?ping`');
        expect(getLastReplyContent()).not.toContain('`!ping`');
    });

    it('replies to mentioned help before treating the mention as contextless', async () => {
        const result = await routeBotFeatureEvent(
            createContext(createMultiMode()),
            createMessageEvent({
                content: '<@bot-user> help',
                mentionedUserIds: ['bot-user'],
            })
        );

        expect(result.isOk()).toBe(true);
        expect(result._unsafeUnwrap()).toStrictEqual({
            eventType: 'message.created',
            status: 'handled',
            action: 'command.help',
        });
        expect(getLastReplyContent()).toContain('NeonFlux help');
    });

    it('replies with the requested general help page', async () => {
        const result = await routeBotFeatureEvent(
            createContext(createMultiMode()),
            createMessageEvent({
                content: '!help general',
                mentionedUserIds: [],
            })
        );

        expect(result.isOk()).toBe(true);
        expect(getLastReplyContent()).toContain('NeonFlux help: General');
        expect(getLastReplyContent()).toContain('`!help [category]`');
        expect(getLastReplyContent()).toContain('`!ping`');
        expect(getLastReplyContent()).not.toContain('@NeonFlux prefix ?');
    });

    it('replies with the requested settings help page', async () => {
        const result = await routeBotFeatureEvent(
            createContext(createMultiMode()),
            createMessageEvent({
                content: '!help settings',
                mentionedUserIds: [],
            })
        );

        expect(result.isOk()).toBe(true);
        expect(getLastReplyContent()).toContain('NeonFlux help: Settings');
        expect(getLastReplyContent()).toContain('`@NeonFlux prefix ?`');
        expect(getLastReplyContent()).not.toContain('`!ping`');
    });

    it('replies clearly for unknown help pages', async () => {
        const result = await routeBotFeatureEvent(
            createContext(createMultiMode()),
            createMessageEvent({
                content: '!help moderation',
                mentionedUserIds: [],
            })
        );

        expect(result.isOk()).toBe(true);
        expect(result._unsafeUnwrap()).toStrictEqual({
            eventType: 'message.created',
            status: 'handled',
            action: 'command.help',
        });
        expect(getLastReplyContent()).toBe('Unknown help page `moderation`.\nTry `!help general` or `!help settings`.');
    });

    it('blocks help in DEFCON 1 unless the help category is exempt', async () => {
        findGuildSecurityPolicyByGuildIdMock.mockResolvedValueOnce(
            ok({
                guildId: 'guild-1',
                defconLevel: 1,
                createdAt: new Date('2026-06-23T00:00:00.000Z'),
                updatedAt: new Date('2026-06-23T00:00:00.000Z'),
            })
        );

        const blockedResult = await routeBotFeatureEvent(
            createContext(createMultiMode()),
            createMessageEvent({
                content: '!help',
                mentionedUserIds: [],
            })
        );

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
        listGuildDefconExemptionCategoriesMock.mockResolvedValueOnce(ok([DEFCON_FEATURE_CATEGORY.help]));

        const exemptResult = await routeBotFeatureEvent(
            createContext(createMultiMode()),
            createMessageEvent({
                content: '!help',
                mentionedUserIds: [],
            })
        );

        expect(exemptResult.isOk()).toBe(true);
        expect(exemptResult._unsafeUnwrap()).toStrictEqual({
            eventType: 'message.created',
            status: 'handled',
            action: 'command.help',
        });
        expect(sendFluxerChannelMessageMock).toHaveBeenCalledOnce();
    });

    it('uses single-mode guild gating before replying to help', async () => {
        const ignoredResult = await routeBotFeatureEvent(
            createContext(createSingleMode()),
            createMessageEvent({
                content: '!help',
                guildId: 'other',
                mentionedUserIds: [],
            })
        );

        expect(ignoredResult.isOk()).toBe(true);
        expect(ignoredResult._unsafeUnwrap()).toStrictEqual({
            eventType: 'message.created',
            reason: 'guild-not-processable',
            status: 'ignored',
        });
        expect(sendFluxerChannelMessageMock).not.toHaveBeenCalled();
        expect(findGuildCommandSettingsByGuildIdMock).not.toHaveBeenCalled();

        const handledResult = await routeBotFeatureEvent(
            createContext(createSingleMode()),
            createMessageEvent({
                content: '!help',
                guildId: 'target',
                mentionedUserIds: [],
            })
        );

        expect(handledResult.isOk()).toBe(true);
        expect(handledResult._unsafeUnwrap()).toStrictEqual({
            eventType: 'message.created',
            status: 'handled',
            action: 'command.help',
        });
    });

    it('ignores the default prefix when the guild has a stored custom prefix', async () => {
        findGuildCommandSettingsByGuildIdMock.mockResolvedValueOnce(ok(createCommandSettings('guild-1', '?')));

        const result = await routeBotFeatureEvent(
            createContext(createMultiMode()),
            createMessageEvent({
                content: '!ping',
                mentionedUserIds: [],
            })
        );

        expect(result.isOk()).toBe(true);
        expect(result._unsafeUnwrap()).toStrictEqual({
            eventType: 'message.created',
            reason: 'bot-not-mentioned',
            status: 'ignored',
        });
        expect(sendFluxerChannelMessageMock).not.toHaveBeenCalled();
    });

    it('changes the guild prefix when the server owner mentions the bot with prefix command', async () => {
        const result = await routeBotFeatureEvent(
            createContext(createMultiMode()),
            createMessageEvent({
                authorIsServerOwner: true,
                content: '<@bot-user> prefix ?',
                mentionedUserIds: ['bot-user'],
            })
        );

        expect(result.isOk()).toBe(true);
        expect(result._unsafeUnwrap()).toStrictEqual({
            eventType: 'message.created',
            status: 'handled',
            action: 'commands.prefix_change',
        });
        expect(upsertGuildCommandPrefixMock).toHaveBeenCalledWith(testDb, {
            guildId: 'guild-1',
            prefix: '?',
        });
        expect(sendFluxerChannelMessageMock).toHaveBeenCalledWith({
            client: testClient,
            channelId: 'channel-1',
            content: 'Command prefix updated to `?`.',
        });
    });

    it('does not persist when the requested prefix is already the effective default prefix', async () => {
        const result = await routeBotFeatureEvent(
            createContext(createMultiMode()),
            createMessageEvent({
                authorIsServerOwner: true,
                content: '<@bot-user> prefix !',
                mentionedUserIds: ['bot-user'],
            })
        );

        expect(result.isOk()).toBe(true);
        expect(result._unsafeUnwrap()).toStrictEqual({
            eventType: 'message.created',
            status: 'handled',
            action: 'commands.prefix_change',
        });
        expect(upsertGuildCommandPrefixMock).not.toHaveBeenCalled();
        expect(sendFluxerChannelMessageMock).toHaveBeenCalledWith({
            client: testClient,
            channelId: 'channel-1',
            content: 'Command prefix is already `!`.',
        });
    });

    it('does not persist when the requested prefix is already the stored guild prefix', async () => {
        findGuildCommandSettingsByGuildIdMock.mockResolvedValueOnce(ok(createCommandSettings('guild-1', '?')));

        const result = await routeBotFeatureEvent(
            createContext(createMultiMode()),
            createMessageEvent({
                authorIsServerOwner: true,
                content: '<@bot-user> prefix ?',
                mentionedUserIds: ['bot-user'],
            })
        );

        expect(result.isOk()).toBe(true);
        expect(upsertGuildCommandPrefixMock).not.toHaveBeenCalled();
        expect(sendFluxerChannelMessageMock).toHaveBeenCalledWith({
            client: testClient,
            channelId: 'channel-1',
            content: 'Command prefix is already `?`.',
        });
    });

    it('can replace invalid stored prefix config with a valid prefix', async () => {
        findGuildCommandSettingsByGuildIdMock.mockResolvedValueOnce(err('invalid-config'));
        upsertGuildCommandPrefixMock.mockResolvedValueOnce(ok(createCommandSettings('guild-1', '?')));

        const result = await routeBotFeatureEvent(
            createContext(createMultiMode()),
            createMessageEvent({
                authorIsServerOwner: true,
                content: '<@bot-user> prefix ?',
                mentionedUserIds: ['bot-user'],
            })
        );

        expect(result.isOk()).toBe(true);
        expect(upsertGuildCommandPrefixMock).toHaveBeenCalledWith(testDb, {
            guildId: 'guild-1',
            prefix: '?',
        });
    });

    it('changes the guild prefix when an authorized manager mentions the bot with prefix command', async () => {
        const result = await routeBotFeatureEvent(
            createContext(createMultiMode()),
            createMessageEvent({
                authorHasManageServer: true,
                content: '<@bot-user> prefix $',
                mentionedUserIds: ['bot-user'],
            })
        );

        expect(result.isOk()).toBe(true);
        expect(result._unsafeUnwrap()).toMatchObject({
            eventType: 'message.created',
            status: 'handled',
        });
        expect(upsertGuildCommandPrefixMock).toHaveBeenCalledWith(testDb, {
            guildId: 'guild-1',
            prefix: '$',
        });
    });

    it('changes the guild prefix when an allowed role grant authorizes the command', async () => {
        findGuildCommandPermissionRuleMock.mockResolvedValueOnce(
            ok({
                guildId: 'guild-1',
                targetType: 'category',
                targetId: 'settings',
                userIds: [],
                roleIds: ['role-1'],
                createdAt: new Date('2026-06-24T00:00:00.000Z'),
                updatedAt: new Date('2026-06-24T00:00:00.000Z'),
            })
        );

        const result = await routeBotFeatureEvent(
            createContext(createMultiMode()),
            createMessageEvent({
                authorRoleIds: ['role-1'],
                content: '<@bot-user> prefix %',
                mentionedUserIds: ['bot-user'],
            })
        );

        expect(result.isOk()).toBe(true);
        expect(upsertGuildCommandPrefixMock).toHaveBeenCalledWith(testDb, {
            guildId: 'guild-1',
            prefix: '%',
        });
    });

    it('changes the guild prefix when a command category grant authorizes the command', async () => {
        findGuildCommandPermissionRuleMock.mockImplementation((_db, input) => {
            if (input.targetType === 'category' && input.targetId === 'settings') {
                return Promise.resolve(
                    ok({
                        guildId: 'guild-1',
                        targetType: 'category',
                        targetId: 'settings',
                        userIds: [],
                        roleIds: ['role-1'],
                        createdAt: new Date('2026-06-24T00:00:00.000Z'),
                        updatedAt: new Date('2026-06-24T00:00:00.000Z'),
                    })
                );
            }

            return Promise.resolve(err('not-found'));
        });

        const result = await routeBotFeatureEvent(
            createContext(createMultiMode()),
            createMessageEvent({
                authorRoleIds: ['role-1'],
                content: '<@bot-user> prefix %',
                mentionedUserIds: ['bot-user'],
            })
        );

        expect(result.isOk()).toBe(true);
        expect(upsertGuildCommandPrefixMock).toHaveBeenCalledWith(testDb, {
            guildId: 'guild-1',
            prefix: '%',
        });
    });

    it('keeps legacy prefix category grants working after target-based command grants', async () => {
        findGuildCommandPermissionRuleMock.mockImplementation((_db, input) => {
            if (input.targetType === 'category' && input.targetId === DEFCON_FEATURE_CATEGORY.prefix) {
                return Promise.resolve(
                    ok({
                        guildId: 'guild-1',
                        targetType: 'category',
                        targetId: DEFCON_FEATURE_CATEGORY.prefix,
                        userIds: ['author-1'],
                        roleIds: [],
                        createdAt: new Date('2026-06-24T00:00:00.000Z'),
                        updatedAt: new Date('2026-06-24T00:00:00.000Z'),
                    })
                );
            }

            return Promise.resolve(err('not-found'));
        });

        const result = await routeBotFeatureEvent(
            createContext(createMultiMode()),
            createMessageEvent({
                content: '<@bot-user> prefix %',
                mentionedUserIds: ['bot-user'],
            })
        );

        expect(result.isOk()).toBe(true);
        expect(findGuildCommandPermissionRuleMock).toHaveBeenCalledWith(testDb, {
            guildId: 'guild-1',
            targetType: 'command',
            targetId: 'settings.prefix',
        });
        expect(findGuildCommandPermissionRuleMock).toHaveBeenCalledWith(testDb, {
            guildId: 'guild-1',
            targetType: 'category',
            targetId: 'settings',
        });
        expect(findGuildCommandPermissionRuleMock).toHaveBeenCalledWith(testDb, {
            guildId: 'guild-1',
            targetType: 'category',
            targetId: DEFCON_FEATURE_CATEGORY.prefix,
        });
        expect(upsertGuildCommandPrefixMock).toHaveBeenCalledWith(testDb, {
            guildId: 'guild-1',
            prefix: '%',
        });
    });

    it('changes the guild prefix when the prefix mixes symbols and numbers after the first character', async () => {
        upsertGuildCommandPrefixMock.mockResolvedValueOnce(ok(createCommandSettings('guild-1', '?1')));

        const result = await routeBotFeatureEvent(
            createContext(createMultiMode()),
            createMessageEvent({
                authorIsServerOwner: true,
                content: '<@bot-user> prefix ?1',
                mentionedUserIds: ['bot-user'],
            })
        );

        expect(result.isOk()).toBe(true);
        expect(upsertGuildCommandPrefixMock).toHaveBeenCalledWith(testDb, {
            guildId: 'guild-1',
            prefix: '?1',
        });
        expect(sendFluxerChannelMessageMock).toHaveBeenCalledWith({
            client: testClient,
            channelId: 'channel-1',
            content: 'Command prefix updated to `?1`.',
        });
    });

    it('uses stored guild prefix with letters or numbers after the first symbol for ping commands', async () => {
        findGuildCommandSettingsByGuildIdMock.mockResolvedValueOnce(ok(createCommandSettings('guild-1', '?1')));

        const result = await routeBotFeatureEvent(
            createContext(createMultiMode()),
            createMessageEvent({
                content: '?1ping',
                mentionedUserIds: [],
            })
        );

        expect(result.isOk()).toBe(true);
        expect(result._unsafeUnwrap()).toStrictEqual({
            eventType: 'message.created',
            status: 'handled',
            action: 'command.ping',
        });
        expect(sendFluxerChannelMessageMock).toHaveBeenCalledWith({
            client: testClient,
            channelId: 'channel-1',
            content: "Yes, I'm here, and no, I don't pong",
        });
    });

    it.each(['a', '1', '....', '\u200b', '/', '@', '#', '<', '>', ':'])(
        'replies clearly for invalid prefix %j',
        async (prefix) => {
            upsertGuildCommandPrefixMock.mockResolvedValueOnce(err('invalid-prefix'));

            const result = await routeBotFeatureEvent(
                createContext(createMultiMode()),
                createMessageEvent({
                    authorIsServerOwner: true,
                    content: `<@bot-user> prefix ${prefix}`,
                    mentionedUserIds: ['bot-user'],
                })
            );

            expect(result.isOk()).toBe(true);
            expect(result._unsafeUnwrap()).toStrictEqual({
                eventType: 'message.created',
                status: 'handled',
                action: 'commands.prefix_change',
            });
            expect(sendFluxerChannelMessageMock).toHaveBeenCalledWith({
                client: testClient,
                channelId: 'channel-1',
                content: COMMAND_PREFIX_INVALID_MESSAGE,
            });
            expect(upsertGuildCommandPrefixMock).not.toHaveBeenCalled();
        }
    );

    it('replies with usage when the prefix command omits a new prefix', async () => {
        const result = await routeBotFeatureEvent(
            createContext(createMultiMode()),
            createMessageEvent({
                authorIsServerOwner: true,
                content: '<@bot-user> prefix',
                mentionedUserIds: ['bot-user'],
            })
        );

        expect(result.isOk()).toBe(true);
        expect(sendFluxerChannelMessageMock).toHaveBeenCalledWith({
            client: testClient,
            channelId: 'channel-1',
            content: `Use: mention me with \`prefix ?\`. ${COMMAND_PREFIX_INVALID_MESSAGE}`,
        });
        expect(upsertGuildCommandPrefixMock).not.toHaveBeenCalled();
    });

    it('rejects prefix changes outside guilds with a clear reply', async () => {
        const result = await routeBotFeatureEvent(
            createContext(createMultiMode()),
            createMessageEvent({
                guildId: null,
                authorIsServerOwner: true,
                content: '<@bot-user> prefix ?',
                mentionedUserIds: ['bot-user'],
            })
        );

        expect(result.isOk()).toBe(true);
        expect(result._unsafeUnwrap()).toStrictEqual({
            eventType: 'message.created',
            status: 'handled',
            action: 'commands.prefix_change',
        });
        expect(sendFluxerChannelMessageMock).toHaveBeenCalledWith({
            client: testClient,
            channelId: 'channel-1',
            content: 'I can only change the prefix inside a community.',
        });
        expect(upsertGuildCommandPrefixMock).not.toHaveBeenCalled();
    });

    it('denies prefix changes for unauthorized users', async () => {
        const result = await routeBotFeatureEvent(
            createContext(createMultiMode()),
            createMessageEvent({
                content: '<@bot-user> prefix ?',
                mentionedUserIds: ['bot-user'],
            })
        );

        expect(result.isOk()).toBe(true);
        expect(result._unsafeUnwrap()).toStrictEqual({
            eventType: 'message.created',
            status: 'handled',
            action: 'commands.prefix_change',
        });
        expect(sendFluxerChannelMessageMock).toHaveBeenCalledWith({
            client: testClient,
            channelId: 'channel-1',
            content:
                'You cannot change the prefix here. In lockdown, only the server owner can change guarded settings. Otherwise, this command requires Manage Server or an allowed role/user rule.',
        });
        expect(upsertGuildCommandPrefixMock).not.toHaveBeenCalled();
    });

    it.each([1, 2] as const)('allows only the server owner to change prefix in DEFCON %s', async (defconLevel) => {
        findGuildSecurityPolicyByGuildIdMock.mockResolvedValue(
            ok({
                guildId: 'guild-1',
                defconLevel,
                createdAt: new Date('2026-06-23T00:00:00.000Z'),
                updatedAt: new Date('2026-06-23T00:00:00.000Z'),
            })
        );

        const managerResult = await routeBotFeatureEvent(
            createContext(createMultiMode()),
            createMessageEvent({
                authorHasManageServer: true,
                content: '<@bot-user> prefix ?',
                mentionedUserIds: ['bot-user'],
            })
        );

        expect(managerResult.isOk()).toBe(true);
        expect(upsertGuildCommandPrefixMock).not.toHaveBeenCalled();

        const ownerResult = await routeBotFeatureEvent(
            createContext(createMultiMode()),
            createMessageEvent({
                authorId: 'owner-1',
                authorIsServerOwner: true,
                content: '<@bot-user> prefix ?',
                mentionedUserIds: ['bot-user'],
            })
        );

        expect(ownerResult.isOk()).toBe(true);
        expect(upsertGuildCommandPrefixMock).toHaveBeenCalledWith(testDb, {
            guildId: 'guild-1',
            prefix: '?',
        });
    });

    it('returns database-error when stored prefix lookup fails', async () => {
        findGuildCommandSettingsByGuildIdMock.mockResolvedValueOnce(err('database-error'));

        const result = await routeBotFeatureEvent(
            createContext(createMultiMode()),
            createMessageEvent({
                content: '!ping',
                mentionedUserIds: [],
            })
        );

        expect(result.isErr()).toBe(true);
        expect(result._unsafeUnwrapErr()).toBe('database-error');
    });

    it('returns database-error when help prefix lookup fails', async () => {
        findGuildCommandSettingsByGuildIdMock.mockResolvedValueOnce(err('database-error'));

        const result = await routeBotFeatureEvent(
            createContext(createMultiMode()),
            createMessageEvent({
                content: '!help',
                mentionedUserIds: [],
            })
        );

        expect(result.isErr()).toBe(true);
        expect(result._unsafeUnwrapErr()).toBe('database-error');
        expect(sendFluxerChannelMessageMock).not.toHaveBeenCalled();
    });

    it('returns database-error when prefix persistence fails', async () => {
        upsertGuildCommandPrefixMock.mockResolvedValueOnce(err('database-error'));

        const result = await routeBotFeatureEvent(
            createContext(createMultiMode()),
            createMessageEvent({
                authorIsServerOwner: true,
                content: '<@bot-user> prefix $',
                mentionedUserIds: ['bot-user'],
            })
        );

        expect(result.isErr()).toBe(true);
        expect(result._unsafeUnwrapErr()).toBe('database-error');
    });

    it('escalates contextless bot mention replies before cooldown', async () => {
        const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(new Date('2026-06-23T20:00:00.000Z').getTime());
        const context = createContext(createMultiMode());
        const authorId = 'contextless-author-1';

        for (const content of [
            "I predominantly dislike it when people think that saying someone's name just to see if they're there is proper communication. Just say what's on your mind please",
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
                action: 'bot_mention.contextless_reply',
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
            action: 'bot_mention.contextless_reply',
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
            action: 'command.ping',
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
            action: 'bot_mention.contextless_reply',
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
        listGuildDefconExemptionCategoriesMock.mockResolvedValueOnce(ok([DEFCON_FEATURE_CATEGORY.botMention]));

        const exemptResult = await routeBotFeatureEvent(createContext(createMultiMode()), createMessageEvent());

        expect(exemptResult.isOk()).toBe(true);
        expect(exemptResult._unsafeUnwrap()).toStrictEqual({
            eventType: 'message.created',
            status: 'handled',
            action: 'bot_mention.contextless_reply',
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

    it('returns message-send-error when the help reply cannot be sent', async () => {
        sendFluxerChannelMessageMock.mockResolvedValueOnce(err({ type: 'send-failed', error: new Error('no access') }));

        const result = await routeBotFeatureEvent(
            createContext(createMultiMode()),
            createMessageEvent({
                content: '!help',
                mentionedUserIds: [],
            })
        );

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

function createCommandSettings(guildId: string, prefix: string): GuildCommandSettingsRecord {
    const timestamp = new Date('2026-06-24T00:00:00.000Z');

    return {
        guildId,
        prefix,
        createdAt: timestamp,
        updatedAt: timestamp,
    };
}

function createMemberFlowRecord() {
    return {
        id: 'flow-1',
        guildId: 'guild-1',
        userId: 'user-1',
        eventType: 'join',
        inviteCode: null,
        inviterUserId: null,
        attributionStatus: 'unavailable',
        occurredAt: new Date('2026-06-26T00:00:00.000Z'),
    };
}

function createMessageActivityRecord() {
    return {
        id: 'activity-1',
        guildId: 'guild-1',
        channelId: 'channel-1',
        activityDate: '2026-06-26',
        messageCount: 1,
        updatedAt: new Date('2026-06-26T00:00:00.000Z'),
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
        authorRoleIds: [],
        authorIsServerOwner: false,
        authorHasManageServer: false,
        content: '<@bot-user>',
        mentionedUserIds: ['bot-user'],
        ...overrides,
    };
}

function getLastReplyContent(): string {
    const content = sendFluxerChannelMessageMock.mock.calls.at(-1)?.[0].content;

    if (!content) {
        throw new Error('Expected a reply message.');
    }

    return content;
}

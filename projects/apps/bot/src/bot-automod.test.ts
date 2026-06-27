import {
    createModerationCase,
    listEnabledAutomodRulesByGuildId,
    recordAutomodEvent,
    updateAutomodEventStatus,
    type AutomodEventRecord,
    type AutomodRuleRecord,
} from '@neonflux/db';
import type * as NeonFluxDb from '@neonflux/db';
import { createFluxerPlatform } from '@neonflux/fluxer';
import type * as Fluxer from '@neonflux/fluxer';
import { ok } from 'neverthrow';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { routeAutomodMessageEvent } from './bot-automod.js';
import type { BotFeatureHandlerContext, BotMessageCreatedEvent } from './bot-feature-types.js';

vi.mock('@neonflux/db', async (importActual) => {
    const actual = await importActual<typeof NeonFluxDb>();

    return {
        ...actual,
        createModerationCase: vi.fn(),
        listEnabledAutomodRulesByGuildId: vi.fn(),
        recordAutomodEvent: vi.fn(),
        updateAutomodEventStatus: vi.fn(),
    };
});

vi.mock('@neonflux/fluxer', async (importActual) => {
    const actual = await importActual<typeof Fluxer>();

    return {
        ...actual,
        createFluxerPlatform: vi.fn(),
    };
});

describe('bot automod', () => {
    beforeEach(() => {
        vi.mocked(listEnabledAutomodRulesByGuildId).mockResolvedValue(
            ok([
                createRule({
                    id: 'rule-terms',
                    name: 'Blocked terms',
                    triggerType: 'blocked_terms',
                    config: { terms: ['spam'] },
                }),
                createRule({
                    id: 'rule-invites',
                    name: 'Invite links',
                    triggerType: 'invite_links',
                    config: {},
                }),
            ])
        );
        vi.mocked(recordAutomodEvent).mockResolvedValue(ok(createAutomodEventRecord()));
        vi.mocked(updateAutomodEventStatus).mockResolvedValue(ok(createAutomodEventRecord({ status: 'enforced' })));
        vi.mocked(createModerationCase).mockResolvedValue(ok(createModerationCaseRecord()));
        vi.mocked(createFluxerPlatform).mockReturnValue(createPlatform());
    });

    afterEach(() => {
        vi.clearAllMocks();
    });

    it('records matching blocked-term rules without storing raw content', async () => {
        const result = await routeAutomodMessageEvent(createContext(), createMessageEvent({ content: 'buy spam now' }));

        expect(result._unsafeUnwrap()).toStrictEqual({
            status: 'recorded',
            action: 'event.automod.recorded',
            matchCount: 1,
            enforcedCount: 0,
            failedCount: 0,
        });
        expect(recordAutomodEvent).toHaveBeenCalledWith(
            {},
            expect.objectContaining({
                guildId: 'guild-1',
                ruleId: 'rule-terms',
                messageId: 'message-1',
                triggerType: 'blocked_terms',
                details: {
                    contentLength: 12,
                    matchedTermCount: 1,
                    matchedTerms: ['spam'],
                },
            })
        );
    });

    it('records invite-link rules without storing invite URLs', async () => {
        await routeAutomodMessageEvent(createContext(), createMessageEvent({ content: 'join discord.gg/example' }));

        expect(recordAutomodEvent).toHaveBeenCalledWith(
            {},
            expect.objectContaining({
                ruleId: 'rule-invites',
                triggerType: 'invite_links',
                details: {
                    contentLength: 23,
                    inviteLinkCount: 1,
                },
            })
        );
    });

    it('deletes messages for delete-message rules and records enforcement status', async () => {
        const platform = createPlatform();
        vi.mocked(createFluxerPlatform).mockReturnValue(platform);
        vi.mocked(listEnabledAutomodRulesByGuildId).mockResolvedValue(
            ok([
                createRule({
                    id: 'rule-delete',
                    name: 'Delete invites',
                    triggerType: 'invite_links',
                    actionType: 'delete_message',
                    config: {},
                }),
            ])
        );

        const result = await routeAutomodMessageEvent(
            createContext(),
            createMessageEvent({ content: 'join discord.gg/example' })
        );

        expect(result._unsafeUnwrap()).toStrictEqual({
            status: 'enforced',
            action: 'event.automod.enforced',
            matchCount: 1,
            enforcedCount: 1,
            failedCount: 0,
        });
        expect(platform.messages.delete).toHaveBeenCalledWith({
            channelId: 'channel-1',
            messageId: 'message-1',
        });
        expect(updateAutomodEventStatus).toHaveBeenCalledWith(
            {},
            expect.objectContaining({
                eventId: 'event-1',
                status: 'enforced',
            })
        );
        expect(readLastAutomodStatusUpdateDetails()).toMatchObject({
            enforcementAction: 'delete_message',
        });
    });

    it('skips mutating enforcement for privileged authors', async () => {
        const platform = createPlatform();
        vi.mocked(createFluxerPlatform).mockReturnValue(platform);
        vi.mocked(listEnabledAutomodRulesByGuildId).mockResolvedValue(
            ok([
                createRule({
                    id: 'rule-timeout',
                    name: 'Timeout invites',
                    triggerType: 'invite_links',
                    actionType: 'timeout',
                    config: { timeoutDurationSeconds: 600 },
                }),
            ])
        );

        await routeAutomodMessageEvent(
            createContext(),
            createMessageEvent({
                content: 'join discord.gg/example',
                authorHasManageServer: true,
            })
        );

        expect(platform.moderation.timeout).not.toHaveBeenCalled();
        expect(updateAutomodEventStatus).toHaveBeenCalledWith(
            {},
            expect.objectContaining({
                status: 'skipped',
            })
        );
        expect(readLastAutomodStatusUpdateDetails()).toMatchObject({
            enforcementAction: 'timeout',
            skipReason: 'privileged-author',
        });
    });

    it('skips warn enforcement for privileged authors before creating cases', async () => {
        vi.mocked(listEnabledAutomodRulesByGuildId).mockResolvedValue(
            ok([
                createRule({
                    id: 'rule-warn',
                    name: 'Warn terms',
                    triggerType: 'blocked_terms',
                    actionType: 'warn',
                    config: { terms: ['spam'] },
                }),
            ])
        );

        const result = await routeAutomodMessageEvent(
            createContext(),
            createMessageEvent({
                content: 'spam here',
                authorHasManageServer: true,
            })
        );

        expect(result._unsafeUnwrap()).toMatchObject({
            status: 'recorded',
            action: 'event.automod.recorded',
        });
        expect(createModerationCase).not.toHaveBeenCalled();
        expect(readLastAutomodStatusUpdateDetails()).toMatchObject({
            enforcementAction: 'warn',
            skipReason: 'privileged-author',
        });
    });

    it('creates warning cases for warn rules', async () => {
        vi.mocked(listEnabledAutomodRulesByGuildId).mockResolvedValue(
            ok([
                createRule({
                    id: 'rule-warn',
                    name: 'Warn terms',
                    triggerType: 'blocked_terms',
                    actionType: 'warn',
                    config: { terms: ['spam'] },
                }),
            ])
        );

        const result = await routeAutomodMessageEvent(createContext(), createMessageEvent({ content: 'spam here' }));

        expect(result._unsafeUnwrap()).toMatchObject({
            status: 'enforced',
            action: 'event.automod.enforced',
        });
        expect(createModerationCase).toHaveBeenCalledWith(
            {},
            {
                guildId: 'guild-1',
                action: 'warn',
                targetUserId: 'user-1',
                actorUserId: 'bot-1',
                reason: 'Automod rule: Warn terms',
            }
        );
        expect(readLastAutomodStatusUpdateDetails()).toMatchObject({
            enforcementAction: 'warn',
            moderationCaseId: 'case-1',
            moderationCaseNumber: 7,
        });
    });

    it('ignores rules for configured channels, roles, or users', async () => {
        vi.mocked(listEnabledAutomodRulesByGuildId).mockResolvedValue(
            ok([
                createRule({
                    id: 'rule-ignored',
                    name: 'Ignored terms',
                    triggerType: 'blocked_terms',
                    actionType: 'warn',
                    config: {
                        terms: ['spam'],
                        ignoredChannelIds: ['channel-1'],
                        ignoredRoleIds: ['role-1'],
                        ignoredUserIds: ['user-2'],
                    },
                }),
            ])
        );

        const result = await routeAutomodMessageEvent(
            createContext(),
            createMessageEvent({ content: 'spam here', authorRoleIds: ['role-1'] })
        );

        expect(result._unsafeUnwrap()).toStrictEqual({
            status: 'ignored',
            reason: 'no-feature-handler',
        });
        expect(recordAutomodEvent).not.toHaveBeenCalled();
        expect(createModerationCase).not.toHaveBeenCalled();
    });

    it('ignores messages when enabled rules do not match', async () => {
        const result = await routeAutomodMessageEvent(createContext(), createMessageEvent({ content: 'hello world' }));

        expect(result._unsafeUnwrap()).toStrictEqual({
            status: 'ignored',
            reason: 'no-feature-handler',
        });
        expect(recordAutomodEvent).not.toHaveBeenCalled();
    });
});

function createContext(): BotFeatureHandlerContext {
    return {
        db: {},
        mode: { kind: 'multi' },
        appEnv: 'development',
        guildDefconOverride: {},
        client: {},
        botUserId: 'bot-1',
    } as unknown as BotFeatureHandlerContext;
}

function createMessageEvent(overrides: Partial<BotMessageCreatedEvent> = {}): BotMessageCreatedEvent {
    return {
        type: 'message.created',
        messageId: 'message-1',
        channelId: 'channel-1',
        guildId: 'guild-1',
        authorId: 'user-1',
        authorIsBot: false,
        authorRoleIds: [],
        authorIsServerOwner: false,
        authorHasManageServer: false,
        content: 'hello',
        mentionedUserIds: [],
        ...overrides,
    };
}

function createRule(overrides: Partial<AutomodRuleRecord>): AutomodRuleRecord {
    return {
        id: 'rule-1',
        guildId: 'guild-1',
        name: 'Rule',
        triggerType: 'blocked_terms',
        actionType: 'record',
        enabled: true,
        config: { terms: ['spam'] },
        createdAt: new Date('2026-06-28T00:00:00.000Z'),
        updatedAt: new Date('2026-06-28T00:00:00.000Z'),
        ...overrides,
    };
}

function createAutomodEventRecord(overrides: Partial<AutomodEventRecord> = {}): AutomodEventRecord {
    return {
        id: 'event-1',
        guildId: 'guild-1',
        ruleId: 'rule-1',
        messageId: 'message-1',
        channelId: 'channel-1',
        authorUserId: 'user-1',
        triggerType: 'blocked_terms',
        actionType: 'record',
        status: 'recorded',
        details: {},
        createdAt: new Date('2026-06-28T00:00:00.000Z'),
        ...overrides,
    };
}

function createModerationCaseRecord() {
    return {
        id: 'case-1',
        guildId: 'guild-1',
        caseNumber: 7,
        action: 'warn',
        targetType: 'user',
        targetUserId: 'user-1',
        targetChannelId: null,
        actorUserId: 'bot-1',
        reason: 'Automod rule: Warn terms',
        status: 'open',
        createdAt: new Date('2026-06-28T00:00:00.000Z'),
        updatedAt: new Date('2026-06-28T00:00:00.000Z'),
    };
}

function createPlatform() {
    return {
        messages: {
            delete: vi.fn(() => Promise.resolve(ok(undefined))),
        },
        moderation: {
            timeout: vi.fn(() => Promise.resolve(ok(undefined))),
        },
    } as unknown as ReturnType<typeof createFluxerPlatform>;
}

function readLastAutomodStatusUpdateDetails(): Record<string, unknown> | undefined {
    const call = vi.mocked(updateAutomodEventStatus).mock.calls.at(-1);

    return call?.[1].details;
}

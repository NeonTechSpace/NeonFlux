import { requestReactionRoleExternalMessageDeleted, requestReactionRoleMemberTransition } from '@neonflux/db';
import type * as NeonFluxDb from '@neonflux/db';
import { ok } from 'neverthrow';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { runNextReactionRoleMemberReconciliation } from './bot-reaction-role-member-reconciler.js';
import { routeReactionRoleEvent, routeReactionRoleMessageDeleted } from './bot-reaction-roles.js';
import type { BotFeatureHandlerContext } from './bot-feature-types.js';

vi.mock('@neonflux/db', async (importActual) => ({
    ...(await importActual<typeof NeonFluxDb>()),
    requestReactionRoleMemberTransition: vi.fn(),
    requestReactionRoleExternalMessageDeleted: vi.fn(),
}));

vi.mock('./bot-reaction-role-member-reconciler.js', () => ({
    runNextReactionRoleMemberReconciliation: vi.fn(),
}));

describe('reaction-role event intake', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(requestReactionRoleMemberTransition).mockResolvedValue(
            ok({ type: 'queued', state: createMemberState() })
        );
        vi.mocked(runNextReactionRoleMemberReconciliation).mockResolvedValue({
            status: 'synced',
            stateId: 'state-1',
        });
        vi.mocked(requestReactionRoleExternalMessageDeleted).mockResolvedValue(ok(true));
    });

    it('persists desired state before triggering reconciliation', async () => {
        const result = await routeReactionRoleEvent(createContext(), {
            channelId: 'channel-1',
            emojiKey: '✅',
            guildId: 'guild-1',
            messageId: 'message-1',
            type: 'reaction.added',
            userId: 'user-1',
        });

        expect(result._unsafeUnwrap()).toStrictEqual({
            action: 'event.reaction_roles.transition_queued',
            status: 'applied',
        });
        expect(requestReactionRoleMemberTransition).toHaveBeenCalledWith(
            {},
            {
                emojiKey: '✅',
                eventType: 'added',
                guildId: 'guild-1',
                messageId: 'message-1',
                userId: 'user-1',
            }
        );
        expect(vi.mocked(requestReactionRoleMemberTransition).mock.invocationCallOrder[0]).toBeLessThan(
            vi.mocked(runNextReactionRoleMemberReconciliation).mock.invocationCallOrder[0] ?? 0
        );
    });

    it('ignores bot users without writing desired state', async () => {
        const result = await routeReactionRoleEvent(createContext(), {
            channelId: 'channel-1',
            emojiKey: '✅',
            guildId: 'guild-1',
            messageId: 'message-1',
            type: 'reaction.removed',
            userId: 'bot-1',
            userIsBot: true,
        });

        expect(result._unsafeUnwrap()).toStrictEqual({ reason: 'no-feature-handler', status: 'ignored' });
        expect(requestReactionRoleMemberTransition).not.toHaveBeenCalled();
    });

    it('persists transitions for the same menu user in gateway order', async () => {
        let releaseFirst!: (value: Awaited<ReturnType<typeof requestReactionRoleMemberTransition>>) => void;
        vi.mocked(requestReactionRoleMemberTransition)
            .mockImplementationOnce(
                () =>
                    new Promise<Awaited<ReturnType<typeof requestReactionRoleMemberTransition>>>(
                        (resolve) => (releaseFirst = resolve)
                    )
            )
            .mockResolvedValueOnce(ok({ type: 'queued', state: createMemberState() }));
        const base = {
            channelId: 'channel-1',
            emojiKey: '✅',
            guildId: 'guild-1',
            messageId: 'message-1',
            userId: 'user-1',
        } as const;

        const added = routeReactionRoleEvent(createContext(), { ...base, type: 'reaction.added' });
        await Promise.resolve();
        const removed = routeReactionRoleEvent(createContext(), { ...base, type: 'reaction.removed' });
        await Promise.resolve();
        expect(requestReactionRoleMemberTransition).toHaveBeenCalledTimes(1);

        releaseFirst(ok({ type: 'queued', state: createMemberState() }));
        await Promise.all([added, removed]);
        expect(
            vi.mocked(requestReactionRoleMemberTransition).mock.calls.map((call) => call[1].eventType)
        ).toStrictEqual(['added', 'removed']);
    });

    it('queues durable cleanup when a managed message is deleted externally', async () => {
        const result = await routeReactionRoleMessageDeleted(createContext(), {
            guildId: 'guild-1',
            messageId: 'message-1',
        });

        expect(result._unsafeUnwrap()).toStrictEqual({
            status: 'applied',
            action: 'event.reaction_roles.external_delete_cleanup_queued',
        });
        expect(requestReactionRoleExternalMessageDeleted).toHaveBeenCalledWith(
            {},
            { guildId: 'guild-1', messageId: 'message-1' }
        );
    });
});

function createContext(): BotFeatureHandlerContext {
    return {
        appEnv: 'production',
        client: {} as BotFeatureHandlerContext['client'],
        db: {} as BotFeatureHandlerContext['db'],
        guildDefconOverride: 'auto',
        logger: { warn: vi.fn() },
        mode: { instanceMode: 'multi' },
    };
}

function createMemberState(): NeonFluxDb.ReactionRoleMemberStateRecord {
    const now = new Date('2026-07-10T08:00:00.000Z');
    return {
        configRevision: 1,
        createdAt: now,
        desiredEmojiKeys: ['✅'],
        errorCode: null,
        guildId: 'guild-1',
        id: 'state-1',
        leaseExpiresAt: null,
        leaseId: null,
        leaseOwner: null,
        messageId: 'message-1',
        nextAttemptAt: null,
        reactionRoleMessageId: 'menu-1',
        revision: 1,
        status: 'pending',
        updatedAt: now,
        userId: 'user-1',
    };
}

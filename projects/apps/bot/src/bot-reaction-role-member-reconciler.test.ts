import {
    acquireReactionRoleUserLease,
    blockReactionRoleMemberState,
    claimNextReactionRoleMemberState,
    completeReactionRoleMemberState,
    deferReactionRoleMemberState,
    hasOtherActiveReactionRoleAssignment,
    isReactionRoleGuildRunnable,
    loadReactionRoleMemberReconciliation,
    releaseReactionRoleUserLease,
    renewReactionRoleUserLease,
    type ReactionRoleAssignmentRecord,
    type ReactionRoleMemberStateRecord,
    type ReactionRoleMessageRecord,
    type ReactionRoleOptionRecord,
} from '@neonflux/db';
import type * as NeonFluxDb from '@neonflux/db';
import { createFluxerPlatform } from '@neonflux/fluxer';
import type * as Fluxer from '@neonflux/fluxer';
import { ok } from 'neverthrow';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { runNextReactionRoleMemberReconciliation } from './bot-reaction-role-member-reconciler.js';
import type { BotFeatureHandlerContext } from './bot-feature-types.js';
import { filterBotManageableRoleIds } from './bot-role-safety.js';

const readMember = vi.fn();
const removeRole = vi.fn();
const addRole = vi.fn();
const removeReaction = vi.fn();

vi.mock('@neonflux/db', async (importActual) => ({
    ...(await importActual<typeof NeonFluxDb>()),
    acquireReactionRoleUserLease: vi.fn(),
    blockReactionRoleMemberState: vi.fn(),
    claimNextReactionRoleMemberState: vi.fn(),
    completeReactionRoleMemberState: vi.fn(),
    deferReactionRoleMemberState: vi.fn(),
    hasOtherActiveReactionRoleAssignment: vi.fn(),
    isReactionRoleGuildRunnable: vi.fn(),
    loadReactionRoleMemberReconciliation: vi.fn(),
    releaseReactionRoleUserLease: vi.fn(),
    renewReactionRoleUserLease: vi.fn(),
}));

vi.mock('@neonflux/fluxer', async (importActual) => ({
    ...(await importActual<typeof Fluxer>()),
    createFluxerPlatform: vi.fn(),
}));

vi.mock('./bot-role-safety.js', () => ({ filterBotManageableRoleIds: vi.fn() }));

describe('reaction-role member reconciler', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(createFluxerPlatform).mockReturnValue({
            members: { read: readMember, removeRole, addRole },
            messages: { removeReaction },
        } as unknown as ReturnType<typeof createFluxerPlatform>);
        readMember.mockResolvedValue(ok({ guildId: 'guild-1', userId: 'user-1', roleIds: ['role-old'] }));
        removeRole.mockResolvedValue(ok(undefined));
        addRole.mockResolvedValue(ok(undefined));
        removeReaction.mockResolvedValue(ok(undefined));
        vi.mocked(acquireReactionRoleUserLease).mockResolvedValue(ok(true));
        vi.mocked(blockReactionRoleMemberState).mockResolvedValue(ok(true));
        vi.mocked(isReactionRoleGuildRunnable).mockResolvedValue(ok(true));
        vi.mocked(renewReactionRoleUserLease).mockResolvedValue(ok(true));
        vi.mocked(releaseReactionRoleUserLease).mockResolvedValue(ok(true));
        vi.mocked(hasOtherActiveReactionRoleAssignment).mockResolvedValue(ok(false));
        vi.mocked(deferReactionRoleMemberState).mockResolvedValue(ok(true));
        vi.mocked(filterBotManageableRoleIds).mockResolvedValue(ok(['role-old', 'role-new']));
        vi.mocked(completeReactionRoleMemberState).mockResolvedValue(ok(true));
    });

    it('removes undesired exclusive roles before adding the latest desired role', async () => {
        const state = createState();
        vi.mocked(claimNextReactionRoleMemberState).mockResolvedValue(ok(state));
        vi.mocked(loadReactionRoleMemberReconciliation).mockResolvedValue(
            ok({
                assignments: [
                    createAssignment({ emojiKey: '❌', roleId: 'role-old', desiredState: 'absent' }),
                    createAssignment({ emojiKey: '✅', roleId: 'role-new', desiredState: 'present' }),
                ],
                message: createMessage(),
                options: [createOption()],
                state,
            })
        );

        const result = await runNextReactionRoleMemberReconciliation(createContext(), {
            leaseOwner: 'worker-1',
            now: new Date('2026-07-10T08:00:00.000Z'),
        });

        expect(result).toStrictEqual({ status: 'synced', stateId: 'state-1' });
        expect(removeRole).toHaveBeenCalledWith({ guildId: 'guild-1', roleId: 'role-old', userId: 'user-1' });
        expect(addRole).toHaveBeenCalledWith({ guildId: 'guild-1', roleId: 'role-new', userId: 'user-1' });
        expect(removeRole.mock.invocationCallOrder[0]).toBeLessThan(addRole.mock.invocationCallOrder[0] ?? 0);
        expect(completeReactionRoleMemberState).toHaveBeenCalledWith(
            {},
            expect.objectContaining({ appliedEmojiKeys: ['✅'], revision: 2, stateId: 'state-1' })
        );
    });

    it('preserves a shared role until the final menu ownership is removed', async () => {
        const state = createState({ desiredEmojiKeys: [] });
        vi.mocked(claimNextReactionRoleMemberState).mockResolvedValue(ok(state));
        vi.mocked(hasOtherActiveReactionRoleAssignment).mockResolvedValue(ok(true));
        vi.mocked(filterBotManageableRoleIds).mockResolvedValue(ok([]));
        vi.mocked(loadReactionRoleMemberReconciliation).mockResolvedValue(
            ok({
                assignments: [createAssignment({ emojiKey: '❌', roleId: 'role-old', desiredState: 'absent' })],
                message: createMessage(),
                options: [createOption()],
                state,
            })
        );

        const result = await runNextReactionRoleMemberReconciliation(createContext(), { leaseOwner: 'worker-1' });

        expect(result).toStrictEqual({ status: 'synced', stateId: 'state-1' });
        expect(removeRole).not.toHaveBeenCalled();
        expect(removeReaction).toHaveBeenCalled();
        expect(completeReactionRoleMemberState).toHaveBeenCalledWith(
            {},
            expect.objectContaining({ appliedEmojiKeys: [] })
        );
    });

    it('cleans an old remapped grant without auto-granting the replacement role', async () => {
        const state = createState();
        vi.mocked(claimNextReactionRoleMemberState).mockResolvedValue(ok(state));
        vi.mocked(filterBotManageableRoleIds).mockResolvedValue(ok(['role-old']));
        vi.mocked(loadReactionRoleMemberReconciliation).mockResolvedValue(
            ok({
                assignments: [createAssignment({ emojiKey: '✅', roleId: 'role-old', desiredState: 'present' })],
                message: createMessage(),
                options: [createOption()],
                state,
            })
        );

        await runNextReactionRoleMemberReconciliation(createContext(), { leaseOwner: 'worker-1' });

        expect(removeRole).toHaveBeenCalledWith({ guildId: 'guild-1', roleId: 'role-old', userId: 'user-1' });
        expect(addRole).not.toHaveBeenCalled();
        expect(completeReactionRoleMemberState).toHaveBeenCalledWith(
            {},
            expect.objectContaining({ appliedEmojiKeys: [] })
        );
    });

    it('performs no external mutation after losing the guild-user fence', async () => {
        const state = createState();
        vi.mocked(claimNextReactionRoleMemberState).mockResolvedValue(ok(state));
        vi.mocked(renewReactionRoleUserLease).mockResolvedValue(ok(false));

        const result = await runNextReactionRoleMemberReconciliation(createContext(), { leaseOwner: 'worker-1' });

        expect(result).toMatchObject({ status: 'deferred', errorCode: 'user_lease_lost' });
        expect(readMember).not.toHaveBeenCalled();
        expect(removeRole).not.toHaveBeenCalled();
        expect(addRole).not.toHaveBeenCalled();
    });

    it('blocks permanent hierarchy failures until an administrator retries', async () => {
        const state = createState();
        vi.mocked(claimNextReactionRoleMemberState).mockResolvedValue(ok(state));
        vi.mocked(loadReactionRoleMemberReconciliation).mockResolvedValue(
            ok({
                assignments: [createAssignment({ emojiKey: '✅', roleId: 'role-new', desiredState: 'present' })],
                message: createMessage(),
                options: [createOption()],
                state,
            })
        );
        readMember.mockResolvedValue(ok({ guildId: 'guild-1', userId: 'user-1', roleIds: [] }));
        vi.mocked(filterBotManageableRoleIds).mockResolvedValue(ok([]));

        const result = await runNextReactionRoleMemberReconciliation(createContext(), { leaseOwner: 'worker-1' });

        expect(result).toStrictEqual({ status: 'blocked', stateId: 'state-1', errorCode: 'role_hierarchy_blocked' });
        expect(blockReactionRoleMemberState).toHaveBeenCalledWith(
            {},
            expect.objectContaining({ errorCode: 'role_hierarchy_blocked', stateId: 'state-1' })
        );
        expect(deferReactionRoleMemberState).not.toHaveBeenCalled();
        expect(addRole).not.toHaveBeenCalled();
    });

    it('blocks an out-of-scope member claim before platform work', async () => {
        vi.mocked(claimNextReactionRoleMemberState).mockResolvedValue(ok(createState()));
        vi.mocked(isReactionRoleGuildRunnable).mockResolvedValue(ok(false));

        const result = await runNextReactionRoleMemberReconciliation(createContext(), { leaseOwner: 'worker-1' });

        expect(result).toMatchObject({ status: 'blocked', errorCode: 'guild_out_of_scope' });
        expect(blockReactionRoleMemberState).toHaveBeenCalled();
        expect(createFluxerPlatform).not.toHaveBeenCalled();
    });
});

function createState(overrides: Partial<ReactionRoleMemberStateRecord> = {}): ReactionRoleMemberStateRecord {
    const now = new Date('2026-07-10T08:00:00.000Z');
    return {
        configRevision: 1,
        createdAt: now,
        desiredEmojiKeys: ['✅'],
        errorCode: null,
        guildId: 'guild-1',
        id: 'state-1',
        leaseExpiresAt: new Date('2026-07-10T08:01:00.000Z'),
        leaseId: 'lease-1',
        leaseOwner: 'worker-1',
        messageId: 'message-1',
        nextAttemptAt: null,
        reactionRoleMessageId: 'menu-1',
        revision: 2,
        status: 'running',
        updatedAt: now,
        userId: 'user-1',
        ...overrides,
    };
}

function createMessage(): ReactionRoleMessageRecord {
    const now = new Date('2026-07-10T08:00:00.000Z');
    return {
        channelId: 'channel-1',
        createdAt: now,
        enabled: true,
        generateOverview: false,
        guildId: 'guild-1',
        id: 'menu-1',
        kind: 'reaction_role',
        lifecycle: 'ready',
        messageContent: 'Choose',
        messageEmbeds: [],
        messageId: 'message-1',
        mode: 'exclusive',
        pendingOperationId: null,
        revision: 1,
        source: 'dashboard',
        staleAt: null,
        updatedAt: now,
    };
}

function createOption(): ReactionRoleOptionRecord {
    const now = new Date('2026-07-10T08:00:00.000Z');
    return {
        createdAt: now,
        emojiKey: '✅',
        id: 'option-new',
        position: 0,
        reactionRoleMessageId: 'menu-1',
        roleId: 'role-new',
        updatedAt: now,
    };
}

function createAssignment(
    overrides: Pick<ReactionRoleAssignmentRecord, 'desiredState' | 'emojiKey' | 'roleId'>
): ReactionRoleAssignmentRecord {
    const now = new Date('2026-07-10T08:00:00.000Z');
    return {
        assignedAt: now,
        guildId: 'guild-1',
        id: `assignment-${overrides.roleId}`,
        messageId: 'message-1',
        reactionRoleMessageId: 'menu-1',
        removedAt: null,
        status: 'pending',
        updatedAt: now,
        userId: 'user-1',
        ...overrides,
    };
}

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

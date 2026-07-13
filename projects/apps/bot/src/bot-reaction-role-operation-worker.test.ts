import {
    acquireReactionRoleUserLease,
    claimNextReactionRoleOperation,
    completeReactionRoleDeleteOperation,
    completeReactionRolePublishOperation,
    completeReactionRoleReconciliationItem,
    deferReactionRoleOperation,
    hasOtherActiveReactionRoleAssignment,
    isReactionRoleGuildRunnable,
    listPendingReactionRoleReconciliationItems,
    markReactionRoleOperationNeedsAttention,
    markReactionRoleOperationSending,
    recordReactionRoleOperationExternalMessage,
    releaseReactionRoleUserLease,
    renewReactionRoleUserLease,
    type ReactionRoleOperationRecord,
} from '@neonflux/db';
import type * as NeonFluxDb from '@neonflux/db';
import { createFluxerPlatform } from '@neonflux/fluxer';
import type * as Fluxer from '@neonflux/fluxer';
import { err, ok } from 'neverthrow';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { runNextReactionRoleOperation } from './bot-reaction-role-operation-worker.js';
import type { BotFeatureHandlerContext } from './bot-feature-types.js';
import { filterBotManageableRoleIds } from './bot-role-safety.js';

const send = vi.fn();
const readMember = vi.fn();
const removeRole = vi.fn();
const removeReaction = vi.fn();
const react = vi.fn();

vi.mock('@neonflux/db', async (importActual) => ({
    ...(await importActual<typeof NeonFluxDb>()),
    acquireReactionRoleUserLease: vi.fn(),
    claimNextReactionRoleOperation: vi.fn(),
    completeReactionRoleDeleteOperation: vi.fn(),
    completeReactionRolePublishOperation: vi.fn(),
    completeReactionRoleReconciliationItem: vi.fn(),
    deferReactionRoleOperation: vi.fn(),
    hasOtherActiveReactionRoleAssignment: vi.fn(),
    isReactionRoleGuildRunnable: vi.fn(),
    listPendingReactionRoleReconciliationItems: vi.fn(),
    markReactionRoleOperationNeedsAttention: vi.fn(),
    markReactionRoleOperationSending: vi.fn(),
    recordReactionRoleOperationExternalMessage: vi.fn(),
    releaseReactionRoleUserLease: vi.fn(),
    renewReactionRoleUserLease: vi.fn(),
}));

vi.mock('@neonflux/fluxer', async (importActual) => ({
    ...(await importActual<typeof Fluxer>()),
    createFluxerPlatform: vi.fn(),
}));

vi.mock('./bot-role-safety.js', () => ({ filterBotManageableRoleIds: vi.fn() }));

describe('reaction-role operation worker', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(createFluxerPlatform).mockReturnValue({
            members: { read: readMember, removeRole },
            messages: { react, removeReaction, send },
        } as unknown as ReturnType<typeof createFluxerPlatform>);
        readMember.mockResolvedValue(ok({ guildId: 'guild-1', roleIds: ['role-1'], userId: 'user-1' }));
        removeRole.mockResolvedValue(ok(undefined));
        removeReaction.mockResolvedValue(ok(undefined));
        vi.mocked(acquireReactionRoleUserLease).mockResolvedValue(ok(true));
        vi.mocked(renewReactionRoleUserLease).mockResolvedValue(ok(true));
        vi.mocked(releaseReactionRoleUserLease).mockResolvedValue(ok(true));
        vi.mocked(hasOtherActiveReactionRoleAssignment).mockResolvedValue(ok(false));
        vi.mocked(isReactionRoleGuildRunnable).mockResolvedValue(ok(true));
        vi.mocked(completeReactionRoleReconciliationItem).mockResolvedValue(ok(true));
        vi.mocked(deferReactionRoleOperation).mockResolvedValue(ok(true));
        vi.mocked(markReactionRoleOperationNeedsAttention).mockResolvedValue(ok(true));
        vi.mocked(filterBotManageableRoleIds).mockResolvedValue(ok(['role-1']));
        vi.mocked(completeReactionRolePublishOperation).mockResolvedValue(ok(null));
        vi.mocked(completeReactionRoleDeleteOperation).mockResolvedValue(ok(null));
        vi.mocked(recordReactionRoleOperationExternalMessage).mockResolvedValue(ok(null));
    });

    it('never automatically retries an ambiguous publish outcome', async () => {
        const operation = createOperation();
        vi.mocked(claimNextReactionRoleOperation).mockResolvedValue(ok(operation));
        vi.mocked(markReactionRoleOperationSending).mockResolvedValue(ok({ ...operation, stage: 'sending' }));
        send.mockResolvedValue(err({ type: 'operation-failed', error: new Error('socket closed') }));

        const result = await runNextReactionRoleOperation(createContext(), {
            leaseOwner: 'worker-1',
            now: new Date('2026-07-10T08:00:00.000Z'),
        });

        expect(result).toStrictEqual({
            status: 'needs_attention',
            operationId: 'operation-1',
            errorCode: 'unknown_publish_outcome',
        });
        expect(markReactionRoleOperationNeedsAttention).toHaveBeenCalledWith(
            {},
            expect.objectContaining({ errorCode: 'unknown_publish_outcome', operationId: 'operation-1' })
        );
        expect(recordReactionRoleOperationExternalMessage).not.toHaveBeenCalled();
        expect(completeReactionRolePublishOperation).not.toHaveBeenCalled();
    });

    it('blocks an unmanageable target role before publishing external state', async () => {
        const operation = createOperation();
        vi.mocked(claimNextReactionRoleOperation).mockResolvedValue(ok(operation));
        vi.mocked(filterBotManageableRoleIds).mockResolvedValue(ok([]));

        const result = await runNextReactionRoleOperation(createContext(), {
            leaseOwner: 'worker-1',
            now: new Date('2026-07-10T08:00:00.000Z'),
        });

        expect(result).toStrictEqual({
            status: 'needs_attention',
            operationId: 'operation-1',
            errorCode: 'role_hierarchy_blocked',
        });
        expect(send).not.toHaveBeenCalled();
        expect(markReactionRoleOperationNeedsAttention).toHaveBeenCalledWith(
            {},
            expect.objectContaining({ errorCode: 'role_hierarchy_blocked' })
        );
    });

    it('does not revoke a role still owned by another menu during config cleanup', async () => {
        const operation = createReconcileOperation();
        vi.mocked(claimNextReactionRoleOperation).mockResolvedValue(ok(operation));
        vi.mocked(hasOtherActiveReactionRoleAssignment).mockResolvedValue(ok(true));
        vi.mocked(listPendingReactionRoleReconciliationItems).mockResolvedValue(
            ok([
                {
                    assignmentId: 'assignment-1',
                    attemptCount: 0,
                    createdAt: operation.createdAt,
                    emojiKey: '✅',
                    errorCode: null,
                    id: 'item-1',
                    operationId: operation.id,
                    outcome: null,
                    roleId: 'role-1',
                    status: 'pending',
                    updatedAt: operation.updatedAt,
                    userId: 'user-1',
                },
            ])
        );

        await runNextReactionRoleOperation(createContext(), { leaseOwner: 'worker-1' });

        expect(removeRole).not.toHaveBeenCalled();
        expect(removeReaction).toHaveBeenCalled();
        expect(completeReactionRoleReconciliationItem).toHaveBeenCalled();
    });

    it('stops automatic retries after the bounded transient failure budget', async () => {
        const operation = {
            ...createOperation(),
            externalMessageId: 'message-1',
            failureCount: 7,
            stage: 'reactions',
        };
        vi.mocked(claimNextReactionRoleOperation).mockResolvedValue(ok(operation));
        react.mockResolvedValue(err({ type: 'operation-failed', error: new Error('temporary outage') }));

        const result = await runNextReactionRoleOperation(createContext(), { leaseOwner: 'worker-1' });

        expect(result).toMatchObject({ status: 'needs_attention', errorCode: 'reaction_seed_failed_retry_exhausted' });
        expect(deferReactionRoleOperation).not.toHaveBeenCalled();
    });

    it('surfaces a missing external message without retrying forever', async () => {
        const operation = { ...createOperation(), externalMessageId: 'message-1', stage: 'reactions' };
        vi.mocked(claimNextReactionRoleOperation).mockResolvedValue(ok(operation));
        react.mockResolvedValue(err({ type: 'not-found' }));

        const result = await runNextReactionRoleOperation(createContext(), { leaseOwner: 'worker-1' });

        expect(result).toMatchObject({ status: 'needs_attention', errorCode: 'external_not_found' });
        expect(deferReactionRoleOperation).not.toHaveBeenCalled();
    });

    it('terminates an out-of-scope claim before platform work', async () => {
        vi.mocked(claimNextReactionRoleOperation).mockResolvedValue(ok(createOperation()));
        vi.mocked(isReactionRoleGuildRunnable).mockResolvedValue(ok(false));

        const result = await runNextReactionRoleOperation(createContext(), { leaseOwner: 'worker-1' });

        expect(result).toMatchObject({ status: 'needs_attention', errorCode: 'guild_out_of_scope' });
        expect(markReactionRoleOperationNeedsAttention).toHaveBeenCalledWith(
            {},
            expect.objectContaining({ errorCode: 'guild_out_of_scope' })
        );
        expect(createFluxerPlatform).not.toHaveBeenCalled();
    });

    it('keeps a delete tombstone retryable while bounded child cleanup continues', async () => {
        vi.mocked(claimNextReactionRoleOperation).mockResolvedValue(
            ok({
                ...createOperation(),
                externalMessageId: 'message-1',
                idempotencyKey: 'gateway-message-deleted:message-1',
                reactionRoleMessageId: 'menu-1',
                stage: 'message',
                type: 'delete',
            })
        );

        const result = await runNextReactionRoleOperation(createContext(), { leaseOwner: 'worker-1' });

        expect(result).toMatchObject({ status: 'deferred', errorCode: 'cleanup_progress' });
        expect(deferReactionRoleOperation).toHaveBeenCalledWith(
            {},
            expect.objectContaining({ errorCode: 'cleanup_progress' })
        );
        expect(createFluxerPlatform).not.toHaveBeenCalled();
    });
});

function createReconcileOperation(): ReactionRoleOperationRecord {
    return {
        ...createOperation(),
        expectedRevision: 1,
        externalMessageId: 'message-1',
        reactionRoleMessageId: 'menu-1',
        snapshotComplete: true,
        stage: 'reconcile',
        totalCount: 1,
        type: 'save',
    };
}

function createOperation(): ReactionRoleOperationRecord {
    const now = new Date('2026-07-10T08:00:00.000Z');
    return {
        actorUserId: 'actor-1',
        attemptCount: 1,
        blockedCount: 0,
        channelId: 'channel-1',
        completedAt: null,
        createdAt: now,
        desiredConfig: {
            enabled: true,
            generateOverview: false,
            messageContent: 'Choose a role',
            messageEmbeds: [],
            mode: 'normal',
            options: [{ emojiKey: '✅', position: 0, roleId: 'role-1' }],
        },
        errorCode: null,
        expectedRevision: null,
        externalMessageId: null,
        failureCount: 0,
        guildId: 'guild-1',
        id: 'operation-1',
        idempotencyKey: 'idem-1',
        leaseExpiresAt: new Date('2026-07-10T08:01:00.000Z'),
        leaseId: 'lease-1',
        leaseOwner: 'worker-1',
        nextAttemptAt: null,
        processedCount: 0,
        reactionRoleMessageId: null,
        requestHash: 'hash-1',
        sendStartedAt: null,
        snapshotComplete: true,
        snapshotCursor: null,
        stage: 'send',
        status: 'running',
        succeededCount: 0,
        totalCount: 0,
        type: 'publish',
        updatedAt: now,
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

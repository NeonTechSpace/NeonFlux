import { describe, expect, it } from 'vitest';

import type { ConvexDatabase } from './convex.js';
import {
    claimNextReactionRoleOperation,
    maintainReactionRoleState,
    requestReactionRolePublishOperation,
    retryReactionRoleOperation,
} from './runtime-reaction-role-operations.js';

const operation = {
    actorUserId: 'user-1',
    attemptCount: 0,
    blockedCount: 0,
    channelId: 'channel-1',
    completedAt: null,
    createdAt: '2026-07-10T08:00:00.000Z',
    desiredConfig: {
        enabled: true,
        generateOverview: false,
        messageContent: 'Choose a role.',
        messageEmbeds: [],
        mode: 'normal' as const,
        options: [{ emojiKey: '🎉', position: 0, roleId: 'role-1' }],
    },
    errorCode: null,
    expectedRevision: null,
    externalMessageId: null,
    failureCount: 0,
    guildId: 'guild-1',
    id: 'operation-1',
    idempotencyKey: 'request-1',
    leaseExpiresAt: null,
    leaseId: null,
    leaseOwner: null,
    nextAttemptAt: null,
    processedCount: 0,
    reactionRoleMessageId: null,
    requestHash: 'hash-1',
    sendStartedAt: null,
    snapshotComplete: false,
    snapshotCursor: null,
    stage: 'queued',
    status: 'queued' as const,
    succeededCount: 0,
    totalCount: 0,
    type: 'publish' as const,
    updatedAt: '2026-07-10T08:00:00.000Z',
};

describe('reaction-role operation database adapters', () => {
    it('maps operation dates and forwards normalized publish inputs', async () => {
        const db = createConvexDb([{ type: 'accepted', operation }]);

        const result = await requestReactionRolePublishOperation(db, {
            actorUserId: ' user-1 ',
            channelId: ' channel-1 ',
            desiredConfig: operation.desiredConfig,
            guildId: ' guild-1 ',
            idempotencyKey: ' request-1 ',
            requestHash: ' hash-1 ',
        });

        expect(result._unsafeUnwrap()).toMatchObject({
            type: 'accepted',
            operation: { createdAt: new Date(operation.createdAt), updatedAt: new Date(operation.updatedAt) },
        });
        expect(db.client.mutationCalls[0]?.args).toStrictEqual({
            actorUserId: ' user-1 ',
            channelId: ' channel-1 ',
            desiredConfig: operation.desiredConfig,
            guildId: ' guild-1 ',
            idempotencyKey: ' request-1 ',
            requestHash: ' hash-1 ',
        });
    });

    it('preserves unknown-publish confirmation when retrying', async () => {
        const db = createConvexDb([{ type: 'queued', operation }]);

        const result = await retryReactionRoleOperation(db, {
            confirmUnknownPublishAbsent: true,
            guildId: ' guild-1 ',
            operationId: ' operation-1 ',
        });

        expect(result._unsafeUnwrap().type).toBe('queued');
        expect(db.client.mutationCalls[0]?.args).toStrictEqual({
            confirmUnknownPublishAbsent: true,
            guildId: 'guild-1',
            operationId: 'operation-1',
        });
    });

    it('serializes worker leases and maintenance retention boundaries', async () => {
        const leasedOperation = {
            ...operation,
            leaseExpiresAt: '2026-07-10T08:01:00.000Z',
            leaseId: 'lease-1',
            leaseOwner: 'worker-1',
            status: 'running' as const,
        };
        const maintenanceResult = {
            assignmentsBackfilled: 2,
            expiredUserLeasesDeleted: 2,
            hasMore: false,
            messagesBackfilled: 1,
            operationsDeleted: 1,
            reconciliationItemsDeleted: 3,
            removedAssignmentsDeleted: 4,
        };
        const db = createConvexDb([leasedOperation, maintenanceResult]);

        const claim = await claimNextReactionRoleOperation(db, {
            leaseExpiresAt: new Date('2026-07-10T08:01:00.000Z'),
            leaseId: ' lease-1 ',
            leaseOwner: ' worker-1 ',
            now: new Date('2026-07-10T08:00:00.000Z'),
        });
        const maintenance = await maintainReactionRoleState(db, {
            assignmentLimit: 25,
            now: new Date('2026-07-10T08:00:00.000Z'),
            retentionBefore: new Date('2026-06-10T08:00:00.000Z'),
        });

        expect(claim._unsafeUnwrap()?.leaseExpiresAt).toStrictEqual(new Date('2026-07-10T08:01:00.000Z'));
        expect(maintenance._unsafeUnwrap()).toStrictEqual(maintenanceResult);
        expect(db.client.mutationCalls[1]?.args).toStrictEqual({
            assignmentLimit: 25,
            now: '2026-07-10T08:00:00.000Z',
            retentionBefore: '2026-06-10T08:00:00.000Z',
        });
    });
});

function createConvexDb(mutationResults: unknown[]): ConvexDatabase & {
    client: { mutationCalls: Array<{ args: unknown; reference: unknown }> };
} {
    const results = [...mutationResults];
    const client = {
        mutationCalls: [] as Array<{ args: unknown; reference: unknown }>,
        mutation(reference: unknown, args: unknown) {
            this.mutationCalls.push({ args, reference });
            return Promise.resolve(results.shift());
        },
    };
    return {
        client: client as unknown as ConvexDatabase['client'] & typeof client,
        kind: 'convex',
        serviceName: 'bot',
    };
}

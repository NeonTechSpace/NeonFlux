import { api } from '@neonflux/convex-api';
import type { NeonFluxConvexMutationReference } from '@neonflux/convex/client';
import { err, ok, type Result } from 'neverthrow';

import type {
    ReactionRoleDesiredConfig,
    ReactionRoleMaintenanceResult,
    ReactionRoleOperationRecord,
    ReactionRoleOperationRequestResult,
    ReactionRoleOperationRetryResult,
    ReactionRoleReconciliationItemRecord,
    ReactionRolesRepositoryError,
} from './contracts-reaction-roles.js';
import type { ConvexDatabase } from './convex.js';
import { compactConvexArgs } from './convex-args.js';

type DbResult<Value> = Promise<Result<Value, ReactionRolesRepositoryError>>;
type ConvexOperation = Omit<
    ReactionRoleOperationRecord,
    'completedAt' | 'createdAt' | 'leaseExpiresAt' | 'nextAttemptAt' | 'sendStartedAt' | 'updatedAt'
> & {
    completedAt: string | null;
    createdAt: string;
    leaseExpiresAt: string | null;
    nextAttemptAt: string | null;
    sendStartedAt: string | null;
    updatedAt: string;
};
type ConvexItem = Omit<ReactionRoleReconciliationItemRecord, 'createdAt' | 'updatedAt'> & {
    createdAt: string;
    updatedAt: string;
};

export async function requestReactionRolePublishOperation(
    db: ConvexDatabase,
    input: OperationActorInput & {
        channelId: string;
        desiredConfig: ReactionRoleDesiredConfig;
        guildId: string;
        idempotencyKey: string;
        requestHash: string;
    }
): DbResult<ReactionRoleOperationRequestResult> {
    return requestOperation(db, api.reaction_roles.requestReactionRolePublishOperation, input);
}

export async function requestReactionRoleSaveOperation(
    db: ConvexDatabase,
    input: OperationActorInput & {
        desiredConfig: ReactionRoleDesiredConfig;
        expectedRevision: number;
        guildId: string;
        idempotencyKey: string;
        messageId: string;
        requestHash: string;
    }
): DbResult<ReactionRoleOperationRequestResult> {
    return requestOperation(db, api.reaction_roles.requestReactionRoleSaveOperation, input);
}

export async function requestReactionRoleDeleteOperation(
    db: ConvexDatabase,
    input: OperationActorInput & {
        expectedRevision: number;
        guildId: string;
        idempotencyKey: string;
        messageId: string;
        requestHash: string;
    }
): DbResult<ReactionRoleOperationRequestResult> {
    return requestOperation(db, api.reaction_roles.requestReactionRoleDeleteOperation, input);
}

export async function requestReactionRoleExternalMessageDeleted(
    db: ConvexDatabase,
    input: { guildId: string; messageId: string }
): DbResult<boolean> {
    return mutateBoolean(db, api.reaction_roles.requestReactionRoleExternalMessageDeleted, {
        guildId: input.guildId.trim(),
        messageId: input.messageId.trim(),
    });
}

export async function listReactionRoleOperationsByGuildId(
    db: ConvexDatabase,
    input: { guildId: string; limit?: number }
): DbResult<ReactionRoleOperationRecord[]> {
    try {
        const operations = await db.client.query(
            api.reaction_roles.listReactionRoleOperationsByGuildId,
            compactConvexArgs({ guildId: input.guildId.trim(), limit: input.limit })
        );
        return ok(operations.map((operation) => toOperationRecord(operation as ConvexOperation)));
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function retryReactionRoleOperation(
    db: ConvexDatabase,
    input: { confirmUnknownPublishAbsent: boolean; guildId: string; operationId: string }
): DbResult<ReactionRoleOperationRetryResult> {
    try {
        const result = await db.client.mutation(api.reaction_roles.retryReactionRoleOperation, {
            confirmUnknownPublishAbsent: input.confirmUnknownPublishAbsent,
            guildId: input.guildId.trim(),
            operationId: input.operationId.trim(),
        });
        return ok(
            result.type === 'queued'
                ? { type: 'queued', operation: toOperationRecord(result.operation as ConvexOperation) }
                : { type: result.type }
        );
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function maintainReactionRoleState(
    db: ConvexDatabase,
    input: {
        assignmentLimit?: number;
        historyItemLimit?: number;
        messageLimit?: number;
        now: Date;
        retentionBefore: Date;
    }
): DbResult<ReactionRoleMaintenanceResult> {
    try {
        return ok(
            await db.client.mutation(
                api.reaction_roles.maintainReactionRoleState,
                compactConvexArgs({
                    assignmentLimit: input.assignmentLimit,
                    historyItemLimit: input.historyItemLimit,
                    messageLimit: input.messageLimit,
                    now: input.now.toISOString(),
                    retentionBefore: input.retentionBefore.toISOString(),
                })
            )
        );
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function claimNextReactionRoleOperation(
    db: ConvexDatabase,
    input: { leaseExpiresAt: Date; leaseId: string; leaseOwner: string; now: Date }
): DbResult<ReactionRoleOperationRecord | null> {
    return mutateOptionalOperation(db, api.reaction_roles.claimNextReactionRoleOperation, {
        leaseExpiresAt: input.leaseExpiresAt.toISOString(),
        leaseId: input.leaseId.trim(),
        leaseOwner: input.leaseOwner.trim(),
        now: input.now.toISOString(),
    });
}

export async function markReactionRoleOperationSending(
    db: ConvexDatabase,
    input: LeaseInput
): DbResult<ReactionRoleOperationRecord | null> {
    return mutateOptionalOperation(db, api.reaction_roles.markReactionRoleOperationSending, toLeaseArgs(input));
}

export async function recordReactionRoleOperationExternalMessage(
    db: ConvexDatabase,
    input: LeaseInput & { channelId: string; externalMessageId: string }
): DbResult<ReactionRoleOperationRecord | null> {
    return mutateOptionalOperation(db, api.reaction_roles.recordReactionRoleOperationExternalMessage, {
        ...toLeaseArgs(input),
        channelId: input.channelId.trim(),
        externalMessageId: input.externalMessageId.trim(),
    });
}

export async function snapshotReactionRoleOperationAssignments(
    db: ConvexDatabase,
    input: LeaseInput & { cursor: string | null; limit: number }
): DbResult<{ createdCount: number; cursor: string | null; done: boolean }> {
    try {
        return ok(
            await db.client.mutation(api.reaction_roles.snapshotReactionRoleOperationAssignments, {
                ...toLeaseArgs(input),
                cursor: input.cursor,
                limit: input.limit,
            })
        );
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function listPendingReactionRoleReconciliationItems(
    db: ConvexDatabase,
    input: { limit: number; operationId: string }
): DbResult<ReactionRoleReconciliationItemRecord[]> {
    try {
        const items = await db.client.query(api.reaction_roles.listPendingReactionRoleReconciliationItems, input);
        return ok(items.map((item) => toItemRecord(item as ConvexItem)));
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function completeReactionRoleReconciliationItem(
    db: ConvexDatabase,
    input: LeaseInput & { itemId: string; outcome: string }
): DbResult<boolean> {
    return mutateBoolean(db, api.reaction_roles.completeReactionRoleReconciliationItem, {
        ...toLeaseArgs(input),
        itemId: input.itemId,
        outcome: input.outcome.trim(),
    });
}

export async function blockReactionRoleReconciliationItem(
    db: ConvexDatabase,
    input: LeaseInput & { errorCode: string; itemId: string }
): DbResult<boolean> {
    return mutateBoolean(db, api.reaction_roles.blockReactionRoleReconciliationItem, {
        ...toLeaseArgs(input),
        errorCode: input.errorCode.trim(),
        itemId: input.itemId,
    });
}

export async function deferReactionRoleOperation(
    db: ConvexDatabase,
    input: LeaseInput & { errorCode: string; nextAttemptAt: Date }
): DbResult<boolean> {
    return mutateBoolean(db, api.reaction_roles.deferReactionRoleOperation, {
        ...toLeaseArgs(input),
        errorCode: input.errorCode.trim(),
        nextAttemptAt: input.nextAttemptAt.toISOString(),
    });
}

export async function markReactionRoleOperationNeedsAttention(
    db: ConvexDatabase,
    input: LeaseInput & { errorCode: string }
): DbResult<boolean> {
    return mutateBoolean(db, api.reaction_roles.markReactionRoleOperationNeedsAttention, {
        ...toLeaseArgs(input),
        errorCode: input.errorCode.trim(),
    });
}

export async function completeReactionRolePublishOperation(
    db: ConvexDatabase,
    input: LeaseInput
): DbResult<ReactionRoleOperationRecord | null> {
    return mutateOptionalOperation(db, api.reaction_roles.completeReactionRolePublishOperation, toLeaseArgs(input));
}

export async function completeReactionRoleSaveOperation(
    db: ConvexDatabase,
    input: LeaseInput
): DbResult<ReactionRoleOperationRecord | null> {
    return mutateOptionalOperation(db, api.reaction_roles.completeReactionRoleSaveOperation, toLeaseArgs(input));
}

export async function completeReactionRoleDeleteOperation(
    db: ConvexDatabase,
    input: LeaseInput
): DbResult<ReactionRoleOperationRecord | null> {
    return mutateOptionalOperation(db, api.reaction_roles.completeReactionRoleDeleteOperation, toLeaseArgs(input));
}

type OperationActorInput = { actorMetadata?: unknown; actorUserId: string };
type LeaseInput = { leaseId: string; now: Date; operationId: string };

async function requestOperation(
    db: ConvexDatabase,
    reference: NeonFluxConvexMutationReference,
    input: Record<string, unknown>
): DbResult<ReactionRoleOperationRequestResult> {
    try {
        const result = (await db.client.mutation(reference, compactConvexArgs(input))) as
            | { type: 'accepted' | 'existing' | 'busy'; operation: ConvexOperation | null }
            | { type: 'idempotency-conflict' | 'not-found' }
            | { type: 'revision-conflict'; currentRevision: number };
        if (result.type === 'accepted' || result.type === 'existing') {
            if (!result.operation) return err({ type: 'database-error' });
            return ok({ type: result.type, operation: toOperationRecord(result.operation) });
        }
        if (result.type === 'busy') {
            return ok({ type: 'busy', operation: result.operation ? toOperationRecord(result.operation) : null });
        }
        if (result.type === 'revision-conflict') {
            return ok({ type: 'revision-conflict', currentRevision: result.currentRevision });
        }
        return ok({ type: result.type });
    } catch {
        return err({ type: 'database-error' });
    }
}

async function mutateOptionalOperation(
    db: ConvexDatabase,
    reference: NeonFluxConvexMutationReference,
    args: Record<string, unknown>
): DbResult<ReactionRoleOperationRecord | null> {
    try {
        const operation = (await db.client.mutation(reference, args)) as ConvexOperation | null;
        return ok(operation ? toOperationRecord(operation) : null);
    } catch {
        return err({ type: 'database-error' });
    }
}

async function mutateBoolean(
    db: ConvexDatabase,
    reference: NeonFluxConvexMutationReference,
    args: Record<string, unknown>
): DbResult<boolean> {
    try {
        return ok((await db.client.mutation(reference, args)) as boolean);
    } catch {
        return err({ type: 'database-error' });
    }
}

function toLeaseArgs(input: LeaseInput) {
    return {
        leaseId: input.leaseId.trim(),
        now: input.now.toISOString(),
        operationId: input.operationId,
    };
}

function toOperationRecord(record: ConvexOperation): ReactionRoleOperationRecord {
    return {
        ...record,
        completedAt: record.completedAt ? new Date(record.completedAt) : null,
        createdAt: new Date(record.createdAt),
        leaseExpiresAt: record.leaseExpiresAt ? new Date(record.leaseExpiresAt) : null,
        nextAttemptAt: record.nextAttemptAt ? new Date(record.nextAttemptAt) : null,
        sendStartedAt: record.sendStartedAt ? new Date(record.sendStartedAt) : null,
        updatedAt: new Date(record.updatedAt),
    };
}

function toItemRecord(record: ConvexItem): ReactionRoleReconciliationItemRecord {
    return { ...record, createdAt: new Date(record.createdAt), updatedAt: new Date(record.updatedAt) };
}

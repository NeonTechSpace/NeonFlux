import { api } from '@neonflux/convex-api';
import type { ReactionRoleEmoji, ReactionRolePanelDraft } from '@neonflux/reaction-roles';
import { err, ok, type Result } from 'neverthrow';

import type {
    ReactionRoleExecutionPolicy,
    ReactionRoleIntentResult,
    ReactionRoleMemberWorkerRecord,
    ReactionRolePanelMutationRecord,
    ReactionRolePanelRecord,
    ReactionRolePanelWorkerRecord,
    ReactionRoleRepositoryError,
} from './contracts-reaction-roles.js';
import type { ConvexDatabase } from './convex.js';

type RepositoryResult<T> = Promise<Result<T, ReactionRoleRepositoryError>>;

type ConvexPanelRecord = {
    appliedVersionId: string | null;
    channelId: string;
    createdAt: string;
    desiredVersion: ConvexVersionRecord;
    errorCode: string | null;
    generation: number;
    guildId: string;
    id: string;
    messageId: string | null;
    mode: 'independent' | 'exclusive';
    name: string;
    status: ReactionRolePanelRecord['status'];
    updatedAt: string;
};

type ConvexVersionRecord = Omit<ReactionRolePanelRecord['desiredVersion'], 'createdAt'> & {
    createdAt: string;
};

type ConvexOperationRecord = Omit<
    ReactionRolePanelMutationRecord['operation'],
    'createdAt' | 'nextAttemptAt' | 'updatedAt'
> & {
    createdAt: string;
    nextAttemptAt: string | null;
    updatedAt: string;
};

type ConvexPanelWorkerRecord = Omit<
    ReactionRolePanelWorkerRecord,
    'createdAt' | 'leaseExpiresAt' | 'nextAttemptAt' | 'previousVersion' | 'targetVersion' | 'updatedAt'
> & {
    createdAt: string;
    leaseExpiresAt: string | null;
    nextAttemptAt: string | null;
    previousVersion: ConvexVersionRecord | null;
    targetVersion: ConvexVersionRecord;
    updatedAt: string;
};

type ConvexMemberWorkerRecord = Omit<
    ReactionRoleMemberWorkerRecord,
    'createdAt' | 'leaseExpiresAt' | 'nextAttemptAt' | 'updatedAt'
> & {
    createdAt: string;
    leaseExpiresAt: string | null;
    nextAttemptAt: string | null;
    updatedAt: string;
};

export async function readReactionRoleExecutionPolicy(
    db: ConvexDatabase,
    input: { guildId: string }
): RepositoryResult<ReactionRoleExecutionPolicy> {
    const guildId = input.guildId.trim();
    if (!guildId) return err({ field: 'guildId', type: 'missing-input' });

    try {
        return ok(await db.client.query(api.reaction_roles.readReactionRoleExecutionPolicy, { guildId }));
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function publishReactionRolePanel(
    db: ConvexDatabase,
    input: {
        actorUserId: string;
        channelId: string;
        guildId: string;
        name: string;
        payload: ReactionRolePanelDraft;
        requestKey: string;
    }
): RepositoryResult<ReactionRolePanelMutationRecord> {
    return panelMutation(db, api.reaction_roles.publishReactionRolePanel, input);
}

export async function updateReactionRolePanel(
    db: ConvexDatabase,
    input: {
        actorUserId: string;
        channelId: string;
        expectedUpdatedAt: Date;
        guildId: string;
        name: string;
        panelId: string;
        payload: ReactionRolePanelDraft;
        requestKey: string;
    }
): RepositoryResult<ReactionRolePanelMutationRecord> {
    return panelMutation(db, api.reaction_roles.updateReactionRolePanel, {
        ...input,
        expectedUpdatedAt: input.expectedUpdatedAt.toISOString(),
    });
}

export async function deactivateReactionRolePanel(
    db: ConvexDatabase,
    input: {
        actorUserId: string;
        deleteMessage: boolean;
        expectedUpdatedAt: Date;
        guildId: string;
        panelId: string;
        requestKey: string;
        revokeOwnedRoles: boolean;
    }
): RepositoryResult<ReactionRolePanelMutationRecord> {
    return panelMutation(db, api.reaction_roles.deactivateReactionRolePanel, {
        ...input,
        expectedUpdatedAt: input.expectedUpdatedAt.toISOString(),
    });
}

export async function listReactionRolePanelsByGuild(
    db: ConvexDatabase,
    input: { guildId: string }
): RepositoryResult<ReactionRolePanelRecord[]> {
    try {
        const records = (await db.client.query(
            api.reaction_roles.listReactionRolePanelsByGuild,
            input
        )) as ConvexPanelRecord[];
        return ok(records.map(toPanelRecord));
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function readReactionRolePanelByMessage(
    db: ConvexDatabase,
    input: { guildId: string; messageId: string }
): RepositoryResult<ReactionRolePanelRecord | null> {
    try {
        const record = (await db.client.query(
            api.reaction_roles.readReactionRolePanelByMessage,
            input
        )) as ConvexPanelRecord | null;
        return ok(record ? toPanelRecord(record) : null);
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function claimNextReactionRolePanelOperation(
    db: ConvexDatabase,
    input: { leaseExpiresAt: Date; leaseId: string; leaseOwner: string; now: Date }
): RepositoryResult<ReactionRolePanelWorkerRecord | null> {
    return panelWorkerMutation(db, api.reaction_roles.claimNextReactionRolePanelOperation, dates(input));
}

export async function readReactionRolePanelOperationForWorker(
    db: ConvexDatabase,
    input: { operationId: string }
): RepositoryResult<ReactionRolePanelWorkerRecord | null> {
    return panelWorkerQuery(db, api.reaction_roles.readReactionRolePanelOperationForWorker, input);
}

export async function advanceReactionRolePanelOperation(
    db: ConvexDatabase,
    input: {
        leaseId: string;
        messageId?: string;
        now: Date;
        operationId: string;
        step: ReactionRolePanelWorkerRecord['step'];
    }
): RepositoryResult<ReactionRolePanelWorkerRecord | null> {
    return panelWorkerMutation(db, api.reaction_roles.advanceReactionRolePanelOperation, dates(input));
}

export async function renewReactionRolePanelOperationLease(
    db: ConvexDatabase,
    input: { leaseExpiresAt: Date; leaseId: string; now: Date; operationId: string }
): RepositoryResult<boolean> {
    return booleanMutation(db, api.reaction_roles.renewReactionRolePanelOperationLease, dates(input));
}

export async function deferReactionRolePanelOperation(
    db: ConvexDatabase,
    input: { errorCode: string; leaseId: string; nextAttemptAt: Date; now: Date; operationId: string }
): RepositoryResult<boolean> {
    return booleanMutation(db, api.reaction_roles.deferReactionRolePanelOperation, dates(input));
}

export async function pauseReactionRolePanelOperation(
    db: ConvexDatabase,
    input: { leaseId: string; nextAttemptAt: Date; now: Date; operationId: string }
): RepositoryResult<boolean> {
    return booleanMutation(db, api.reaction_roles.pauseReactionRolePanelOperation, dates(input));
}

export async function yieldReactionRolePanelOperation(
    db: ConvexDatabase,
    input: { leaseId: string; now: Date; operationId: string }
): RepositoryResult<boolean> {
    return booleanMutation(db, api.reaction_roles.yieldReactionRolePanelOperation, dates(input));
}

export async function failReactionRolePanelOperation(
    db: ConvexDatabase,
    input: { errorCode: string; leaseId: string; now: Date; operationId: string; unknown: boolean }
): RepositoryResult<boolean> {
    return booleanMutation(db, api.reaction_roles.failReactionRolePanelOperation, dates(input));
}

export async function completeReactionRolePanelOperation(
    db: ConvexDatabase,
    input: { leaseId: string; now: Date; operationId: string }
): RepositoryResult<'completed' | 'pending' | 'stale'> {
    try {
        return ok(await db.client.mutation(api.reaction_roles.completeReactionRolePanelOperation, dates(input)));
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function recordReactionRoleReactionIntent(
    db: ConvexDatabase,
    input: {
        channelId: string;
        emoji: ReactionRoleEmoji;
        guildId: string;
        messageId: string;
        selected: boolean;
        userId: string;
        userIsBot: boolean;
    }
): RepositoryResult<ReactionRoleIntentResult> {
    try {
        return ok(await db.client.mutation(api.reaction_roles.recordReactionRoleReactionIntent, input));
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function markReactionRolePanelAggregateDrift(
    db: ConvexDatabase,
    input: {
        emojiKey?: string;
        guildId?: string;
        messageId: string;
        type: 'all-reactions-removed' | 'emoji-removed' | 'message-deleted';
    }
): RepositoryResult<boolean> {
    return booleanMutation(db, api.reaction_roles.markReactionRolePanelAggregateDrift, input);
}

export async function removeReactionRoleMemberState(
    db: ConvexDatabase,
    input: { guildId: string; userId: string }
): RepositoryResult<number> {
    try {
        return ok(await db.client.mutation(api.reaction_roles.removeReactionRoleMemberState, input));
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function reconcileReactionRoleMemberRoles(
    db: ConvexDatabase,
    input: { guildId: string; roleIds: string[]; userId: string }
): RepositoryResult<number> {
    try {
        return ok(await db.client.mutation(api.reaction_roles.reconcileReactionRoleMemberRoles, input));
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function beginReactionRolePanelReconciliation(
    db: ConvexDatabase,
    input: {
        expectedGeneration: number;
        guildId: string;
        panelId: string;
        reconciliationId: string;
    }
): RepositoryResult<{ generation: number; type: 'started' } | { type: 'stale' }> {
    try {
        return ok(await db.client.mutation(api.reaction_roles.beginReactionRolePanelReconciliation, input));
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function applyReactionRolePanelReconciliationBatch(
    db: ConvexDatabase,
    input: {
        generation: number;
        guildId: string;
        panelId: string;
        reconciliationId: string;
        users: Array<{ optionIds: string[]; userId: string }>;
    }
): RepositoryResult<{ changedUserCount: number; type: 'applied' } | { type: 'stale' }> {
    try {
        return ok(await db.client.mutation(api.reaction_roles.applyReactionRolePanelReconciliationBatch, input));
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function finalizeReactionRolePanelReconciliation(
    db: ConvexDatabase,
    input: { generation: number; guildId: string; panelId: string; reconciliationId: string }
): RepositoryResult<'completed' | 'pending' | 'stale'> {
    try {
        return ok(await db.client.mutation(api.reaction_roles.finalizeReactionRolePanelReconciliation, input));
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function cancelReactionRolePanelReconciliation(
    db: ConvexDatabase,
    input: { generation: number; guildId: string; panelId: string; reconciliationId: string }
): RepositoryResult<'completed' | 'pending' | 'stale'> {
    try {
        return ok(await db.client.mutation(api.reaction_roles.cancelReactionRolePanelReconciliation, input));
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function claimNextReactionRoleMemberOperation(
    db: ConvexDatabase,
    input: { leaseExpiresAt: Date; leaseId: string; leaseOwner: string; now: Date }
): RepositoryResult<ReactionRoleMemberWorkerRecord | null> {
    return memberWorkerMutation(db, api.reaction_roles.claimNextReactionRoleMemberOperation, dates(input));
}

export async function readReactionRoleMemberOperationForWorker(
    db: ConvexDatabase,
    input: { operationId: string }
): RepositoryResult<ReactionRoleMemberWorkerRecord | null> {
    return memberWorkerQuery(db, api.reaction_roles.readReactionRoleMemberOperationForWorker, input);
}

export async function recordReactionRoleMemberBaseline(
    db: ConvexDatabase,
    input: { leaseId: string; now: Date; operationId: string; roleIds: string[] }
): RepositoryResult<ReactionRoleMemberWorkerRecord | null> {
    return memberWorkerMutation(db, api.reaction_roles.recordReactionRoleMemberBaseline, dates(input));
}

export async function renewReactionRoleMemberOperationLease(
    db: ConvexDatabase,
    input: { leaseExpiresAt: Date; leaseId: string; now: Date; operationId: string }
): RepositoryResult<boolean> {
    return booleanMutation(db, api.reaction_roles.renewReactionRoleMemberOperationLease, dates(input));
}

export async function completeReactionRoleMemberOperation(
    db: ConvexDatabase,
    input: {
        leaseId: string;
        now: Date;
        operationId: string;
        ownerships: Array<{ grantOwnership: 'panel' | 'preexisting'; optionId: string }>;
        revision: number;
    }
): RepositoryResult<'completed' | 'stale' | 'missing'> {
    try {
        return ok(await db.client.mutation(api.reaction_roles.completeReactionRoleMemberOperation, dates(input)));
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function rollbackReactionRoleMemberOperation(
    db: ConvexDatabase,
    input: {
        degradePanel: boolean;
        errorCode: string;
        leaseId: string;
        now: Date;
        operationId: string;
        revision: number;
    }
): RepositoryResult<'rolled-back' | 'stale' | 'missing'> {
    try {
        return ok(await db.client.mutation(api.reaction_roles.rollbackReactionRoleMemberOperation, dates(input)));
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function deferReactionRoleMemberOperation(
    db: ConvexDatabase,
    input: { errorCode: string; leaseId: string; nextAttemptAt: Date; now: Date; operationId: string }
): RepositoryResult<boolean> {
    return booleanMutation(db, api.reaction_roles.deferReactionRoleMemberOperation, dates(input));
}

export async function pauseReactionRoleMemberOperation(
    db: ConvexDatabase,
    input: { leaseId: string; nextAttemptAt: Date; now: Date; operationId: string }
): RepositoryResult<boolean> {
    return booleanMutation(db, api.reaction_roles.pauseReactionRoleMemberOperation, dates(input));
}

export async function requeueStaleReactionRoleMemberOperation(
    db: ConvexDatabase,
    input: { leaseId: string; now: Date; operationId: string; revision: number }
): RepositoryResult<boolean> {
    return booleanMutation(db, api.reaction_roles.requeueStaleReactionRoleMemberOperation, dates(input));
}

async function panelMutation(
    db: ConvexDatabase,
    reference: Parameters<ConvexDatabase['client']['mutation']>[0],
    args: Record<string, unknown>
): RepositoryResult<ReactionRolePanelMutationRecord> {
    try {
        const value = (await db.client.mutation(reference, args)) as {
            operation: ConvexOperationRecord;
            panel: ConvexPanelRecord;
        };
        return ok({ operation: toOperationRecord(value.operation), panel: toPanelRecord(value.panel) });
    } catch (errorValue) {
        return err(mapError(errorValue));
    }
}

async function panelWorkerQuery(
    db: ConvexDatabase,
    reference: Parameters<ConvexDatabase['client']['query']>[0],
    args: Record<string, unknown>
): RepositoryResult<ReactionRolePanelWorkerRecord | null> {
    try {
        const value = (await db.client.query(reference, args)) as unknown;
        return ok(value ? toPanelWorkerRecord(value as ConvexPanelWorkerRecord) : null);
    } catch {
        return err({ type: 'database-error' });
    }
}

async function panelWorkerMutation(
    db: ConvexDatabase,
    reference: Parameters<ConvexDatabase['client']['mutation']>[0],
    args: Record<string, unknown>
): RepositoryResult<ReactionRolePanelWorkerRecord | null> {
    try {
        const value = (await db.client.mutation(reference, args)) as unknown;
        return ok(value ? toPanelWorkerRecord(value as ConvexPanelWorkerRecord) : null);
    } catch {
        return err({ type: 'database-error' });
    }
}

async function memberWorkerQuery(
    db: ConvexDatabase,
    reference: Parameters<ConvexDatabase['client']['query']>[0],
    args: Record<string, unknown>
): RepositoryResult<ReactionRoleMemberWorkerRecord | null> {
    try {
        const value = (await db.client.query(reference, args)) as unknown;
        return ok(value ? toMemberWorkerRecord(value as ConvexMemberWorkerRecord) : null);
    } catch {
        return err({ type: 'database-error' });
    }
}

async function memberWorkerMutation(
    db: ConvexDatabase,
    reference: Parameters<ConvexDatabase['client']['mutation']>[0],
    args: Record<string, unknown>
): RepositoryResult<ReactionRoleMemberWorkerRecord | null> {
    try {
        const value = (await db.client.mutation(reference, args)) as unknown;
        return ok(value ? toMemberWorkerRecord(value as ConvexMemberWorkerRecord) : null);
    } catch {
        return err({ type: 'database-error' });
    }
}
async function booleanMutation(
    db: ConvexDatabase,
    reference: Parameters<ConvexDatabase['client']['mutation']>[0],
    args: Record<string, unknown>
): RepositoryResult<boolean> {
    try {
        return ok((await db.client.mutation(reference, args)) as boolean);
    } catch {
        return err({ type: 'database-error' });
    }
}

function toPanelRecord(record: ConvexPanelRecord): ReactionRolePanelRecord {
    return {
        ...record,
        createdAt: new Date(record.createdAt),
        desiredVersion: toVersionRecord(record.desiredVersion),
        updatedAt: new Date(record.updatedAt),
    };
}

function toOperationRecord(record: ConvexOperationRecord): ReactionRolePanelMutationRecord['operation'] {
    return {
        ...record,
        createdAt: new Date(record.createdAt),
        nextAttemptAt: record.nextAttemptAt ? new Date(record.nextAttemptAt) : null,
        updatedAt: new Date(record.updatedAt),
    };
}

function toPanelWorkerRecord(record: ConvexPanelWorkerRecord): ReactionRolePanelWorkerRecord {
    return {
        ...record,
        createdAt: new Date(record.createdAt),
        leaseExpiresAt: record.leaseExpiresAt ? new Date(record.leaseExpiresAt) : null,
        nextAttemptAt: record.nextAttemptAt ? new Date(record.nextAttemptAt) : null,
        previousVersion: record.previousVersion ? toVersionRecord(record.previousVersion) : null,
        targetVersion: toVersionRecord(record.targetVersion),
        updatedAt: new Date(record.updatedAt),
    };
}

function toMemberWorkerRecord(record: ConvexMemberWorkerRecord): ReactionRoleMemberWorkerRecord {
    return {
        ...record,
        createdAt: new Date(record.createdAt),
        leaseExpiresAt: record.leaseExpiresAt ? new Date(record.leaseExpiresAt) : null,
        nextAttemptAt: record.nextAttemptAt ? new Date(record.nextAttemptAt) : null,
        updatedAt: new Date(record.updatedAt),
    };
}

function toVersionRecord(record: ConvexVersionRecord): ReactionRolePanelRecord['desiredVersion'] {
    return { ...record, createdAt: new Date(record.createdAt) };
}

function dates<T extends Record<string, unknown>>(
    input: T
): { [Key in keyof T]: T[Key] extends Date ? string : T[Key] } {
    return Object.fromEntries(
        Object.entries(input).map(([key, value]) => [key, value instanceof Date ? value.toISOString() : value])
    ) as { [Key in keyof T]: T[Key] extends Date ? string : T[Key] };
}

function mapError(errorValue: unknown): ReactionRoleRepositoryError {
    const message = errorValue instanceof Error ? errorValue.message : String(errorValue);
    if (message.includes('reaction-role-version-conflict')) return { field: 'updatedAt', type: 'conflict' };
    if (message.includes('reaction-role-role-already-managed')) return { field: 'roleId', type: 'conflict' };
    if (message.includes('request-key')) return { field: 'requestKey', type: 'conflict' };
    if (message.includes('-missing')) return { field: 'input', type: 'missing-input' };
    if (message.includes('-invalid') || message.includes('-too-')) {
        return { field: 'input', type: 'invalid-value' };
    }
    if (message.includes('not-found')) return { type: 'not-found' };
    if (message.includes('not-editable') || message.includes('not-deactivatable')) return { type: 'not-runnable' };
    return { type: 'database-error' };
}

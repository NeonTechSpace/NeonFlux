import { api } from '@neonflux/convex-api';
import type { NeonFluxConvexMutationReference } from '@neonflux/convex/client';
import { err, ok, type Result } from 'neverthrow';

import type {
    ReactionRoleAssignmentRecord,
    ReactionRoleMemberReconciliation,
    ReactionRoleMemberStateRecord,
    ReactionRoleMemberTransitionResult,
    ReactionRoleMessageRecord,
    ReactionRoleOptionRecord,
    ReactionRolesRepositoryError,
} from './contracts-reaction-roles.js';
import type { ConvexDatabase } from './convex.js';

type DbResult<Value> = Promise<Result<Value, ReactionRolesRepositoryError>>;
type ConvexMemberState = Omit<
    ReactionRoleMemberStateRecord,
    'createdAt' | 'leaseExpiresAt' | 'nextAttemptAt' | 'updatedAt'
> & {
    createdAt: string;
    leaseExpiresAt: string | null;
    nextAttemptAt: string | null;
    updatedAt: string;
};
type ConvexMessage = Omit<ReactionRoleMessageRecord, 'createdAt' | 'staleAt' | 'updatedAt'> & {
    createdAt: string;
    staleAt: string | null;
    updatedAt: string;
};
type ConvexOption = Omit<ReactionRoleOptionRecord, 'createdAt' | 'updatedAt'> & {
    createdAt: string;
    updatedAt: string;
};
type ConvexAssignment = Omit<ReactionRoleAssignmentRecord, 'assignedAt' | 'removedAt' | 'updatedAt'> & {
    assignedAt: string;
    removedAt: string | null;
    updatedAt: string;
};

export async function requestReactionRoleMemberTransition(
    db: ConvexDatabase,
    input: {
        emojiKey: string;
        eventType: 'added' | 'removed';
        guildId: string;
        messageId: string;
        userId: string;
    }
): DbResult<ReactionRoleMemberTransitionResult> {
    try {
        const result = await db.client.mutation(api.reaction_roles.requestReactionRoleMemberTransition, {
            emojiKey: input.emojiKey.trim(),
            eventType: input.eventType,
            guildId: input.guildId.trim(),
            messageId: input.messageId.trim(),
            userId: input.userId.trim(),
        });
        return ok(
            result.type === 'queued' ? { type: 'queued', state: toMemberState(result.state) } : { type: 'ignored' }
        );
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function claimNextReactionRoleMemberState(
    db: ConvexDatabase,
    input: { leaseExpiresAt: Date; leaseId: string; leaseOwner: string; now: Date }
): DbResult<ReactionRoleMemberStateRecord | null> {
    try {
        const state = await db.client.mutation(api.reaction_roles.claimNextReactionRoleMemberState, {
            leaseExpiresAt: input.leaseExpiresAt.toISOString(),
            leaseId: input.leaseId.trim(),
            leaseOwner: input.leaseOwner.trim(),
            now: input.now.toISOString(),
        });
        return ok(state ? toMemberState(state) : null);
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function loadReactionRoleMemberReconciliation(
    db: ConvexDatabase,
    input: { stateId: string }
): DbResult<ReactionRoleMemberReconciliation | null> {
    try {
        const result = await db.client.query(api.reaction_roles.loadReactionRoleMemberReconciliation, {
            stateId: input.stateId.trim(),
        });
        if (!result) return ok(null);
        return ok({
            assignments: result.assignments.map((assignment) => toAssignment(assignment as ConvexAssignment)),
            message: toMessage(result.message as ConvexMessage),
            options: result.options.map((option) => toOption(option as ConvexOption)),
            state: toMemberState(result.state),
        });
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function completeReactionRoleMemberState(
    db: ConvexDatabase,
    input: { appliedEmojiKeys: string[]; leaseId: string; now: Date; revision: number; stateId: string }
): DbResult<boolean> {
    return mutateBoolean(db, api.reaction_roles.completeReactionRoleMemberState, {
        appliedEmojiKeys: input.appliedEmojiKeys.map((key) => key.trim()).filter(Boolean),
        leaseId: input.leaseId.trim(),
        now: input.now.toISOString(),
        revision: input.revision,
        stateId: input.stateId.trim(),
    });
}

export async function deferReactionRoleMemberState(
    db: ConvexDatabase,
    input: { errorCode: string; leaseId: string; nextAttemptAt: Date; now: Date; stateId: string }
): DbResult<boolean> {
    return mutateBoolean(db, api.reaction_roles.deferReactionRoleMemberState, {
        errorCode: input.errorCode.trim(),
        leaseId: input.leaseId.trim(),
        nextAttemptAt: input.nextAttemptAt.toISOString(),
        now: input.now.toISOString(),
        stateId: input.stateId.trim(),
    });
}

export async function blockReactionRoleMemberState(
    db: ConvexDatabase,
    input: { errorCode: string; leaseId: string; now: Date; stateId: string }
): DbResult<boolean> {
    return mutateBoolean(db, api.reaction_roles.blockReactionRoleMemberState, {
        errorCode: input.errorCode.trim(),
        leaseId: input.leaseId.trim(),
        now: input.now.toISOString(),
        stateId: input.stateId.trim(),
    });
}

export async function hasActiveReactionRoleMemberLease(
    db: ConvexDatabase,
    input: { messageId: string; now: Date }
): DbResult<boolean> {
    try {
        return ok(
            await db.client.query(api.reaction_roles.hasActiveReactionRoleMemberLease, {
                messageId: input.messageId.trim(),
                now: input.now.toISOString(),
            })
        );
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

function toMemberState(record: ConvexMemberState): ReactionRoleMemberStateRecord {
    return {
        ...record,
        createdAt: new Date(record.createdAt),
        leaseExpiresAt: record.leaseExpiresAt ? new Date(record.leaseExpiresAt) : null,
        nextAttemptAt: record.nextAttemptAt ? new Date(record.nextAttemptAt) : null,
        updatedAt: new Date(record.updatedAt),
    };
}

function toMessage(record: ConvexMessage): ReactionRoleMessageRecord {
    return {
        ...record,
        createdAt: new Date(record.createdAt),
        staleAt: record.staleAt ? new Date(record.staleAt) : null,
        updatedAt: new Date(record.updatedAt),
    };
}

function toOption(record: ConvexOption): ReactionRoleOptionRecord {
    return { ...record, createdAt: new Date(record.createdAt), updatedAt: new Date(record.updatedAt) };
}

function toAssignment(record: ConvexAssignment): ReactionRoleAssignmentRecord {
    return {
        ...record,
        assignedAt: new Date(record.assignedAt),
        removedAt: record.removedAt ? new Date(record.removedAt) : null,
        updatedAt: new Date(record.updatedAt),
    };
}

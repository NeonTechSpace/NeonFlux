import { api } from '@neonflux/convex-api';
import type { NeonFluxConvexMutationReference } from '@neonflux/convex/client';
import { err, ok, type Result } from 'neverthrow';

import type { ReactionRolesRepositoryError } from './contracts-reaction-roles.js';
import type { ConvexDatabase } from './convex.js';

type DbResult<Value> = Promise<Result<Value, ReactionRolesRepositoryError>>;
type UserLeaseInput = {
    guildId: string;
    leaseExpiresAt: Date;
    leaseId: string;
    leaseOwner: string;
    now: Date;
    userId: string;
};

export async function acquireReactionRoleUserLease(db: ConvexDatabase, input: UserLeaseInput): DbResult<boolean> {
    return mutateBoolean(db, api.reaction_roles.acquireReactionRoleUserLease, toLeaseArgs(input));
}

export async function renewReactionRoleUserLease(db: ConvexDatabase, input: UserLeaseInput): DbResult<boolean> {
    return mutateBoolean(db, api.reaction_roles.renewReactionRoleUserLease, toLeaseArgs(input));
}

export async function releaseReactionRoleUserLease(
    db: ConvexDatabase,
    input: { guildId: string; leaseId: string; userId: string }
): DbResult<boolean> {
    return mutateBoolean(db, api.reaction_roles.releaseReactionRoleUserLease, {
        guildId: input.guildId.trim(),
        leaseId: input.leaseId.trim(),
        userId: input.userId.trim(),
    });
}

export async function hasOtherActiveReactionRoleAssignment(
    db: ConvexDatabase,
    input: { assignmentId: string; guildId: string; roleId: string; userId: string }
): DbResult<boolean> {
    try {
        return ok(
            await db.client.query(api.reaction_roles.hasOtherActiveReactionRoleAssignment, {
                assignmentId: input.assignmentId.trim(),
                guildId: input.guildId.trim(),
                roleId: input.roleId.trim(),
                userId: input.userId.trim(),
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

function toLeaseArgs(input: UserLeaseInput) {
    return {
        guildId: input.guildId.trim(),
        leaseExpiresAt: input.leaseExpiresAt.toISOString(),
        leaseId: input.leaseId.trim(),
        leaseOwner: input.leaseOwner.trim(),
        now: input.now.toISOString(),
        userId: input.userId.trim(),
    };
}

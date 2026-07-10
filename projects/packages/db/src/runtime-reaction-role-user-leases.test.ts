import { describe, expect, it } from 'vitest';

import type { ConvexDatabase } from './convex.js';
import {
    acquireReactionRoleUserLease,
    hasOtherActiveReactionRoleAssignment,
    releaseReactionRoleUserLease,
    renewReactionRoleUserLease,
} from './runtime-reaction-role-user-leases.js';

describe('reaction-role guild-user lease adapters', () => {
    it('normalizes lease fencing and shared-ownership lookups', async () => {
        const db = createConvexDb({ mutationResults: [true, true, true], queryResults: [true] });
        const now = new Date('2026-07-10T08:00:00.000Z');
        const leaseExpiresAt = new Date('2026-07-10T08:15:00.000Z');
        const lease = {
            guildId: ' guild-1 ',
            leaseExpiresAt,
            leaseId: ' lease-1 ',
            leaseOwner: ' worker-1 ',
            now,
            userId: ' user-1 ',
        };

        expect((await acquireReactionRoleUserLease(db, lease))._unsafeUnwrap()).toBe(true);
        expect((await renewReactionRoleUserLease(db, lease))._unsafeUnwrap()).toBe(true);
        expect(
            (
                await hasOtherActiveReactionRoleAssignment(db, {
                    assignmentId: ' assignment-1 ',
                    guildId: ' guild-1 ',
                    roleId: ' role-1 ',
                    userId: ' user-1 ',
                })
            )._unsafeUnwrap()
        ).toBe(true);
        expect(
            (
                await releaseReactionRoleUserLease(db, {
                    guildId: ' guild-1 ',
                    leaseId: ' lease-1 ',
                    userId: ' user-1 ',
                })
            )._unsafeUnwrap()
        ).toBe(true);
        expect(db.client.mutationCalls[0]?.args).toStrictEqual({
            guildId: 'guild-1',
            leaseExpiresAt: leaseExpiresAt.toISOString(),
            leaseId: 'lease-1',
            leaseOwner: 'worker-1',
            now: now.toISOString(),
            userId: 'user-1',
        });
        expect(db.client.queryCalls[0]?.args).toStrictEqual({
            assignmentId: 'assignment-1',
            guildId: 'guild-1',
            roleId: 'role-1',
            userId: 'user-1',
        });
    });
});

function createConvexDb(input: { mutationResults: unknown[]; queryResults: unknown[] }): ConvexDatabase & {
    client: {
        mutationCalls: Array<{ args: unknown; reference: unknown }>;
        queryCalls: Array<{ args: unknown; reference: unknown }>;
    };
} {
    const mutationResults = [...input.mutationResults];
    const queryResults = [...input.queryResults];
    const client = {
        mutationCalls: [] as Array<{ args: unknown; reference: unknown }>,
        queryCalls: [] as Array<{ args: unknown; reference: unknown }>,
        mutation(reference: unknown, args: unknown) {
            this.mutationCalls.push({ args, reference });
            return Promise.resolve(mutationResults.shift());
        },
        query(reference: unknown, args: unknown) {
            this.queryCalls.push({ args, reference });
            return Promise.resolve(queryResults.shift());
        },
    };
    return {
        client: client as unknown as ConvexDatabase['client'] & typeof client,
        kind: 'convex',
        serviceName: 'bot',
    };
}

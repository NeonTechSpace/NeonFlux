import { describe, expect, it } from 'vitest';

import type { ConvexDatabase } from './convex.js';
import {
    authorizeReactionRoleMemberEffect,
    claimNextReactionRoleMemberOperation,
    claimNextReactionRolePanelOperation,
    publishReactionRolePanel,
} from './runtime-reaction-roles.js';

describe('reaction-role Convex runtime boundary', () => {
    it('serializes every lease Date before calling Convex', async () => {
        const db = createConvexDb({ mutationResults: [null, null, 'authorized'] });
        const now = new Date('2026-07-28T09:00:00.000Z');
        const leaseExpiresAt = new Date('2026-07-28T09:01:00.000Z');

        await claimNextReactionRolePanelOperation(db, {
            leaseExpiresAt,
            leaseId: 'panel-lease',
            leaseOwner: 'worker-1',
            now,
        });
        await claimNextReactionRoleMemberOperation(db, {
            leaseExpiresAt,
            leaseId: 'member-lease',
            leaseOwner: 'worker-1',
            now,
        });
        await authorizeReactionRoleMemberEffect(db, {
            leaseExpiresAt,
            leaseId: 'member-lease',
            now,
            operationId: 'member-operation-1',
            panelGeneration: 4,
            revision: 2,
        });

        expect(db.client.mutationCalls.map((call) => call.args)).toStrictEqual([
            {
                leaseExpiresAt: leaseExpiresAt.toISOString(),
                leaseId: 'panel-lease',
                leaseOwner: 'worker-1',
                now: now.toISOString(),
            },
            {
                leaseExpiresAt: leaseExpiresAt.toISOString(),
                leaseId: 'member-lease',
                leaseOwner: 'worker-1',
                now: now.toISOString(),
            },
            {
                leaseExpiresAt: leaseExpiresAt.toISOString(),
                leaseId: 'member-lease',
                now: now.toISOString(),
                operationId: 'member-operation-1',
                panelGeneration: 4,
                revision: 2,
            },
        ]);
    });

    it('preserves a safe role ownership conflict across the repository boundary', async () => {
        const db = createConvexDb({
            mutationErrors: [new Error('Uncaught Error: reaction-role-role-already-managed')],
        });
        const result = await publishReactionRolePanel(db, {
            actorUserId: 'user-1',
            channelId: 'channel-1',
            guildId: 'guild-1',
            name: 'Roles',
            payload: {
                content: '{roles}',
                embeds: [],
                mode: 'independent',
                options: [
                    {
                        emoji: { kind: 'unicode', value: '✨' },
                        id: 'option-1',
                        roleId: 'role-1',
                        roleName: 'Updates',
                    },
                ],
            },
            requestKey: 'request-1',
        });

        expect(result._unsafeUnwrapErr()).toStrictEqual({ field: 'roleId', type: 'conflict' });
    });
});

function createConvexDb(input: { mutationErrors?: Error[]; mutationResults?: unknown[] }): ConvexDatabase & {
    client: {
        mutationCalls: Array<{ args: unknown; reference: unknown }>;
    };
} {
    const mutationErrors = [...(input.mutationErrors ?? [])];
    const mutationResults = [...(input.mutationResults ?? [])];
    const client = {
        mutationCalls: [] as Array<{ args: unknown; reference: unknown }>,
        mutation(reference: unknown, args: unknown): Promise<unknown> {
            this.mutationCalls.push({ args, reference });
            const error = mutationErrors.shift();
            return error ? Promise.reject(error) : Promise.resolve(mutationResults.shift());
        },
        query(): Promise<unknown> {
            return Promise.resolve(null);
        },
    };
    return {
        client: client as unknown as ConvexDatabase['client'] & typeof client,
        kind: 'convex',
        serviceName: 'bot',
    };
}

import { describe, expect, it } from 'vitest';

import type { ConvexPersistenceDatabase } from './convex.js';
import {
    deleteGuildCommandPermissionRule,
    findGuildCommandPermissionRule,
    findGuildDashboardPermissionRule,
    listGuildCommandPermissionRulesByGuildId,
    listGuildDashboardPermissionRulesByGuildIds,
    upsertGuildCommandPermissionRule,
    upsertGuildDashboardPermissionRule,
} from './runtime-access.js';

const commandRule = {
    createdAt: '2026-07-03T08:00:00.000Z',
    guildId: 'guild-1',
    id: 'rule-1',
    roleIds: ['role-1'],
    targetId: 'settings',
    targetType: 'category' as const,
    updatedAt: '2026-07-03T09:00:00.000Z',
    userIds: ['user-1'],
};
const dashboardRule = {
    createdAt: '2026-07-03T08:00:00.000Z',
    guildId: 'guild-1',
    roleIds: ['role-1'],
    updatedAt: '2026-07-03T09:00:00.000Z',
    userIds: ['user-1'],
};

describe('Convex access permission persistence wrappers', () => {
    it('upserts, finds, lists, and deletes command permission rules through Convex', async () => {
        const db = createConvexDb({
            mutationResults: [commandRule, null],
            queryResults: [commandRule, [commandRule]],
        });

        const upserted = await upsertGuildCommandPermissionRule(db, {
            guildId: 'guild-1',
            roleIds: ['role-1'],
            targetId: 'settings',
            targetType: 'category',
            userIds: ['user-1'],
        });
        const found = await findGuildCommandPermissionRule(db, {
            guildId: 'guild-1',
            targetId: 'settings',
            targetType: 'category',
        });
        const listed = await listGuildCommandPermissionRulesByGuildId(db, { guildId: 'guild-1' });
        const deleted = await deleteGuildCommandPermissionRule(db, {
            guildId: 'guild-1',
            targetId: 'settings',
            targetType: 'category',
        });

        expect(upserted._unsafeUnwrap()).toStrictEqual(toCommandRecord());
        expect(found._unsafeUnwrap()).toStrictEqual(toCommandRecord());
        expect(listed._unsafeUnwrap()).toStrictEqual([toCommandRecord()]);
        expect(deleted._unsafeUnwrapErr()).toBe('not-found');
        expect(db.client.queryCalls.at(-1)?.args).toStrictEqual({
            guildId: 'guild-1',
            limit: 1000,
        });
    });

    it('maps command permission validation failures to repository errors', async () => {
        const db = createConvexDb({
            mutationErrors: [new Error('missing-target-id')],
        });

        const result = await upsertGuildCommandPermissionRule(db, {
            guildId: 'guild-1',
            targetId: ' ',
            targetType: 'category',
        });

        expect(result._unsafeUnwrapErr()).toBe('missing-target-id');
    });

    it('upserts, finds, and lists dashboard permission rules through Convex', async () => {
        const db = createConvexDb({
            mutationResults: [dashboardRule],
            queryResults: [dashboardRule, [dashboardRule]],
        });

        const upserted = await upsertGuildDashboardPermissionRule(db, {
            guildId: 'guild-1',
            roleIds: ['role-1'],
            userIds: ['user-1'],
        });
        const found = await findGuildDashboardPermissionRule(db, { guildId: 'guild-1' });
        const listed = await listGuildDashboardPermissionRulesByGuildIds(db, { guildIds: ['guild-1'] });

        expect(upserted._unsafeUnwrap()).toStrictEqual(toDashboardRecord());
        expect(found._unsafeUnwrap()).toStrictEqual(toDashboardRecord());
        expect(listed._unsafeUnwrap()).toStrictEqual([toDashboardRecord()]);
        expect(db.client.queryCalls.at(-1)?.args).toStrictEqual({
            guildIds: ['guild-1'],
        });
    });

    it('maps missing dashboard permission rules and invalid guild input', async () => {
        const db = createConvexDb({
            mutationErrors: [new Error('missing-guild-id')],
            queryResults: [null],
        });

        const missing = await findGuildDashboardPermissionRule(db, { guildId: 'guild-1' });
        const invalid = await upsertGuildDashboardPermissionRule(db, { guildId: ' ' });

        expect(missing._unsafeUnwrapErr()).toBe('not-found');
        expect(invalid._unsafeUnwrapErr()).toBe('missing-guild-id');
    });
});

function toCommandRecord() {
    return {
        createdAt: new Date(commandRule.createdAt),
        guildId: commandRule.guildId,
        roleIds: commandRule.roleIds,
        targetId: commandRule.targetId,
        targetType: commandRule.targetType,
        updatedAt: new Date(commandRule.updatedAt),
        userIds: commandRule.userIds,
    };
}

function toDashboardRecord() {
    return {
        createdAt: new Date(dashboardRule.createdAt),
        guildId: dashboardRule.guildId,
        roleIds: dashboardRule.roleIds,
        updatedAt: new Date(dashboardRule.updatedAt),
        userIds: dashboardRule.userIds,
    };
}

function createConvexDb(input: {
    mutationErrors?: Error[];
    mutationResults?: unknown[];
    queryErrors?: Error[];
    queryResults?: unknown[];
}): ConvexPersistenceDatabase & {
    client: {
        mutationCalls: Array<{ args: unknown; reference: unknown }>;
        queryCalls: Array<{ args: unknown; reference: unknown }>;
    };
} {
    const mutationErrors = [...(input.mutationErrors ?? [])];
    const mutationResults = [...(input.mutationResults ?? [])];
    const queryErrors = [...(input.queryErrors ?? [])];
    const queryResults = [...(input.queryResults ?? [])];
    const client = {
        mutationCalls: [] as Array<{ args: unknown; reference: unknown }>,
        queryCalls: [] as Array<{ args: unknown; reference: unknown }>,
        async mutation(reference: unknown, args: unknown): Promise<unknown> {
            this.mutationCalls.push({ args, reference });
            const error = mutationErrors.shift();

            if (error) throw error;

            return mutationResults.shift();
        },
        async query(reference: unknown, args: unknown): Promise<unknown> {
            this.queryCalls.push({ args, reference });
            const error = queryErrors.shift();

            if (error) throw error;

            return queryResults.shift();
        },
    };

    return {
        client: client as unknown as ConvexPersistenceDatabase['client'] & typeof client,
        kind: 'convex',
        serviceName: 'web',
    };
}

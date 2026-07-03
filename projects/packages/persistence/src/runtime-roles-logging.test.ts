import { describe, expect, it } from 'vitest';

import type { ConvexPersistenceDatabase } from './convex.js';
import {
    deleteAutoroleRule,
    deleteGuildLoggingDestination,
    findGuildLoggingDestinationByEventGroup,
    listAutoroleRulesByGuildId,
    listEnabledAutoroleRulesByGuildId,
    listGuildLoggingDestinationsByGuildId,
    upsertAutoroleRule,
    upsertGuildLoggingDestination,
} from './runtime-roles-logging.js';

const autoroleRule = {
    createdAt: '2026-07-03T08:00:00.000Z',
    enabled: true,
    guildId: 'guild-1',
    id: 'autorole-1',
    name: 'Members',
    roleId: 'role-1',
    updatedAt: '2026-07-03T09:00:00.000Z',
};
const loggingDestination = {
    channelId: 'channel-1',
    createdAt: '2026-07-03T08:00:00.000Z',
    enabled: true,
    eventGroup: 'messages' as const,
    guildId: 'guild-1',
    id: 'logging-1',
    updatedAt: '2026-07-03T09:00:00.000Z',
};

describe('Convex autorole and logging persistence wrappers', () => {
    it('upserts, lists, and deletes autorole rules through Convex', async () => {
        const db = createConvexDb({
            mutationResults: [autoroleRule, null],
            queryResults: [[autoroleRule], [autoroleRule]],
        });

        const upserted = await upsertAutoroleRule(db, {
            enabled: true,
            guildId: ' guild-1 ',
            name: ' Members ',
            roleId: ' role-1 ',
        });
        const all = await listAutoroleRulesByGuildId(db, { guildId: 'guild-1' });
        const enabled = await listEnabledAutoroleRulesByGuildId(db, { guildId: 'guild-1' });
        const deleted = await deleteAutoroleRule(db, { guildId: 'guild-1', roleId: 'role-1' });

        expect(upserted._unsafeUnwrap()).toStrictEqual(toAutoroleRecord(autoroleRule));
        expect(all._unsafeUnwrap()).toStrictEqual([toAutoroleRecord(autoroleRule)]);
        expect(enabled._unsafeUnwrap()).toStrictEqual([toAutoroleRecord(autoroleRule)]);
        expect(deleted._unsafeUnwrapErr()).toStrictEqual({ type: 'not-found' });
        expect(db.client.mutationCalls[0]?.args).toStrictEqual({
            enabled: true,
            guildId: 'guild-1',
            name: 'Members',
            roleId: 'role-1',
        });
        expect(db.client.queryCalls[0]?.args).toStrictEqual({
            guildId: 'guild-1',
            limit: 1000,
        });
    });

    it('maps autorole validation failures before calling Convex', async () => {
        const db = createConvexDb({});

        const missingGuild = await upsertAutoroleRule(db, { guildId: ' ', roleId: 'role-1' });
        const missingRole = await deleteAutoroleRule(db, { guildId: 'guild-1', roleId: ' ' });
        const missingListGuild = await listAutoroleRulesByGuildId(db, { guildId: ' ' });

        expect(missingGuild._unsafeUnwrapErr()).toStrictEqual({ field: 'guildId', type: 'missing-input' });
        expect(missingRole._unsafeUnwrapErr()).toStrictEqual({ field: 'roleId', type: 'missing-input' });
        expect(missingListGuild._unsafeUnwrapErr()).toStrictEqual({ field: 'guildId', type: 'missing-input' });
        expect(db.client.mutationCalls).toHaveLength(0);
        expect(db.client.queryCalls).toHaveLength(0);
    });

    it('lists, finds, upserts, and deletes logging destinations through Convex', async () => {
        const db = createConvexDb({
            mutationResults: [loggingDestination, null],
            queryResults: [[loggingDestination], loggingDestination],
        });

        const listed = await listGuildLoggingDestinationsByGuildId(db, { enabled: true, guildId: 'guild-1' });
        const found = await findGuildLoggingDestinationByEventGroup(db, {
            eventGroup: 'messages',
            guildId: 'guild-1',
        });
        const upserted = await upsertGuildLoggingDestination(db, {
            channelId: ' channel-1 ',
            enabled: true,
            eventGroup: 'messages',
            guildId: ' guild-1 ',
        });
        const deleted = await deleteGuildLoggingDestination(db, {
            eventGroup: 'messages',
            guildId: 'guild-1',
        });

        expect(listed._unsafeUnwrap()).toStrictEqual([toLoggingRecord(loggingDestination)]);
        expect(found._unsafeUnwrap()).toStrictEqual(toLoggingRecord(loggingDestination));
        expect(upserted._unsafeUnwrap()).toStrictEqual(toLoggingRecord(loggingDestination));
        expect(deleted._unsafeUnwrapErr()).toStrictEqual({ type: 'not-found' });
        expect(db.client.mutationCalls[0]?.args).toStrictEqual({
            channelId: 'channel-1',
            enabled: true,
            eventGroup: 'messages',
            guildId: 'guild-1',
        });
    });

    it('maps logging destination validation failures before calling Convex', async () => {
        const db = createConvexDb({});

        const missingGuild = await listGuildLoggingDestinationsByGuildId(db, { guildId: ' ' });
        const invalidGroup = await findGuildLoggingDestinationByEventGroup(db, {
            eventGroup: 'unknown',
            guildId: 'guild-1',
        });
        const missingChannel = await upsertGuildLoggingDestination(db, {
            channelId: ' ',
            eventGroup: 'messages',
            guildId: 'guild-1',
        });

        expect(missingGuild._unsafeUnwrapErr()).toStrictEqual({ field: 'guildId', type: 'missing-input' });
        expect(invalidGroup._unsafeUnwrapErr()).toStrictEqual({ field: 'eventGroup', type: 'invalid-value' });
        expect(missingChannel._unsafeUnwrapErr()).toStrictEqual({ field: 'channelId', type: 'missing-input' });
        expect(db.client.mutationCalls).toHaveLength(0);
        expect(db.client.queryCalls).toHaveLength(0);
    });
});

function toAutoroleRecord(record: typeof autoroleRule) {
    return {
        createdAt: new Date(record.createdAt),
        enabled: record.enabled,
        guildId: record.guildId,
        id: record.id,
        name: record.name,
        roleId: record.roleId,
        updatedAt: new Date(record.updatedAt),
    };
}

function toLoggingRecord(record: typeof loggingDestination) {
    return {
        channelId: record.channelId,
        createdAt: new Date(record.createdAt),
        enabled: record.enabled,
        eventGroup: record.eventGroup,
        guildId: record.guildId,
        id: record.id,
        updatedAt: new Date(record.updatedAt),
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

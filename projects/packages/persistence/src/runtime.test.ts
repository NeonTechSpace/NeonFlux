import { describe, expect, it } from 'vitest';

import type { ConvexPersistenceDatabase } from './convex.js';
import {
    deleteBotInstallation,
    findDeploymentConfig,
    listBotActionEventPageByGuildId,
    listBotInstallationGuildIds,
    listGuildSecurityPoliciesByGuildIds,
    recordBotActionEvent,
    upsertBotInstallation,
    upsertDeploymentConfig,
} from './runtime.js';

describe('Convex persistence runtime wrappers', () => {
    it('reads deployment config through Convex and maps missing config to not-found', async () => {
        const db = createConvexDb({
            queryResults: [
                {
                    instanceMode: 'single',
                    ownerIds: ['owner-1'],
                    publicWebUrl: null,
                    singleGuildId: 'guild-1',
                },
                null,
            ],
        });

        await expect(findDeploymentConfig(db)).resolves.toMatchObject({
            value: {
                instanceMode: 'single',
                ownerIds: ['owner-1'],
                publicWebUrl: null,
                singleGuildId: 'guild-1',
            },
        });
        await expect(findDeploymentConfig(db)).resolves.toMatchObject({
            error: 'not-found',
        });
    });

    it('upserts deployment config through Convex with Postgres-compatible validation', async () => {
        const db = createConvexDb({
            mutationResults: [
                {
                    instanceMode: 'single',
                    ownerIds: ['owner-1'],
                    publicWebUrl: 'https://neonflux.example',
                    singleGuildId: 'guild-1',
                },
            ],
        });

        const result = await upsertDeploymentConfig(db, {
            instanceMode: ' single ',
            ownerIds: [' owner-1 ', ' '],
            publicWebUrl: ' https://neonflux.example ',
            singleGuildId: ' guild-1 ',
        });
        const missingMode = await upsertDeploymentConfig(db, { instanceMode: ' ' });
        const missingSingleGuild = await upsertDeploymentConfig(db, { instanceMode: 'single' });
        const invalidMode = await upsertDeploymentConfig(db, { instanceMode: 'invalid' });

        expect(result._unsafeUnwrap()).toStrictEqual({
            instanceMode: 'single',
            ownerIds: ['owner-1'],
            publicWebUrl: 'https://neonflux.example',
            singleGuildId: 'guild-1',
        });
        expect(db.client.mutationCalls[0]?.args).toStrictEqual({
            instanceMode: 'single',
            ownerIds: ['owner-1'],
            publicWebUrl: 'https://neonflux.example',
            singleGuildId: 'guild-1',
        });
        expect(missingMode._unsafeUnwrapErr()).toBe('missing-instance-mode');
        expect(missingSingleGuild._unsafeUnwrapErr()).toBe('missing-single-guild-id');
        expect(invalidMode._unsafeUnwrapErr()).toBe('invalid-instance-mode');
        expect(db.client.mutationCalls).toHaveLength(1);
    });

    it('pages bot installation IDs and converts installation timestamps', async () => {
        const db = createConvexDb({
            mutationResults: [
                {
                    guildId: 'guild-1',
                    installedAt: '2026-07-03T08:00:00.000Z',
                    updatedAt: '2026-07-03T09:00:00.000Z',
                },
                null,
            ],
            queryResults: [{ guildIds: ['guild-1'], nextCursor: 'guild-1' }, { guildIds: ['guild-2'] }],
        });

        const upserted = await upsertBotInstallation(db, { guildId: 'guild-1' });
        const guildIds = await listBotInstallationGuildIds(db);
        const deleted = await deleteBotInstallation(db, { guildId: 'guild-1' });

        expect(upserted._unsafeUnwrap()).toStrictEqual({
            guildId: 'guild-1',
            installedAt: new Date('2026-07-03T08:00:00.000Z'),
            updatedAt: new Date('2026-07-03T09:00:00.000Z'),
        });
        expect(guildIds._unsafeUnwrap()).toStrictEqual(['guild-1', 'guild-2']);
        expect(db.client.queryCalls.map((call) => call.args)).toContainEqual({ limit: 500 });
        expect(db.client.queryCalls.map((call) => call.args)).toContainEqual({
            afterGuildId: 'guild-1',
            limit: 500,
        });
        expect(deleted._unsafeUnwrapErr()).toBe('not-found');
    });

    it('lists security policies through Convex with Date records', async () => {
        const db = createConvexDb({
            queryResults: [
                [
                    {
                        createdAt: '2026-07-03T08:00:00.000Z',
                        defconLevel: 2,
                        guildId: 'guild-1',
                        updatedAt: '2026-07-03T09:00:00.000Z',
                    },
                ],
            ],
        });

        const result = await listGuildSecurityPoliciesByGuildIds(db, { guildIds: ['guild-1'] });

        expect(result._unsafeUnwrap()).toStrictEqual([
            {
                createdAt: new Date('2026-07-03T08:00:00.000Z'),
                defconLevel: 2,
                guildId: 'guild-1',
                updatedAt: new Date('2026-07-03T09:00:00.000Z'),
            },
        ]);
    });

    it('records and pages bot action events through Convex with Date records', async () => {
        const db = createConvexDb({
            mutationResults: [
                {
                    action: 'message.sent',
                    actorUserId: 'user-1',
                    createdAt: '2026-07-03T08:00:00.000Z',
                    feature: 'posting',
                    guildId: 'guild-1',
                    id: 'event-1',
                    metadata: { channelId: 'channel-1' },
                    targetId: 'message-1',
                },
            ],
            queryResults: [
                {
                    nextCursor: {
                        createdAt: '2026-07-03T07:00:00.000Z',
                        id: 'event-0',
                    },
                    records: [
                        {
                            action: 'message.sent',
                            actorUserId: null,
                            createdAt: '2026-07-03T07:00:00.000Z',
                            feature: 'posting',
                            guildId: 'guild-1',
                            id: 'event-0',
                            metadata: {},
                            targetId: null,
                        },
                    ],
                },
            ],
        });

        const recorded = await recordBotActionEvent(db, {
            action: 'message.sent',
            actorUserId: 'user-1',
            feature: 'posting',
            guildId: 'guild-1',
            metadata: { channelId: 'channel-1' },
            targetId: 'message-1',
        });
        const page = await listBotActionEventPageByGuildId(db, {
            cursor: {
                createdAt: new Date('2026-07-03T08:00:00.000Z'),
                id: 'event-1',
            },
            guildId: 'guild-1',
            search: 'channel-1',
            searchScope: 'channel',
        });

        expect(recorded._unsafeUnwrap()).toStrictEqual({
            action: 'message.sent',
            actorUserId: 'user-1',
            createdAt: new Date('2026-07-03T08:00:00.000Z'),
            feature: 'posting',
            guildId: 'guild-1',
            id: 'event-1',
            metadata: { channelId: 'channel-1' },
            targetId: 'message-1',
        });
        expect(page._unsafeUnwrap()).toStrictEqual({
            nextCursor: {
                createdAt: new Date('2026-07-03T07:00:00.000Z'),
                id: 'event-0',
            },
            records: [
                {
                    action: 'message.sent',
                    actorUserId: null,
                    createdAt: new Date('2026-07-03T07:00:00.000Z'),
                    feature: 'posting',
                    guildId: 'guild-1',
                    id: 'event-0',
                    metadata: {},
                    targetId: null,
                },
            ],
        });
        expect(db.client.queryCalls.at(-1)?.args).toMatchObject({
            cursor: {
                createdAt: '2026-07-03T08:00:00.000Z',
                id: 'event-1',
            },
            guildId: 'guild-1',
            search: 'channel-1',
            searchScope: 'channel',
        });
    });
});

function createConvexDb(input: { mutationResults?: unknown[]; queryResults?: unknown[] }): ConvexPersistenceDatabase & {
    client: {
        mutationCalls: Array<{ args: unknown; reference: unknown }>;
        queryCalls: Array<{ args: unknown; reference: unknown }>;
    };
} {
    const mutationResults = [...(input.mutationResults ?? [])];
    const queryResults = [...(input.queryResults ?? [])];
    const client = {
        mutationCalls: [] as Array<{ args: unknown; reference: unknown }>,
        queryCalls: [] as Array<{ args: unknown; reference: unknown }>,
        async mutation(reference: unknown, args: unknown): Promise<unknown> {
            this.mutationCalls.push({ args, reference });
            return mutationResults.shift();
        },
        async query(reference: unknown, args: unknown): Promise<unknown> {
            this.queryCalls.push({ args, reference });
            return queryResults.shift();
        },
    };

    return {
        client: client as unknown as ConvexPersistenceDatabase['client'] & typeof client,
        kind: 'convex',
        serviceName: 'web',
    };
}

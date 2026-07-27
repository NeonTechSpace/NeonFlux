import { describe, expect, it } from 'vitest';

import type { ConvexDatabase } from './convex.js';
import {
    deleteBotInstallation,
    findDeploymentConfig,
    listBotActionEventPageByGuildId,
    listBotInstallationGuildIds,
    listGuildSecurityPoliciesByGuildIds,
    readDashboardGuildAuthorizationFacts,
    upsertBotInstallation,
    upsertDeploymentConfig,
} from './runtime.js';

describe('Convex database runtime wrappers', () => {
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

    it('reads minimal dashboard guild authorization facts through one target query', async () => {
        const db = createConvexDb({
            queryResults: [
                {
                    botInstalled: true,
                    deployment: { instanceMode: 'single', singleGuildId: 'guild-1' },
                    storedDefconLevel: 2,
                },
                {
                    botInstalled: 'yes',
                    deployment: { instanceMode: 'multi' },
                    storedDefconLevel: null,
                },
            ],
        });

        const result = await readDashboardGuildAuthorizationFacts(db, { guildId: ' guild-1 ' });
        const malformed = await readDashboardGuildAuthorizationFacts(db, { guildId: 'guild-1' });
        const missingGuildId = await readDashboardGuildAuthorizationFacts(db, { guildId: '   ' });

        expect(result._unsafeUnwrap()).toStrictEqual({
            botInstalled: true,
            deployment: { instanceMode: 'single', singleGuildId: 'guild-1' },
            storedDefconLevel: 2,
        });
        expect(db.client.queryCalls[0]?.args).toStrictEqual({ guildId: 'guild-1' });
        expect(malformed._unsafeUnwrapErr()).toBe('database-error');
        expect(missingGuildId._unsafeUnwrapErr()).toBe('missing-guild-id');
        expect(db.client.queryCalls).toHaveLength(2);
    });

    it('upserts deployment config through Convex with app-facing validation', async () => {
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

    it('pages bot action events through Convex with Date records', async () => {
        const db = createConvexDb({
            queryResults: [
                {
                    nextCursor: 'opaque-next-cursor',
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

        const page = await listBotActionEventPageByGuildId(db, {
            cursor: 'opaque-cursor',
            guildId: 'guild-1',
            search: 'channel-1',
            searchScope: 'channel',
        });

        expect(page._unsafeUnwrap()).toStrictEqual({
            nextCursor: 'opaque-next-cursor',
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
            cursor: 'opaque-cursor',
            guildId: 'guild-1',
            search: 'channel-1',
            searchScope: 'channel',
        });
    });
});

function createConvexDb(input: { mutationResults?: unknown[]; queryResults?: unknown[] }): ConvexDatabase & {
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
        mutation(reference: unknown, args: unknown): Promise<unknown> {
            this.mutationCalls.push({ args, reference });
            return Promise.resolve(mutationResults.shift());
        },
        query(reference: unknown, args: unknown): Promise<unknown> {
            this.queryCalls.push({ args, reference });
            return Promise.resolve(queryResults.shift());
        },
    };

    return {
        client: client as unknown as ConvexDatabase['client'] & typeof client,
        kind: 'convex',
        serviceName: 'web',
    };
}

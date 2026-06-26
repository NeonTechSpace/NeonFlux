import { randomUUID } from 'node:crypto';
import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
    incrementGuildMessageActivityDay,
    listGuildInviteSnapshots,
    loadGuildOverviewAggregate,
    recordGuildMemberFlowEvent,
    syncGuildInviteSnapshots,
} from './growth-overview.js';
import { upsertGuild } from './guilds.js';
import * as schema from './schema.js';

const projectRoot = fileURLToPath(new URL('../../..', import.meta.url));
const migrationsFolder = join(projectRoot, 'packages', 'db', 'drizzle');
const testDataRoot = join(projectRoot, 'data', 'pglite-growth-overview-test');

let testDatabase: TestDatabase | undefined;

describe('growth overview repositories', () => {
    beforeEach(async () => {
        testDatabase = await createTestDatabase();
        await expectOk(upsertGuild(getDb(), { guildId: 'guild-1' }));
    });

    afterEach(async () => {
        await testDatabase?.close();
        testDatabase = undefined;
    });

    it('returns safe empty aggregates before tracking data exists', async () => {
        const aggregate = await expectOk(
            loadGuildOverviewAggregate(getDb(), {
                guildId: 'guild-1',
                now: new Date('2026-06-26T12:00:00.000Z'),
            })
        );

        expect(aggregate.trackingStartedAt).toBeUndefined();
        expect(aggregate.memberFlow.totalJoins).toBe(0);
        expect(aggregate.memberFlow.totalLeaves).toBe(0);
        expect(aggregate.memberFlow.graph).toHaveLength(30);
        expect(aggregate.memberFlow.graph.at(0)).toMatchObject({ date: '2026-05-28', joins: 0, leaves: 0 });
        expect(aggregate.invites.topInviters).toStrictEqual([]);
        expect(aggregate.messages.totalMessages).toBe(0);
        expect(aggregate.messages.graph).toHaveLength(30);
        expect(aggregate.messages.graph.at(0)).toStrictEqual({
            date: '2026-05-28',
            messageCount: 0,
        });
        expect(aggregate.dataHealth).toStrictEqual({
            hasMemberFlow: false,
            hasInviteSnapshots: false,
            hasMessageActivity: false,
        });
    });

    it('records join and leave events into the 30-day flow graph', async () => {
        await expectOk(
            recordGuildMemberFlowEvent(getDb(), {
                guildId: 'guild-1',
                userId: 'user-1',
                eventType: 'join',
                attributionStatus: 'unavailable',
                occurredAt: new Date('2026-06-25T12:00:00.000Z'),
            })
        );
        await expectOk(
            recordGuildMemberFlowEvent(getDb(), {
                guildId: 'guild-1',
                userId: 'user-1',
                eventType: 'leave',
                occurredAt: new Date('2026-06-26T12:00:00.000Z'),
            })
        );

        const aggregate = await expectOk(
            loadGuildOverviewAggregate(getDb(), {
                guildId: 'guild-1',
                now: new Date('2026-06-26T12:00:00.000Z'),
            })
        );

        expect(aggregate.memberFlow).toMatchObject({
            totalJoins: 1,
            totalLeaves: 1,
            netGrowth: 0,
        });
        expect(aggregate.memberFlow.graph.slice(-2)).toStrictEqual([
            { date: '2026-06-25', joins: 1, leaves: 0, netGrowth: 1 },
            { date: '2026-06-26', joins: 0, leaves: 1, netGrowth: -1 },
        ]);
        expect(aggregate.dataHealth.hasMemberFlow).toBe(true);
    });

    it('upserts invite snapshots and marks missing active invites as revoked', async () => {
        await expectOk(
            syncGuildInviteSnapshots(getDb(), {
                guildId: 'guild-1',
                observedAt: new Date('2026-06-25T12:00:00.000Z'),
                invites: [
                    {
                        code: 'alpha',
                        inviterUserId: 'inviter-1',
                        channelId: 'channel-1',
                        uses: 2,
                        maxUses: 10,
                        temporary: false,
                    },
                    {
                        code: 'beta',
                        inviterUserId: 'inviter-2',
                        channelId: 'channel-2',
                        uses: 1,
                    },
                ],
            })
        );

        await expectOk(
            syncGuildInviteSnapshots(getDb(), {
                guildId: 'guild-1',
                observedAt: new Date('2026-06-26T12:00:00.000Z'),
                invites: [
                    {
                        code: 'alpha',
                        inviterUserId: 'inviter-1',
                        channelId: 'channel-1',
                        uses: 3,
                    },
                ],
            })
        );

        const snapshots = await expectOk(listGuildInviteSnapshots(getDb(), { guildId: 'guild-1' }));

        expect(snapshots).toHaveLength(2);
        expect(snapshots.find((snapshot) => snapshot.code === 'alpha')).toMatchObject({
            uses: 3,
            active: true,
            revokedAt: null,
        });
        expect(snapshots.find((snapshot) => snapshot.code === 'beta')).toMatchObject({
            uses: 1,
            active: false,
            revokedAt: new Date('2026-06-26T12:00:00.000Z'),
        });
    });

    it('increments message activity by guild, channel, and UTC day', async () => {
        await expectOk(
            incrementGuildMessageActivityDay(getDb(), {
                guildId: 'guild-1',
                channelId: 'channel-1',
                occurredAt: new Date('2026-06-26T10:00:00.000Z'),
            })
        );
        const secondIncrement = await expectOk(
            incrementGuildMessageActivityDay(getDb(), {
                guildId: 'guild-1',
                channelId: 'channel-1',
                occurredAt: new Date('2026-06-26T11:00:00.000Z'),
            })
        );
        await expectOk(
            incrementGuildMessageActivityDay(getDb(), {
                guildId: 'guild-1',
                channelId: 'channel-2',
                occurredAt: new Date('2026-06-26T11:00:00.000Z'),
            })
        );

        const aggregate = await expectOk(
            loadGuildOverviewAggregate(getDb(), {
                guildId: 'guild-1',
                now: new Date('2026-06-26T12:00:00.000Z'),
            })
        );

        expect(secondIncrement).toMatchObject({
            activityDate: '2026-06-26',
            messageCount: 2,
        });
        expect(aggregate.messages.totalMessages).toBe(3);
        expect(aggregate.messages.graph).toContainEqual({
            date: '2026-06-26',
            messageCount: 3,
        });
        expect(aggregate.messages.topChannels).toStrictEqual([
            { channelId: 'channel-1', messageCount: 2 },
            { channelId: 'channel-2', messageCount: 1 },
        ]);
        expect(aggregate.dataHealth.hasMessageActivity).toBe(true);
    });

    it('groups top inviters by attributed joins and known invite codes', async () => {
        await expectOk(
            syncGuildInviteSnapshots(getDb(), {
                guildId: 'guild-1',
                invites: [
                    { code: 'alpha', inviterUserId: 'inviter-1', uses: 5 },
                    { code: 'beta', inviterUserId: 'inviter-1', uses: 2 },
                    { code: 'gamma', inviterUserId: 'inviter-2', uses: 1 },
                ],
            })
        );
        await expectOk(
            recordGuildMemberFlowEvent(getDb(), {
                guildId: 'guild-1',
                userId: 'user-1',
                eventType: 'join',
                inviteCode: 'alpha',
                inviterUserId: 'inviter-1',
                attributionStatus: 'attributed',
            })
        );
        await expectOk(
            recordGuildMemberFlowEvent(getDb(), {
                guildId: 'guild-1',
                userId: 'user-2',
                eventType: 'join',
                inviteCode: 'beta',
                inviterUserId: 'inviter-1',
                attributionStatus: 'attributed',
            })
        );

        const aggregate = await expectOk(loadGuildOverviewAggregate(getDb(), { guildId: 'guild-1' }));

        expect(aggregate.invites).toMatchObject({
            activeInviteCount: 3,
            totalInviteUses: 8,
        });
        expect(aggregate.invites.topInviters).toStrictEqual([
            {
                inviterUserId: 'inviter-1',
                attributedJoins: 2,
                inviteCodes: [
                    { code: 'alpha', uses: 5, active: true },
                    { code: 'beta', uses: 2, active: true },
                ],
            },
        ]);
    });

    it('rejects invalid repository input before writing', async () => {
        const result = await incrementGuildMessageActivityDay(getDb(), {
            guildId: 'guild-1',
            channelId: 'channel-1',
            occurredAt: new Date('invalid'),
        });

        expect(result.isErr()).toBe(true);
        expect(result._unsafeUnwrapErr()).toStrictEqual({
            type: 'invalid-value',
            field: 'occurredAt',
        });
    });
});

async function expectOk<TValue>(promise: Promise<{ isOk(): boolean; _unsafeUnwrap(): TValue }>): Promise<TValue> {
    const result = await promise;

    expect(result.isOk()).toBe(true);

    return result._unsafeUnwrap();
}

function getDb(): Parameters<typeof upsertGuild>[0] {
    if (!testDatabase) {
        throw new Error('Test database was not initialized');
    }

    return testDatabase.db;
}

type TestDatabase = {
    db: Parameters<typeof upsertGuild>[0];
    close: () => Promise<void>;
};

async function createTestDatabase(): Promise<TestDatabase> {
    const dataDir = join(testDataRoot, randomUUID());

    await mkdir(dataDir, { recursive: true });

    const client = new PGlite(dataDir);
    const db = drizzle(client, { schema });

    await migrate(db, { migrationsFolder });

    return {
        db,
        async close() {
            await client.close();
            await rm(dataDir, { recursive: true, force: true });
        },
    };
}

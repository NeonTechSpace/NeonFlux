import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createPgliteTestDatabase, type PgliteTestDatabase } from '../test-support/pglite-test-database.js';

import { upsertGuild } from './guilds.js';
import {
    createStructureExportSnapshot,
    createStructureImportRun,
    findStructureExportSnapshotByGuildId,
    findStructureImportRunByGuildId,
    findStructureObservedEventStateByGuildId,
    listStructureExportSnapshotsByGuildId,
    listStructureImportRunsByGuildId,
    recordStructureObservedEvent,
    recordStructureImportAction,
    updateStructureImportActionStatus,
    updateStructureImportRunStatus,
} from './structure-import-export.js';

let testDatabase: TestDatabase | undefined;

beforeAll(async () => {
    testDatabase = await createTestDatabase();
});

beforeEach(async () => {
    await resetTestDatabase();
});

afterAll(async () => {
    await testDatabase?.close();
    testDatabase = undefined;
});

describe('structure import/export repository', () => {
    beforeEach(async () => {
        await expectOk(upsertGuild(getDb(), { guildId: 'guild-1' }));
        await expectOk(upsertGuild(getDb(), { guildId: 'guild-2' }));
    });

    it('lists export snapshots scoped to the guild', async () => {
        const first = await expectOk(
            createStructureExportSnapshot(getDb(), {
                guildId: 'guild-1',
                createdByUserId: 'actor-1',
                source: 'dashboard',
                snapshot: { roles: [{ id: 'role-1' }] },
            })
        );
        await expectOk(
            createStructureExportSnapshot(getDb(), {
                guildId: 'guild-2',
                snapshot: { roles: [{ id: 'other-role' }] },
            })
        );

        const snapshots = await expectOk(listStructureExportSnapshotsByGuildId(getDb(), { guildId: 'guild-1' }));
        const found = await expectOk(
            findStructureExportSnapshotByGuildId(getDb(), {
                guildId: 'guild-1',
                snapshotId: first.id,
            })
        );
        const crossGuild = await findStructureExportSnapshotByGuildId(getDb(), {
            guildId: 'guild-2',
            snapshotId: first.id,
        });

        expect(snapshots.map((snapshot) => snapshot.guildId)).toStrictEqual(['guild-1']);
        expect(found.snapshot).toStrictEqual({ roles: [{ id: 'role-1' }] });
        expect(crossGuild.isErr()).toBe(true);
        expect(crossGuild._unsafeUnwrapErr()).toStrictEqual({ type: 'not-found' });
    });

    it('lists import dry-runs with their planned actions', async () => {
        const run = await expectOk(
            createStructureImportRun(getDb(), {
                guildId: 'guild-1',
                createdByUserId: 'actor-1',
                plan: { summary: { creates: 1 } },
            })
        );
        await expectOk(
            recordStructureImportAction(getDb(), {
                runId: run.id,
                actionType: 'create',
                targetType: 'channel',
                targetId: 'channel-1',
                status: 'dry_run',
                details: { name: 'announcements' },
            })
        );
        await expectOk(
            updateStructureImportRunStatus(getDb(), {
                runId: run.id,
                status: 'dry_run_complete',
            })
        );

        const runs = await expectOk(listStructureImportRunsByGuildId(getDb(), { guildId: 'guild-1' }));

        expect(runs).toHaveLength(1);
        expect(runs[0]).toMatchObject({
            id: run.id,
            status: 'dry_run_complete',
            actions: [
                expect.objectContaining({
                    actionType: 'create',
                    targetType: 'channel',
                    targetId: 'channel-1',
                    status: 'dry_run',
                }),
            ],
        });
    });

    it('finds and confirms import runs through the owning guild', async () => {
        const run = await expectOk(
            createStructureImportRun(getDb(), {
                guildId: 'guild-1',
                createdByUserId: 'actor-1',
                plan: { summary: { updates: 1 } },
            })
        );
        await expectOk(
            recordStructureImportAction(getDb(), {
                runId: run.id,
                actionType: 'update',
                targetType: 'channel',
                targetId: 'channel-1',
                status: 'dry_run',
            })
        );
        await expectOk(updateStructureImportRunStatus(getDb(), { runId: run.id, status: 'dry_run_complete' }));

        const found = await expectOk(
            findStructureImportRunByGuildId(getDb(), {
                guildId: 'guild-1',
                runId: run.id,
            })
        );
        const crossGuild = await findStructureImportRunByGuildId(getDb(), {
            guildId: 'guild-2',
            runId: run.id,
        });
        const confirmed = await expectOk(
            updateStructureImportRunStatus(getDb(), { runId: run.id, status: 'confirmed' })
        );

        expect(found.actions).toHaveLength(1);
        expect(crossGuild.isErr()).toBe(true);
        expect(crossGuild._unsafeUnwrapErr()).toStrictEqual({ type: 'not-found' });
        expect(confirmed.status).toBe('confirmed');
        expect(confirmed.confirmedAt).toBeInstanceOf(Date);
    });

    it('updates action status and result details for apply tracking', async () => {
        const run = await expectOk(
            createStructureImportRun(getDb(), {
                guildId: 'guild-1',
                plan: { summary: { updates: 1 } },
            })
        );
        const action = await expectOk(
            recordStructureImportAction(getDb(), {
                runId: run.id,
                actionType: 'update',
                targetType: 'channel',
                targetId: 'channel-1',
                status: 'dry_run',
                details: { changes: [{ field: 'name', before: 'old', after: 'new' }] },
            })
        );

        const updated = await expectOk(
            updateStructureImportActionStatus(getDb(), {
                actionId: action.id,
                status: 'applied',
                details: { appliedAt: '2026-06-28T00:00:00.000Z' },
            })
        );

        expect(updated.status).toBe('applied');
        expect(updated.details).toStrictEqual({ appliedAt: '2026-06-28T00:00:00.000Z' });
        expect(updated.updatedAt.getTime()).toBeGreaterThanOrEqual(action.updatedAt.getTime());
    });

    it('tracks the latest observed structure event without creating export snapshots', async () => {
        const initialState = await expectOk(findStructureObservedEventStateByGuildId(getDb(), { guildId: 'guild-1' }));
        const firstState = await expectOk(
            recordStructureObservedEvent(getDb(), {
                guildId: 'guild-1',
                eventType: 'role.created',
                targetType: 'role',
                targetId: 'role-1',
            })
        );
        const secondState = await expectOk(
            recordStructureObservedEvent(getDb(), {
                guildId: 'guild-1',
                eventType: 'channel.updated',
                targetType: 'channel',
                targetId: 'channel-1',
            })
        );
        const snapshots = await expectOk(listStructureExportSnapshotsByGuildId(getDb(), { guildId: 'guild-1' }));

        expect(initialState).toStrictEqual({
            guildId: 'guild-1',
            observedChangeCount: 0,
        });
        expect(firstState).toMatchObject({
            guildId: 'guild-1',
            observedChangeCount: 1,
            lastEventType: 'role.created',
            lastTargetType: 'role',
            lastTargetId: 'role-1',
        });
        expect(firstState.lastObservedAt).toBeInstanceOf(Date);
        expect(secondState).toMatchObject({
            guildId: 'guild-1',
            observedChangeCount: 2,
            lastEventType: 'channel.updated',
            lastTargetType: 'channel',
            lastTargetId: 'channel-1',
        });
        expect(snapshots).toStrictEqual([]);
    });

    it('rejects invalid scoped list input before reading', async () => {
        const result = await listStructureImportRunsByGuildId(getDb(), {
            guildId: ' ',
        });

        expect(result.isErr()).toBe(true);
        expect(result._unsafeUnwrapErr()).toStrictEqual({
            type: 'missing-input',
            field: 'guildId',
        });
    });

    it('rejects invalid observed structure event input before writing', async () => {
        const result = await recordStructureObservedEvent(getDb(), {
            guildId: 'guild-1',
            eventType: ' ',
            targetType: 'role',
        });

        expect(result.isErr()).toBe(true);
        expect(result._unsafeUnwrapErr()).toStrictEqual({
            type: 'missing-input',
            field: 'eventType',
        });
    });
});

async function expectOk<TValue>(promise: Promise<{ isOk(): boolean; _unsafeUnwrap(): TValue }>): Promise<TValue> {
    const result = await promise;

    expect(result.isOk()).toBe(true);

    return result._unsafeUnwrap();
}

async function resetTestDatabase(): Promise<void> {
    if (!testDatabase) {
        throw new Error('Test database was not initialized');
    }

    await testDatabase.reset();
}

function getDb(): TestDatabase['db'] {
    if (!testDatabase) {
        throw new Error('Test database was not initialized');
    }

    return testDatabase.db;
}

type TestDatabase = PgliteTestDatabase;

function createTestDatabase(): Promise<TestDatabase> {
    return createPgliteTestDatabase('structure-import-export');
}

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createPgliteTestDatabase, type PgliteTestDatabase } from '../test-support/pglite-test-database.js';

import { upsertGuild } from './guilds.js';
import { createModerationCase } from './moderation.js';
import {
    cancelPendingModerationTemporaryActionsByTarget,
    createModerationTemporaryAction,
    findPendingModerationTemporaryActionByTarget,
    listDueModerationTemporaryActions,
    updateModerationTemporaryActionStatus,
} from './moderation-temporary-actions.js';

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

describe('moderation temporary action repository', () => {
    beforeEach(async () => {
        await expectOk(upsertGuild(getDb(), { guildId: 'guild-1' }));
    });

    it('creates temporary actions and lists due pending actions', async () => {
        const moderationCase = await expectOk(
            createModerationCase(getDb(), {
                guildId: 'guild-1',
                action: 'timeout',
                targetUserId: 'user-1',
            })
        );
        const due = await expectOk(
            createModerationTemporaryAction(getDb(), {
                guildId: 'guild-1',
                action: 'timeout',
                targetUserId: 'user-1',
                caseId: moderationCase.id,
                expiresAt: new Date('2026-06-26T10:00:00.000Z'),
            })
        );
        await expectOk(
            createModerationTemporaryAction(getDb(), {
                guildId: 'guild-1',
                action: 'timeout',
                targetUserId: 'user-2',
                expiresAt: new Date('2026-06-26T12:00:00.000Z'),
            })
        );
        await expectOk(
            createModerationTemporaryAction(getDb(), {
                guildId: 'guild-1',
                action: 'slowmode',
                targetUserId: 'user-3',
                expiresAt: new Date('2026-06-26T09:00:00.000Z'),
            })
        );

        const dueActions = await expectOk(
            listDueModerationTemporaryActions(getDb(), {
                now: new Date('2026-06-26T10:30:00.000Z'),
                action: 'timeout',
            })
        );

        expect(due).toMatchObject({
            action: 'timeout',
            caseId: moderationCase.id,
            guildId: 'guild-1',
            status: 'pending',
            targetUserId: 'user-1',
        });
        expect(dueActions.map((action) => action.id)).toStrictEqual([due.id]);
    });

    it('finds active pending actions and cancels stale pending actions for the same target', async () => {
        const older = await expectOk(
            createModerationTemporaryAction(getDb(), {
                guildId: 'guild-1',
                action: 'timeout',
                targetUserId: 'user-1',
                expiresAt: new Date('2026-06-26T11:00:00.000Z'),
            })
        );
        const current = await expectOk(
            createModerationTemporaryAction(getDb(), {
                guildId: 'guild-1',
                action: 'timeout',
                targetUserId: 'user-1',
                expiresAt: new Date('2026-06-26T12:00:00.000Z'),
            })
        );

        const cancelled = await expectOk(
            cancelPendingModerationTemporaryActionsByTarget(getDb(), {
                guildId: 'guild-1',
                action: 'timeout',
                targetUserId: 'user-1',
                excludeId: current.id,
            })
        );
        const active = await expectOk(
            findPendingModerationTemporaryActionByTarget(getDb(), {
                guildId: 'guild-1',
                action: 'timeout',
                targetUserId: 'user-1',
                now: new Date('2026-06-26T10:30:00.000Z'),
            })
        );

        expect(cancelled.map((action) => action.id)).toStrictEqual([older.id]);
        expect(cancelled[0]?.status).toBe('cancelled');
        expect(active.id).toBe(current.id);
    });

    it('updates temporary action status with explicit transition rules', async () => {
        const action = await expectOk(
            createModerationTemporaryAction(getDb(), {
                guildId: 'guild-1',
                action: 'timeout',
                targetUserId: 'user-1',
                expiresAt: new Date('2026-06-26T11:00:00.000Z'),
            })
        );

        const completed = await expectOk(
            updateModerationTemporaryActionStatus(getDb(), {
                id: action.id,
                status: 'completed',
            })
        );
        const secondUpdate = await updateModerationTemporaryActionStatus(getDb(), {
            id: action.id,
            status: 'failed',
        });

        expect(completed.status).toBe('completed');
        expect(secondUpdate.isErr()).toBe(true);
        expect(secondUpdate._unsafeUnwrapErr()).toStrictEqual({
            type: 'invalid-status-transition',
            from: 'completed',
            to: 'failed',
        });
    });

    it('rejects invalid temporary action input', async () => {
        const result = await createModerationTemporaryAction(getDb(), {
            guildId: 'guild-1',
            action: 'timeout',
            targetUserId: '   ',
            expiresAt: new Date(Number.NaN),
        });

        expect(result.isErr()).toBe(true);
        expect(result._unsafeUnwrapErr()).toStrictEqual({
            type: 'missing-input',
            field: 'targetUserId',
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
    return createPgliteTestDatabase('moderation-temporary-actions');
}

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createPgliteTestDatabase, type PgliteTestDatabase } from '../test-support/pglite-test-database.js';

import { upsertGuild } from './guilds.js';
import {
    createRoleReconciliationRun,
    findRoleReconciliationSettingsByGuildId,
    recordRoleReconciliationAction,
    updateRoleReconciliationRunStatus,
    upsertRoleReconciliationSettings,
} from './role-reconciliation.js';

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

describe('role reconciliation repository', () => {
    beforeEach(async () => {
        await expectOk(upsertGuild(getDb(), { guildId: 'guild-1' }));
    });

    it('records run status transitions and role actions', async () => {
        const run = await expectOk(
            createRoleReconciliationRun(getDb(), {
                guildId: 'guild-1',
                summary: { userId: 'user-1' },
            })
        );
        const applying = await expectOk(
            updateRoleReconciliationRunStatus(getDb(), {
                runId: run.id,
                status: 'applying',
                summary: { userId: 'user-1', repairableRoleCount: 1 },
            })
        );
        const action = await expectOk(
            recordRoleReconciliationAction(getDb(), {
                runId: run.id,
                actionType: 'member.role_restored',
                roleId: 'role-1',
                status: 'applied',
                details: { userId: 'user-1', sources: ['autorole'] },
            })
        );
        const applied = await expectOk(
            updateRoleReconciliationRunStatus(getDb(), {
                runId: run.id,
                status: 'applied',
                summary: { userId: 'user-1', appliedRoleIds: ['role-1'] },
            })
        );

        expect(run.status).toBe('pending');
        expect(applying.status).toBe('applying');
        expect(action).toMatchObject({
            runId: run.id,
            actionType: 'member.role_restored',
            roleId: 'role-1',
            status: 'applied',
            details: { userId: 'user-1', sources: ['autorole'] },
        });
        expect(applied).toMatchObject({
            status: 'applied',
            summary: { userId: 'user-1', appliedRoleIds: ['role-1'] },
        });
    });

    it('returns default enabled settings when no settings row exists', async () => {
        const settings = await expectOk(findRoleReconciliationSettingsByGuildId(getDb(), { guildId: 'guild-1' }));

        expect(settings).toStrictEqual({
            guildId: 'guild-1',
            enabled: true,
            restoreAutoroleRoles: true,
            restoreVerificationRoles: true,
            restoreReactionRoles: true,
            cleanupDeletedRoleReferences: true,
        });
    });

    it('upserts role reconciliation settings', async () => {
        const saved = await expectOk(
            upsertRoleReconciliationSettings(getDb(), {
                guildId: 'guild-1',
                enabled: true,
                restoreAutoroleRoles: false,
                restoreVerificationRoles: true,
                restoreReactionRoles: false,
                cleanupDeletedRoleReferences: true,
            })
        );
        const updated = await expectOk(
            upsertRoleReconciliationSettings(getDb(), {
                guildId: 'guild-1',
                enabled: false,
                restoreAutoroleRoles: true,
                restoreVerificationRoles: false,
                restoreReactionRoles: true,
                cleanupDeletedRoleReferences: false,
            })
        );

        expect(saved).toMatchObject({
            guildId: 'guild-1',
            enabled: true,
            restoreAutoroleRoles: false,
            restoreVerificationRoles: true,
            restoreReactionRoles: false,
            cleanupDeletedRoleReferences: true,
        });
        expect(updated).toMatchObject({
            guildId: 'guild-1',
            enabled: false,
            restoreAutoroleRoles: true,
            restoreVerificationRoles: false,
            restoreReactionRoles: true,
            cleanupDeletedRoleReferences: false,
        });
        expect(updated.updatedAt).toBeInstanceOf(Date);
    });

    it('rejects invalid run transitions and blank action types', async () => {
        const run = await expectOk(createRoleReconciliationRun(getDb(), { guildId: 'guild-1' }));
        const invalidTransition = await updateRoleReconciliationRunStatus(getDb(), {
            runId: run.id,
            status: 'applied',
        });
        const invalidAction = await recordRoleReconciliationAction(getDb(), {
            runId: run.id,
            actionType: ' ',
        });

        expect(invalidTransition.isErr()).toBe(true);
        expect(invalidTransition._unsafeUnwrapErr()).toStrictEqual({
            type: 'invalid-status-transition',
            from: 'pending',
            to: 'applied',
        });
        expect(invalidAction.isErr()).toBe(true);
        expect(invalidAction._unsafeUnwrapErr()).toStrictEqual({
            type: 'missing-input',
            field: 'actionType',
        });
    });

    it('rejects blank guild ids for settings writes', async () => {
        const result = await upsertRoleReconciliationSettings(getDb(), {
            guildId: ' ',
        });

        expect(result.isErr()).toBe(true);
        expect(result._unsafeUnwrapErr()).toStrictEqual({
            type: 'missing-input',
            field: 'guildId',
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
    return createPgliteTestDatabase('role-reconciliation');
}

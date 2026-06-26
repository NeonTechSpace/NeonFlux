import { randomUUID } from 'node:crypto';
import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { upsertAutoroleRule, listAutoroleRulesByGuildId } from './autorole.js';
import { deleteBotInstallation, upsertBotInstallation } from './bot-installations.js';
import { createModerationCase, updateModerationCaseStatus } from './moderation.js';
import { createStructureImportRun, updateStructureImportRunStatus } from './structure-import-export.js';
import { upsertGuild } from './guilds.js';
import * as schema from './schema.js';
import { addGuildUserXp, findGuildUserXp } from './xp.js';

const projectRoot = fileURLToPath(new URL('../../..', import.meta.url));
const migrationsFolder = join(projectRoot, 'packages', 'db', 'drizzle');
const testDataRoot = join(projectRoot, 'data', 'pglite-feature-foundation-test');

let testDatabase: TestDatabase | undefined;

describe('feature foundation repositories', () => {
    beforeEach(async () => {
        testDatabase = await createTestDatabase();
        await createGuild('guild-1');
    });

    afterEach(async () => {
        await testDatabase?.close();
        testDatabase = undefined;
    });

    it('upserts feature config idempotently and preserves it after bot uninstall', async () => {
        await expectOk(upsertBotInstallation(getDb(), { guildId: 'guild-1' }));
        const firstRule = await expectOk(
            upsertAutoroleRule(getDb(), {
                guildId: 'guild-1',
                roleId: 'role-1',
                name: 'Member',
            })
        );
        const secondRule = await expectOk(
            upsertAutoroleRule(getDb(), {
                guildId: 'guild-1',
                roleId: 'role-1',
                name: 'Verified Member',
            })
        );

        await expectOk(deleteBotInstallation(getDb(), { guildId: 'guild-1' }));
        const rules = await expectOk(listAutoroleRulesByGuildId(getDb(), { guildId: 'guild-1' }));

        expect(secondRule.id).toBe(firstRule.id);
        expect(rules).toHaveLength(1);
        expect(rules[0]).toMatchObject({
            guildId: 'guild-1',
            roleId: 'role-1',
            name: 'Verified Member',
        });
    });

    it('enforces moderation case status transitions', async () => {
        const moderationCase = await expectOk(
            createModerationCase(getDb(), {
                guildId: 'guild-1',
                caseNumber: 1,
                action: 'warn',
                targetUserId: 'user-1',
            })
        );

        const resolved = await expectOk(
            updateModerationCaseStatus(getDb(), {
                caseId: moderationCase.id,
                status: 'resolved',
            })
        );
        const reopened = await updateModerationCaseStatus(getDb(), {
            caseId: moderationCase.id,
            status: 'open',
        });

        expect(resolved.status).toBe('resolved');
        expect(reopened.isErr()).toBe(true);
        expect(reopened._unsafeUnwrapErr()).toStrictEqual({
            type: 'invalid-status-transition',
            from: 'resolved',
            to: 'open',
        });
    });

    it('increments XP records per guild user', async () => {
        await expectOk(
            addGuildUserXp(getDb(), {
                guildId: 'guild-1',
                userId: 'user-1',
                xp: 5,
                level: 1,
            })
        );
        await expectOk(
            addGuildUserXp(getDb(), {
                guildId: 'guild-1',
                userId: 'user-1',
                xp: 7,
                level: 2,
            })
        );

        const xp = await expectOk(findGuildUserXp(getDb(), { guildId: 'guild-1', userId: 'user-1' }));

        expect(xp).toMatchObject({
            guildId: 'guild-1',
            userId: 'user-1',
            xp: 12,
            level: 2,
            messageCount: 2,
        });
    });

    it('requires dry-run confirmation before structure import apply state', async () => {
        const importRun = await expectOk(
            createStructureImportRun(getDb(), {
                guildId: 'guild-1',
                plan: {
                    actions: [],
                },
            })
        );

        const directApply = await updateStructureImportRunStatus(getDb(), {
            runId: importRun.id,
            status: 'applying',
        });
        const dryRun = await expectOk(
            updateStructureImportRunStatus(getDb(), {
                runId: importRun.id,
                status: 'dry_run_complete',
            })
        );
        const confirmed = await expectOk(
            updateStructureImportRunStatus(getDb(), {
                runId: importRun.id,
                status: 'confirmed',
            })
        );

        expect(directApply.isErr()).toBe(true);
        expect(directApply._unsafeUnwrapErr()).toStrictEqual({
            type: 'invalid-status-transition',
            from: 'draft',
            to: 'applying',
        });
        expect(dryRun.status).toBe('dry_run_complete');
        expect(confirmed.status).toBe('confirmed');
        expect(confirmed.confirmedAt).toBeInstanceOf(Date);
    });

    it('rejects invalid repository input before writing', async () => {
        const result = await upsertAutoroleRule(getDb(), {
            guildId: 'guild-1',
            roleId: '   ',
        });

        expect(result.isErr()).toBe(true);
        expect(result._unsafeUnwrapErr()).toStrictEqual({
            type: 'missing-input',
            field: 'roleId',
        });
    });
});

async function createGuild(guildId: string): Promise<void> {
    await expectOk(upsertGuild(getDb(), { guildId }));
}

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

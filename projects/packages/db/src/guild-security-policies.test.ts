import { randomUUID } from 'node:crypto';
import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PGlite } from '@electric-sql/pglite';
import { DEFCON_FEATURE_CATEGORY } from '@neonflux/core/defcon';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { deleteBotInstallation, upsertBotInstallation } from './bot-installations.js';
import { findGuildById } from './guilds.js';
import {
    deleteGuildDefconExemption,
    findGuildCommandPermissionRule,
    findGuildDashboardPermissionRule,
    findGuildSecurityPolicyByGuildId,
    listGuildDashboardPermissionRulesByGuildIds,
    listGuildSecurityPoliciesByGuildIds,
    listGuildDefconExemptionCategories,
    upsertGuildCommandPermissionRule,
    upsertGuildDashboardPermissionRule,
    upsertGuildDefconExemption,
    upsertGuildSecurityPolicy,
} from './guild-security-policies.js';
import * as schema from './schema.js';

const projectRoot = fileURLToPath(new URL('../../..', import.meta.url));
const migrationsFolder = join(projectRoot, 'packages', 'db', 'drizzle');
const testDataRoot = join(projectRoot, 'data', 'pglite-guild-security-policies-test');

let testDatabase: TestDatabase | undefined;

describe('guild security policy repository', () => {
    beforeEach(async () => {
        testDatabase = await createTestDatabase();
        await installGuild('guild-1');
    });

    afterEach(async () => {
        await testDatabase?.close();
        testDatabase = undefined;
    });

    it('upserts a guild DEFCON policy', async () => {
        const policy = await upsertPolicy({ guildId: ' guild-1 ', defconLevel: 2 });
        const storedPolicy = await findGuildSecurityPolicyByGuildId(getDb(), { guildId: 'guild-1' });

        expect(policy).toMatchObject({
            guildId: 'guild-1',
            defconLevel: 2,
        });
        expect(storedPolicy.isOk()).toBe(true);
        expect(storedPolicy._unsafeUnwrap()).toStrictEqual(policy);
    });

    it('replaces the DEFCON level on upsert', async () => {
        await upsertPolicy({ guildId: 'guild-1', defconLevel: 2 });

        const updatedPolicy = await upsertPolicy({ guildId: 'guild-1', defconLevel: 1 });

        expect(updatedPolicy.defconLevel).toBe(1);
    });

    it('rejects blank guild ids and invalid DEFCON levels', async () => {
        const missingGuild = await upsertGuildSecurityPolicy(getDb(), { guildId: '   ', defconLevel: 2 });
        const invalidDefcon = await upsertGuildSecurityPolicy(getDb(), { guildId: 'guild-1', defconLevel: 4 });

        expect(missingGuild.isErr()).toBe(true);
        expect(missingGuild._unsafeUnwrapErr()).toBe('missing-guild-id');
        expect(invalidDefcon.isErr()).toBe(true);
        expect(invalidDefcon._unsafeUnwrapErr()).toBe('invalid-defcon-level');
    });

    it('lists security policies by guild ids', async () => {
        await installGuild('guild-2');
        await upsertPolicy({ guildId: 'guild-2', defconLevel: 1 });
        await upsertPolicy({ guildId: 'guild-1', defconLevel: 2 });

        const result = await listGuildSecurityPoliciesByGuildIds(getDb(), {
            guildIds: ['guild-2', 'guild-1', 'missing', ''],
        });

        expect(result.isOk()).toBe(true);
        expect(
            result._unsafeUnwrap().map((policy) => ({
                guildId: policy.guildId,
                defconLevel: policy.defconLevel,
            }))
        ).toStrictEqual([
            {
                guildId: 'guild-1',
                defconLevel: 2,
            },
            {
                guildId: 'guild-2',
                defconLevel: 1,
            },
        ]);
    });

    it('stores command grants separately from dashboard grants', async () => {
        const commandRule = await upsertCommandRule({
            guildId: 'guild-1',
            category: ` ${DEFCON_FEATURE_CATEGORY.prefix} `,
            userIds: [' user-a ', ''],
            roleIds: [' role-a '],
        });
        const dashboardRule = await upsertDashboardRule({
            guildId: 'guild-1',
            userIds: [' dashboard-user '],
            roleIds: [' dashboard-role '],
        });

        const storedCommandRule = await findGuildCommandPermissionRule(getDb(), {
            guildId: 'guild-1',
            category: DEFCON_FEATURE_CATEGORY.prefix,
        });
        const storedDashboardRule = await findGuildDashboardPermissionRule(getDb(), { guildId: 'guild-1' });

        expect(commandRule).toMatchObject({
            guildId: 'guild-1',
            category: DEFCON_FEATURE_CATEGORY.prefix,
            userIds: ['user-a'],
            roleIds: ['role-a'],
        });
        expect(dashboardRule).toMatchObject({
            guildId: 'guild-1',
            userIds: ['dashboard-user'],
            roleIds: ['dashboard-role'],
        });
        expect(storedCommandRule.isOk()).toBe(true);
        expect(storedCommandRule._unsafeUnwrap()).toStrictEqual(commandRule);
        expect(storedDashboardRule.isOk()).toBe(true);
        expect(storedDashboardRule._unsafeUnwrap()).toStrictEqual(dashboardRule);
    });

    it('lists dashboard grants by guild ids', async () => {
        await installGuild('guild-2');
        await upsertDashboardRule({
            guildId: 'guild-2',
            userIds: ['user-b'],
            roleIds: ['role-b'],
        });
        await upsertDashboardRule({
            guildId: 'guild-1',
            userIds: ['user-a'],
            roleIds: ['role-a'],
        });

        const result = await listGuildDashboardPermissionRulesByGuildIds(getDb(), {
            guildIds: ['guild-2', 'guild-1', 'missing', ''],
        });

        expect(result.isOk()).toBe(true);
        expect(
            result._unsafeUnwrap().map((rule) => ({
                guildId: rule.guildId,
                userIds: rule.userIds,
                roleIds: rule.roleIds,
            }))
        ).toStrictEqual([
            {
                guildId: 'guild-1',
                userIds: ['user-a'],
                roleIds: ['role-a'],
            },
            {
                guildId: 'guild-2',
                userIds: ['user-b'],
                roleIds: ['role-b'],
            },
        ]);
    });

    it('rejects blank command grant categories', async () => {
        const result = await upsertGuildCommandPermissionRule(getDb(), {
            guildId: 'guild-1',
            category: '   ',
        });

        expect(result.isErr()).toBe(true);
        expect(result._unsafeUnwrapErr()).toBe('missing-category');
    });

    it('stores DEFCON 1 exemptions as sorted feature categories', async () => {
        await upsertExemption({ guildId: 'guild-1', category: 'verification' });
        await upsertExemption({ guildId: 'guild-1', category: ` ${DEFCON_FEATURE_CATEGORY.botMention} ` });
        await upsertExemption({ guildId: 'guild-1', category: 'verification' });

        const categories = await listGuildDefconExemptionCategories(getDb(), { guildId: 'guild-1' });

        expect(categories.isOk()).toBe(true);
        expect(categories._unsafeUnwrap()).toStrictEqual([DEFCON_FEATURE_CATEGORY.botMention, 'verification']);
    });

    it('deletes a DEFCON exemption', async () => {
        await upsertExemption({ guildId: 'guild-1', category: DEFCON_FEATURE_CATEGORY.botMention });

        const deleted = await deleteGuildDefconExemption(getDb(), {
            guildId: 'guild-1',
            category: DEFCON_FEATURE_CATEGORY.botMention,
        });
        const categories = await listGuildDefconExemptionCategories(getDb(), { guildId: 'guild-1' });

        expect(deleted.isOk()).toBe(true);
        expect(deleted._unsafeUnwrap()).toMatchObject({
            guildId: 'guild-1',
            category: DEFCON_FEATURE_CATEGORY.botMention,
        });
        expect(categories.isOk()).toBe(true);
        expect(categories._unsafeUnwrap()).toStrictEqual([]);
    });

    it('preserves policy data when a guild installation is removed', async () => {
        await upsertPolicy({ guildId: 'guild-1', defconLevel: 1 });
        await upsertCommandRule({ guildId: 'guild-1', category: DEFCON_FEATURE_CATEGORY.prefix });
        await upsertDashboardRule({ guildId: 'guild-1' });
        await upsertExemption({ guildId: 'guild-1', category: DEFCON_FEATURE_CATEGORY.botMention });

        const deletedInstallation = await deleteBotInstallation(getDb(), { guildId: 'guild-1' });

        expect(deletedInstallation.isOk()).toBe(true);

        const guild = await findGuildById(getDb(), { guildId: 'guild-1' });
        const policy = await findGuildSecurityPolicyByGuildId(getDb(), { guildId: 'guild-1' });
        const commandRule = await findGuildCommandPermissionRule(getDb(), {
            guildId: 'guild-1',
            category: DEFCON_FEATURE_CATEGORY.prefix,
        });
        const dashboardRule = await findGuildDashboardPermissionRule(getDb(), { guildId: 'guild-1' });
        const categories = await listGuildDefconExemptionCategories(getDb(), { guildId: 'guild-1' });

        expect(guild.isOk()).toBe(true);
        expect(policy.isOk()).toBe(true);
        expect(commandRule.isOk()).toBe(true);
        expect(dashboardRule.isOk()).toBe(true);
        expect(categories._unsafeUnwrap()).toStrictEqual([DEFCON_FEATURE_CATEGORY.botMention]);
    });
});

async function installGuild(guildId: string): Promise<void> {
    const result = await upsertBotInstallation(getDb(), { guildId });

    expect(result.isOk()).toBe(true);
}

async function upsertPolicy(input: Parameters<typeof upsertGuildSecurityPolicy>[1]) {
    const result = await upsertGuildSecurityPolicy(getDb(), input);

    expect(result.isOk()).toBe(true);

    return result._unsafeUnwrap();
}

async function upsertCommandRule(input: Parameters<typeof upsertGuildCommandPermissionRule>[1]) {
    const result = await upsertGuildCommandPermissionRule(getDb(), input);

    expect(result.isOk()).toBe(true);

    return result._unsafeUnwrap();
}

async function upsertDashboardRule(input: Parameters<typeof upsertGuildDashboardPermissionRule>[1]) {
    const result = await upsertGuildDashboardPermissionRule(getDb(), input);

    expect(result.isOk()).toBe(true);

    return result._unsafeUnwrap();
}

async function upsertExemption(input: Parameters<typeof upsertGuildDefconExemption>[1]) {
    const result = await upsertGuildDefconExemption(getDb(), input);

    expect(result.isOk()).toBe(true);

    return result._unsafeUnwrap();
}

function getDb(): TestDatabase['db'] {
    if (!testDatabase) {
        throw new Error('Test database was not initialized');
    }

    return testDatabase.db;
}

type TestDatabase = {
    db: Parameters<typeof upsertGuildSecurityPolicy>[0];
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

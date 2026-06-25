import { randomUUID } from 'node:crypto';
import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { upsertBotInstallation } from './bot-installations.js';
import {
    findGuildCommandSettingsByGuildId,
    GUILD_COMMAND_SETTINGS_FEATURE,
    upsertGuildCommandPrefix,
    type GuildCommandSettingsRecord,
} from './guild-command-settings.js';
import * as schema from './schema.js';
import { guildFeatureSettings } from './schema.js';

const projectRoot = fileURLToPath(new URL('../../..', import.meta.url));
const migrationsFolder = join(projectRoot, 'packages', 'db', 'drizzle');
const testDataRoot = join(projectRoot, 'data', 'pglite-guild-command-settings-test');

let testDatabase: TestDatabase | undefined;

describe('guild command settings repository', () => {
    beforeEach(async () => {
        testDatabase = await createTestDatabase();
    });

    afterEach(async () => {
        await testDatabase?.close();
        testDatabase = undefined;
        vi.useRealTimers();
    });

    it('returns not-found when command settings do not exist', async () => {
        await createInstalledGuild('guild-1');

        const result = await findGuildCommandSettingsByGuildId(getDb(), { guildId: 'guild-1' });

        expect(result.isErr()).toBe(true);
        expect(result._unsafeUnwrapErr()).toBe('not-found');
    });

    it('upserts a valid prefix and reads it back', async () => {
        await createInstalledGuild('guild-1');

        const savedSettings = await upsertCommandPrefix(' guild-1 ', ' ? ');
        const readSettings = await findGuildCommandSettingsByGuildId(getDb(), { guildId: ' guild-1 ' });

        expect(savedSettings).toMatchObject({
            guildId: 'guild-1',
            prefix: '?',
        });
        expect(savedSettings.createdAt).toBeInstanceOf(Date);
        expect(savedSettings.updatedAt).toBeInstanceOf(Date);
        expect(readSettings.isOk()).toBe(true);
        expect(readSettings._unsafeUnwrap()).toMatchObject({
            guildId: 'guild-1',
            prefix: '?',
        });
    });

    it.each(['?1', '!go', '$2'])('accepts prefixes with letters or numbers after a symbol: %j', async (prefix) => {
        await createInstalledGuild('guild-1');

        const savedSettings = await upsertCommandPrefix('guild-1', prefix);

        expect(savedSettings).toMatchObject({
            guildId: 'guild-1',
            prefix,
        });
    });

    it('replaces a previous prefix on second upsert', async () => {
        await createInstalledGuild('guild-1');
        const firstUpdatedAt = new Date('2026-06-24T09:00:00.000Z');
        const secondUpdatedAt = new Date('2026-06-24T10:00:00.000Z');

        vi.useFakeTimers();
        vi.setSystemTime(firstUpdatedAt);
        const firstSettings = await upsertCommandPrefix('guild-1', '!');

        vi.setSystemTime(secondUpdatedAt);
        const secondSettings = await upsertCommandPrefix('guild-1', '?');

        expect(secondSettings).toMatchObject({
            guildId: 'guild-1',
            prefix: '?',
            createdAt: firstSettings.createdAt,
            updatedAt: secondUpdatedAt,
        });
    });

    it('returns existing settings without updating when the prefix is unchanged', async () => {
        await createInstalledGuild('guild-1');
        const firstUpdatedAt = new Date('2026-06-24T09:00:00.000Z');
        const secondUpdatedAt = new Date('2026-06-24T10:00:00.000Z');

        vi.useFakeTimers();
        vi.setSystemTime(firstUpdatedAt);
        const firstSettings = await upsertCommandPrefix('guild-1', '?');

        vi.setSystemTime(secondUpdatedAt);
        const secondSettings = await upsertCommandPrefix('guild-1', ' ? ');

        expect(secondSettings).toStrictEqual(firstSettings);
    });

    it('rejects a blank guild id', async () => {
        const findResult = await findGuildCommandSettingsByGuildId(getDb(), { guildId: '   ' });
        const upsertResult = await upsertGuildCommandPrefix(getDb(), { guildId: '   ', prefix: '?' });

        expect(findResult.isErr()).toBe(true);
        expect(findResult._unsafeUnwrapErr()).toBe('missing-guild-id');
        expect(upsertResult.isErr()).toBe(true);
        expect(upsertResult._unsafeUnwrapErr()).toBe('missing-guild-id');
    });

    it.each(['', '    ', '....', 'a', '1', '? a', '\u200b', '👩‍💻', '/', '@', '#', '<', '>', ':', '?/'])(
        'rejects invalid prefix %j',
        async (prefix) => {
            await createInstalledGuild('guild-1');

            const result = await upsertGuildCommandPrefix(getDb(), { guildId: 'guild-1', prefix });

            expect(result.isErr()).toBe(true);
            expect(result._unsafeUnwrapErr()).toBe('invalid-prefix');
        }
    );

    it('returns invalid-config when stored command settings do not contain a valid prefix', async () => {
        await createInstalledGuild('guild-1');
        await getDb()
            .insert(guildFeatureSettings)
            .values({
                guildId: 'guild-1',
                feature: GUILD_COMMAND_SETTINGS_FEATURE,
                enabled: true,
                config: {
                    prefix: 'abc',
                },
            });

        const result = await findGuildCommandSettingsByGuildId(getDb(), { guildId: 'guild-1' });

        expect(result.isErr()).toBe(true);
        expect(result._unsafeUnwrapErr()).toBe('invalid-config');
    });
});

async function createInstalledGuild(guildId: string): Promise<void> {
    const result = await upsertBotInstallation(getDb(), { guildId });

    expect(result.isOk()).toBe(true);
}

async function upsertCommandPrefix(guildId: string, prefix: string): Promise<GuildCommandSettingsRecord> {
    const result = await upsertGuildCommandPrefix(getDb(), {
        guildId,
        prefix,
    });

    expect(result.isOk()).toBe(true);

    return result._unsafeUnwrap();
}

function getDb(): Parameters<typeof upsertGuildCommandPrefix>[0] {
    if (!testDatabase) {
        throw new Error('Test database was not initialized');
    }

    return testDatabase.db;
}

type TestDatabase = {
    db: Parameters<typeof upsertGuildCommandPrefix>[0];
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

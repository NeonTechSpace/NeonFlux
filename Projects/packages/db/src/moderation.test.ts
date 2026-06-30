import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createPgliteTestDatabase, type PgliteTestDatabase } from '../test-support/pglite-test-database.js';

import { upsertGuild } from './guilds.js';
import {
    addModerationCaseNote,
    createChannelModerationCase,
    createModerationCase,
    findModerationCaseByGuildCaseNumber,
    listModerationCaseEventsByCaseId,
    listModerationCasesByGuildId,
    updateModerationCaseReason,
    voidModerationCase,
} from './moderation.js';
import { createObservedModerationCase, findRecentModerationCaseByTargetAction } from './moderation-observed-events.js';
import * as schema from './schema.js';

const projectRoot = fileURLToPath(new URL('../../..', import.meta.url));
const migrationsFolder = join(projectRoot, 'packages', 'db', 'drizzle');
const testDataRoot = join(projectRoot, 'data', 'pglite-moderation-test');

let testDatabase: TestDatabase | undefined;

describe('moderation repository', () => {
    beforeAll(async () => {
        testDatabase = await createTestDatabase();
    });

    beforeEach(async () => {
        await resetTestDatabase();
        await expectOk(upsertGuild(getDb(), { guildId: 'guild-1' }));
        await expectOk(upsertGuild(getDb(), { guildId: 'guild-2' }));
    });

    afterAll(async () => {
        await testDatabase?.close();
        testDatabase = undefined;
    });

    it('allocates case numbers per guild when the caller does not provide one', async () => {
        const first = await expectOk(
            createModerationCase(getDb(), {
                guildId: 'guild-1',
                action: 'warn',
                targetUserId: 'user-1',
                actorUserId: 'mod-1',
            })
        );
        const second = await expectOk(
            createModerationCase(getDb(), {
                guildId: 'guild-1',
                action: 'warn',
                targetUserId: 'user-2',
            })
        );
        const otherGuild = await expectOk(
            createModerationCase(getDb(), {
                guildId: 'guild-2',
                action: 'warn',
                targetUserId: 'user-1',
            })
        );

        expect(first.caseNumber).toBe(1);
        expect(second.caseNumber).toBe(2);
        expect(otherGuild.caseNumber).toBe(1);
    });

    it('advances automatic numbering after a manually numbered case', async () => {
        await expectOk(
            createModerationCase(getDb(), {
                guildId: 'guild-1',
                caseNumber: 10,
                action: 'warn',
                targetUserId: 'user-1',
            })
        );

        const automatic = await expectOk(
            createModerationCase(getDb(), {
                guildId: 'guild-1',
                action: 'warn',
                targetUserId: 'user-2',
            })
        );

        expect(automatic.caseNumber).toBe(11);
    });

    it('finds and lists guild-scoped warning cases', async () => {
        const warning = await expectOk(
            createModerationCase(getDb(), {
                guildId: 'guild-1',
                action: 'warn',
                targetUserId: 'user-1',
                reason: 'Repeated spam',
            })
        );
        await expectOk(
            createModerationCase(getDb(), {
                guildId: 'guild-1',
                action: 'note',
                targetUserId: 'user-1',
            })
        );

        const found = await expectOk(
            findModerationCaseByGuildCaseNumber(getDb(), {
                guildId: 'guild-1',
                caseNumber: warning.caseNumber,
            })
        );
        const warnings = await expectOk(
            listModerationCasesByGuildId(getDb(), {
                guildId: 'guild-1',
                targetUserId: 'user-1',
                action: 'warn',
            })
        );

        expect(found.id).toBe(warning.id);
        expect(warnings).toHaveLength(1);
        expect(warnings[0]).toMatchObject({
            action: 'warn',
            targetUserId: 'user-1',
            reason: 'Repeated spam',
        });
    });

    it('creates channel-targeted moderation cases', async () => {
        const purgeCase = await expectOk(
            createChannelModerationCase(getDb(), {
                guildId: 'guild-1',
                action: 'purge',
                targetChannelId: 'channel-1',
                actorUserId: 'mod-1',
                reason: 'cleanup',
            })
        );
        const cases = await expectOk(
            listModerationCasesByGuildId(getDb(), {
                guildId: 'guild-1',
            })
        );

        expect(purgeCase).toMatchObject({
            action: 'purge',
            actorUserId: 'mod-1',
            reason: 'cleanup',
            targetChannelId: 'channel-1',
            targetType: 'channel',
            targetUserId: null,
        });
        expect(cases[0]?.id).toBe(purgeCase.id);
    });

    it('updates reasons and records notes as case events', async () => {
        const moderationCase = await expectOk(
            createModerationCase(getDb(), {
                guildId: 'guild-1',
                action: 'warn',
                targetUserId: 'user-1',
            })
        );

        const updated = await expectOk(
            updateModerationCaseReason(getDb(), {
                caseId: moderationCase.id,
                actorUserId: 'mod-1',
                reason: 'Updated reason',
            })
        );
        await expectOk(
            addModerationCaseNote(getDb(), {
                caseId: moderationCase.id,
                actorUserId: 'mod-2',
                note: 'Internal note',
            })
        );
        const events = await expectOk(
            listModerationCaseEventsByCaseId(getDb(), {
                caseId: moderationCase.id,
                limit: 10,
            })
        );

        expect(updated.reason).toBe('Updated reason');
        expect(events.map((event) => event.eventType).sort()).toStrictEqual(['note.added', 'reason.updated']);
        expect(events.find((event) => event.eventType === 'note.added')?.details).toStrictEqual({
            note: 'Internal note',
        });
    });

    it('creates resolved observed cases for external moderation events', async () => {
        const observed = await expectOk(
            createObservedModerationCase(getDb(), {
                guildId: 'guild-1',
                action: 'ban',
                targetUserId: 'user-1',
                eventType: 'action.observed',
                details: {
                    source: 'fluxer',
                    sourceEventType: 'ban.added',
                },
            })
        );

        const found = await expectOk(
            findRecentModerationCaseByTargetAction(getDb(), {
                guildId: 'guild-1',
                targetUserId: 'user-1',
                action: 'ban',
                statuses: ['open', 'resolved'],
                since: new Date(Date.now() - 60_000),
            })
        );
        const events = await expectOk(
            listModerationCaseEventsByCaseId(getDb(), {
                caseId: observed.id,
                eventType: 'action.observed',
            })
        );
        const stale = await findRecentModerationCaseByTargetAction(getDb(), {
            guildId: 'guild-1',
            targetUserId: 'user-1',
            action: 'ban',
            since: new Date(Date.now() + 60_000),
        });

        expect(observed).toMatchObject({
            action: 'ban',
            actorUserId: null,
            status: 'resolved',
            targetUserId: 'user-1',
        });
        expect(found.id).toBe(observed.id);
        expect(events).toHaveLength(1);
        expect(events[0]?.details).toStrictEqual({
            source: 'fluxer',
            sourceEventType: 'ban.added',
        });
        expect(stale.isErr()).toBe(true);
        expect(stale._unsafeUnwrapErr()).toStrictEqual({ type: 'not-found' });
    });

    it('voids open warning cases and rejects invalid transitions', async () => {
        const moderationCase = await expectOk(
            createModerationCase(getDb(), {
                guildId: 'guild-1',
                action: 'warn',
                targetUserId: 'user-1',
            })
        );

        const voided = await expectOk(
            voidModerationCase(getDb(), {
                caseId: moderationCase.id,
                actorUserId: 'mod-1',
                reason: 'Duplicate warning',
            })
        );
        const secondVoid = await voidModerationCase(getDb(), {
            caseId: moderationCase.id,
        });

        expect(voided.status).toBe('void');
        expect(secondVoid.isErr()).toBe(true);
        expect(secondVoid._unsafeUnwrapErr()).toStrictEqual({
            type: 'invalid-status-transition',
            from: 'void',
            to: 'void',
        });
    });

    it('backfills case counters from existing migrated cases', async () => {
        const dataDir = join(testDataRoot, randomUUID());
        await mkdir(dataDir, { recursive: true });

        const client = new PGlite(dataDir);

        try {
            await applySqlMigrationsBeforeCaseCounters(client);
            await client.query("insert into guilds (guild_id) values ('legacy-guild');");
            await client.query(`
                insert into moderation_cases (guild_id, case_number, action, target_user_id)
                values ('legacy-guild', 7, 'warn', 'user-1');
            `);
            await applySqlMigration(client, '0012_moderation_case_counters.sql');
            await applySqlMigration(client, '0013_moderation_case_dashboard_events.sql');
            await applySqlMigration(client, '0014_moderation_case_targets.sql');

            const db = drizzle(client, { schema });
            const created = await expectOk(
                createModerationCase(db, {
                    guildId: 'legacy-guild',
                    action: 'warn',
                    targetUserId: 'user-2',
                })
            );

            expect(created.caseNumber).toBe(8);
        } finally {
            await client.close();
            await rm(dataDir, { recursive: true, force: true });
        }
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
    return createPgliteTestDatabase('moderation');
}

async function applySqlMigrationsBeforeCaseCounters(client: PGlite): Promise<void> {
    for (const fileName of [
        '0000_cynical_cannonball.sql',
        '0001_curved_roland_deschain.sql',
        '0002_refine_installation_feature_settings.sql',
        '0003_smooth_proudstar.sql',
        '0004_polite_captain_flint.sql',
        '0005_guild_defcon_policy.sql',
        '0006_spicy_dazzler.sql',
        '0007_dashboard_live_events.sql',
        '0008_handy_texas_twister.sql',
        '0009_dashboard_audit_events.sql',
        '0010_growth_overview_foundation.sql',
        '0011_command_access_targets.sql',
    ]) {
        await applySqlMigration(client, fileName);
    }
}

async function applySqlMigration(client: PGlite, fileName: string): Promise<void> {
    const sqlText = await readFile(join(migrationsFolder, fileName), 'utf8');
    const statements = sqlText
        .split('--> statement-breakpoint')
        .map((statement) => statement.trim())
        .filter(Boolean);

    for (const statement of statements) {
        await client.query(statement);
    }
}

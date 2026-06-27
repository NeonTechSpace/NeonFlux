import { randomUUID } from 'node:crypto';
import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
    deleteAutomodRule,
    listAutomodEventsByGuildId,
    listAutomodRulesByGuildId,
    listEnabledAutomodRulesByGuildId,
    recordAutomodEvent,
    saveAutomodRule,
    updateAutomodEventStatus,
} from './automod.js';
import { upsertGuild } from './guilds.js';
import * as schema from './schema.js';

const projectRoot = fileURLToPath(new URL('../../..', import.meta.url));
const migrationsFolder = join(projectRoot, 'packages', 'db', 'drizzle');
const testDataRoot = join(projectRoot, 'data', 'pglite-automod-test');

let testDatabase: TestDatabase | undefined;

describe('automod repository', () => {
    beforeEach(async () => {
        testDatabase = await createTestDatabase();
        await expectOk(upsertGuild(getDb(), { guildId: 'guild-1' }));
        await expectOk(upsertGuild(getDb(), { guildId: 'guild-2' }));
    });

    afterEach(async () => {
        await testDatabase?.close();
        testDatabase = undefined;
    });

    it('saves guild-scoped rules and lists enabled rules only', async () => {
        const created = await expectOk(
            saveAutomodRule(getDb(), {
                guildId: 'guild-1',
                name: 'Blocked terms',
                triggerType: 'blocked_terms',
                config: { terms: ['spam', 'spam', 'phish'] },
            })
        );
        const updated = await expectOk(
            saveAutomodRule(getDb(), {
                guildId: 'guild-1',
                ruleId: created.id,
                name: 'Blocked terms',
                triggerType: 'blocked_terms',
                enabled: false,
                config: { terms: ['scam'] },
            })
        );
        await expectOk(
            saveAutomodRule(getDb(), {
                guildId: 'guild-1',
                name: 'Invite links',
                triggerType: 'invite_links',
            })
        );
        await expectOk(
            saveAutomodRule(getDb(), {
                guildId: 'guild-2',
                name: 'Other guild',
                triggerType: 'invite_links',
            })
        );

        const all = await expectOk(listAutomodRulesByGuildId(getDb(), { guildId: 'guild-1' }));
        const enabled = await expectOk(listEnabledAutomodRulesByGuildId(getDb(), { guildId: 'guild-1' }));

        expect(updated.id).toBe(created.id);
        expect(all.map((rule) => [rule.name, rule.triggerType, rule.enabled])).toStrictEqual([
            ['Invite links', 'invite_links', true],
            ['Blocked terms', 'blocked_terms', false],
        ]);
        expect(enabled.map((rule) => rule.name)).toStrictEqual(['Invite links']);
        expect(updated.config).toStrictEqual({ terms: ['scam'] });
    });

    it('records match events without storing raw message content', async () => {
        const rule = await expectOk(
            saveAutomodRule(getDb(), {
                guildId: 'guild-1',
                name: 'Blocked terms',
                triggerType: 'blocked_terms',
                config: { terms: ['spam'] },
            })
        );
        const event = await expectOk(
            recordAutomodEvent(getDb(), {
                guildId: 'guild-1',
                ruleId: rule.id,
                messageId: 'message-1',
                channelId: 'channel-1',
                authorUserId: 'user-1',
                triggerType: 'blocked_terms',
                details: {
                    matchedTermCount: 1,
                    matchedTerms: ['spam'],
                },
            })
        );

        const events = await expectOk(listAutomodEventsByGuildId(getDb(), { guildId: 'guild-1' }));

        expect(event.status).toBe('recorded');
        expect(events).toHaveLength(1);
        expect(events[0]?.details).toStrictEqual({
            matchedTermCount: 1,
            matchedTerms: ['spam'],
        });
    });

    it('saves timeout action config and updates enforcement event status', async () => {
        const rule = await expectOk(
            saveAutomodRule(getDb(), {
                guildId: 'guild-1',
                name: 'Timeout invites',
                triggerType: 'invite_links',
                actionType: 'timeout',
                config: { timeoutDurationSeconds: 600 },
            })
        );
        const event = await expectOk(
            recordAutomodEvent(getDb(), {
                guildId: 'guild-1',
                ruleId: rule.id,
                messageId: 'message-1',
                channelId: 'channel-1',
                authorUserId: 'user-1',
                triggerType: 'invite_links',
                actionType: 'timeout',
                status: 'pending_enforcement',
            })
        );

        const updated = await expectOk(
            updateAutomodEventStatus(getDb(), {
                eventId: event.id,
                status: 'enforced',
                details: {
                    timeoutDurationSeconds: 600,
                },
            })
        );

        expect(rule.config).toStrictEqual({ timeoutDurationSeconds: 600 });
        expect(updated.status).toBe('enforced');
        expect(updated.details).toStrictEqual({ timeoutDurationSeconds: 600 });
    });

    it('saves warn action rules with normalized ignore lists', async () => {
        const rule = await expectOk(
            saveAutomodRule(getDb(), {
                guildId: 'guild-1',
                name: 'Warn terms',
                triggerType: 'blocked_terms',
                actionType: 'warn',
                config: {
                    terms: ['spam'],
                    ignoredChannelIds: [' channel-1 ', 'channel-1'],
                    ignoredRoleIds: ['role-1'],
                    ignoredUserIds: ['user-1'],
                },
            })
        );

        expect(rule.actionType).toBe('warn');
        expect(rule.config).toStrictEqual({
            terms: ['spam'],
            ignoredChannelIds: ['channel-1'],
            ignoredRoleIds: ['role-1'],
            ignoredUserIds: ['user-1'],
        });
    });

    it('rejects invalid rules and deletes by guild-owned rule id', async () => {
        const invalid = await saveAutomodRule(getDb(), {
            guildId: 'guild-1',
            name: ' ',
            triggerType: 'blocked_terms',
            config: { terms: [] },
        });
        const rule = await expectOk(
            saveAutomodRule(getDb(), {
                guildId: 'guild-1',
                name: 'Invite links',
                triggerType: 'invite_links',
            })
        );

        const deleted = await expectOk(deleteAutomodRule(getDb(), { guildId: 'guild-1', ruleId: rule.id }));
        const missing = await deleteAutomodRule(getDb(), { guildId: 'guild-1', ruleId: rule.id });

        expect(invalid.isErr()).toBe(true);
        expect(invalid._unsafeUnwrapErr()).toStrictEqual({ type: 'missing-input', field: 'name' });
        expect(deleted.id).toBe(rule.id);
        expect(missing.isErr()).toBe(true);
        expect(missing._unsafeUnwrapErr()).toStrictEqual({ type: 'not-found' });
    });

    it('rejects invalid timeout durations', async () => {
        const invalid = await saveAutomodRule(getDb(), {
            guildId: 'guild-1',
            name: 'Invalid timeout',
            triggerType: 'invite_links',
            actionType: 'timeout',
            config: { timeoutDurationSeconds: 10 },
        });

        expect(invalid.isErr()).toBe(true);
        expect(invalid._unsafeUnwrapErr()).toStrictEqual({
            type: 'invalid-value',
            field: 'config.timeoutDurationSeconds',
        });
    });
});

async function expectOk<TValue>(promise: Promise<{ isOk(): boolean; _unsafeUnwrap(): TValue }>): Promise<TValue> {
    const result = await promise;

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

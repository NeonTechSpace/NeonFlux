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
import {
    listAllBotActionEventsByGuildId,
    listBotActionEventPageByGuildId,
    listBotActionEventsByGuildId,
    recordBotActionEvent,
} from './logging.js';
import { recordPostedMessage } from './posting.js';
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

    it('records dashboard posted messages idempotently', async () => {
        const first = await expectOk(
            recordPostedMessage(getDb(), {
                guildId: 'guild-1',
                channelId: 'channel-1',
                messageId: 'message-1',
                createdByUserId: 'user-1',
                purpose: 'dashboard',
            })
        );
        const second = await expectOk(
            recordPostedMessage(getDb(), {
                guildId: 'guild-1',
                channelId: 'channel-1',
                messageId: 'message-1',
                createdByUserId: 'user-2',
                purpose: 'dashboard',
            })
        );

        expect(second.id).toBe(first.id);
        expect(second).toMatchObject({
            guildId: 'guild-1',
            channelId: 'channel-1',
            messageId: 'message-1',
            createdByUserId: 'user-2',
            purpose: 'dashboard',
        });
    });

    it('records and lists guild-scoped dashboard audit events', async () => {
        await createGuild('guild-2');
        await expectOk(
            recordBotActionEvent(getDb(), {
                guildId: 'guild-1',
                feature: 'posting',
                action: 'message.sent',
                actorUserId: 'user-1',
                targetId: 'message-1',
                metadata: {
                    channelId: 'channel-1',
                    messageId: 'message-1',
                    contentLength: 5,
                    embedCount: 0,
                    source: 'dashboard',
                },
            })
        );
        await expectOk(
            recordBotActionEvent(getDb(), {
                guildId: 'guild-2',
                feature: 'posting',
                action: 'message.sent',
                actorUserId: 'user-2',
                targetId: 'message-2',
            })
        );

        const events = await expectOk(
            listBotActionEventsByGuildId(getDb(), {
                guildId: 'guild-1',
                feature: 'posting',
                limit: 1,
            })
        );

        expect(events).toHaveLength(1);
        expect(events[0]).toMatchObject({
            guildId: 'guild-1',
            feature: 'posting',
            action: 'message.sent',
            actorUserId: 'user-1',
            targetId: 'message-1',
            metadata: {
                channelId: 'channel-1',
                messageId: 'message-1',
                contentLength: 5,
                embedCount: 0,
                source: 'dashboard',
            },
        });
    });

    it('lists all persisted guild dashboard audit events without the recent-event cap', async () => {
        for (let index = 0; index < 30; index += 1) {
            await expectOk(
                recordBotActionEvent(getDb(), {
                    guildId: 'guild-1',
                    feature: 'posting',
                    action: 'message.sent',
                    targetId: `message-${String(index)}`,
                })
            );
        }

        const events = await expectOk(listAllBotActionEventsByGuildId(getDb(), { guildId: 'guild-1' }));

        expect(events).toHaveLength(30);
        expect(events.map((event) => event.targetId)).toContain('message-0');
        expect(events.map((event) => event.targetId)).toContain('message-29');
    });

    it('pages persisted guild dashboard audit events and searches fuzzy text', async () => {
        for (let index = 0; index < 8; index += 1) {
            await expectOk(
                recordBotActionEvent(getDb(), {
                    guildId: 'guild-1',
                    feature: index % 2 === 0 ? 'posting' : 'settings',
                    action: index % 2 === 0 ? 'message.sent' : 'prefix.updated',
                    actorUserId: `actor-${String(index)}`,
                    targetId: index % 2 === 0 ? `channel-${String(index)}` : `prefix-${String(index)}`,
                    metadata:
                        index % 2 === 0
                            ? {
                                  channelId: `channel-${String(index)}`,
                                  source: 'dashboard',
                              }
                            : {
                                  source: 'dashboard',
                              },
                })
            );
        }

        const firstPage = await expectOk(
            listBotActionEventPageByGuildId(getDb(), {
                guildId: 'guild-1',
                limit: 3,
            })
        );

        expect(firstPage.records).toHaveLength(3);
        expect(firstPage.nextCursor).toBeTruthy();

        if (!firstPage.nextCursor) {
            throw new Error('Expected first audit page to include a cursor.');
        }

        const secondPage = await expectOk(
            listBotActionEventPageByGuildId(getDb(), {
                guildId: 'guild-1',
                cursor: firstPage.nextCursor,
                limit: 3,
            })
        );
        const firstPageIds = new Set(firstPage.records.map((event) => event.id));

        expect(secondPage.records).toHaveLength(3);
        expect(secondPage.records.every((event) => !firstPageIds.has(event.id))).toBe(true);

        const fuzzyMatches = await expectOk(
            listBotActionEventPageByGuildId(getDb(), {
                guildId: 'guild-1',
                search: 'chnl0 actor0',
                limit: 10,
            })
        );

        expect(fuzzyMatches.records).toHaveLength(1);
        expect(fuzzyMatches.records.every((event) => event.feature === 'posting')).toBe(true);
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

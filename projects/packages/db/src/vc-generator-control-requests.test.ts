import { randomUUID } from 'node:crypto';
import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PGlite } from '@electric-sql/pglite';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { upsertGuild } from './guilds.js';
import * as schema from './schema.js';
import {
    createVcGeneratorControlRequest,
    expirePendingVcGeneratorControlRequests,
    findActiveGeneratedVoiceChannelByOwner,
    findPendingVcGeneratorControlRequest,
    updateVcGeneratorControlRequest,
} from './vc-generator-control-requests.js';
import { upsertGeneratedVoiceChannel, upsertVcGeneratorRule } from './vc-generator.js';

const projectRoot = fileURLToPath(new URL('../../..', import.meta.url));
const migrationsFolder = join(projectRoot, 'packages', 'db', 'drizzle');
const testDataRoot = join(projectRoot, 'data', 'pglite-vc-generator-control-test');

let testDatabase: TestDatabase | undefined;

describe('VC generator control request repository', () => {
    beforeEach(async () => {
        testDatabase = await createTestDatabase();
        await expectOk(upsertGuild(getDb(), { guildId: 'guild-1' }));
    });

    afterEach(async () => {
        await testDatabase?.close();
        testDatabase = undefined;
    });

    it('finds active generated channels by owner and rule', async () => {
        const rule = await createRule();
        await expectOk(
            upsertGeneratedVoiceChannel(getDb(), {
                guildId: 'guild-1',
                ruleId: rule.id,
                channelId: 'generated-1',
                ownerUserId: 'user-1',
            })
        );
        await expectOk(
            upsertGeneratedVoiceChannel(getDb(), {
                guildId: 'guild-1',
                ruleId: rule.id,
                channelId: 'generated-2',
                ownerUserId: 'user-2',
                status: 'orphaned',
            })
        );

        const found = await expectOk(
            findActiveGeneratedVoiceChannelByOwner(getDb(), {
                guildId: 'guild-1',
                ownerUserId: 'user-1',
                ruleId: rule.id,
            })
        );
        const missing = await findActiveGeneratedVoiceChannelByOwner(getDb(), {
            guildId: 'guild-1',
            ownerUserId: 'user-2',
            ruleId: rule.id,
        });

        expect(found.channelId).toBe('generated-1');
        expect(missing.isErr()).toBe(true);
        expect(missing._unsafeUnwrapErr()).toStrictEqual({ type: 'not-found' });
    });

    it('creates, finds, and completes pending control requests', async () => {
        const generated = await createGeneratedChannel();
        const expiresAt = new Date('2026-06-26T12:10:00.000Z');
        const request = await expectOk(
            createVcGeneratorControlRequest(getDb(), {
                guildId: 'guild-1',
                generatedChannelId: generated.id,
                panelChannelId: 'panel-channel-1',
                targetChannelId: 'generated-1',
                requesterUserId: 'user-1',
                controlAction: 'rename',
                expiresAt,
            })
        );
        const pending = await expectOk(
            findPendingVcGeneratorControlRequest(getDb(), {
                guildId: 'guild-1',
                panelChannelId: 'panel-channel-1',
                requesterUserId: 'user-1',
            })
        );
        const applied = await expectOk(
            updateVcGeneratorControlRequest(getDb(), {
                requestId: request.id,
                status: 'applied',
                promptMessageId: 'prompt-1',
                value: 'New Room',
            })
        );
        const missingAfterApply = await findPendingVcGeneratorControlRequest(getDb(), {
            guildId: 'guild-1',
            panelChannelId: 'panel-channel-1',
            requesterUserId: 'user-1',
        });

        expect(pending.id).toBe(request.id);
        expect(pending.expiresAt).toStrictEqual(expiresAt);
        expect(applied).toMatchObject({
            status: 'applied',
            promptMessageId: 'prompt-1',
            value: 'New Room',
        });
        expect(applied.completedAt).toBeInstanceOf(Date);
        expect(missingAfterApply.isErr()).toBe(true);
        expect(missingAfterApply._unsafeUnwrapErr()).toStrictEqual({ type: 'not-found' });
    });

    it('replaces older pending requests for the same panel and requester', async () => {
        const generated = await createGeneratedChannel();
        const first = await expectOk(
            createVcGeneratorControlRequest(getDb(), {
                guildId: 'guild-1',
                generatedChannelId: generated.id,
                panelChannelId: 'panel-channel-1',
                targetChannelId: 'generated-1',
                requesterUserId: 'user-1',
                controlAction: 'rename',
                expiresAt: new Date('2026-06-26T12:10:00.000Z'),
            })
        );
        const second = await expectOk(
            createVcGeneratorControlRequest(getDb(), {
                guildId: 'guild-1',
                generatedChannelId: generated.id,
                panelChannelId: 'panel-channel-1',
                targetChannelId: 'generated-1',
                requesterUserId: 'user-1',
                controlAction: 'user_limit',
                expiresAt: new Date('2026-06-26T12:20:00.000Z'),
            })
        );
        const pending = await expectOk(
            findPendingVcGeneratorControlRequest(getDb(), {
                guildId: 'guild-1',
                panelChannelId: 'panel-channel-1',
                requesterUserId: 'user-1',
            })
        );
        const replacedRows = await getDb()
            .select()
            .from(schema.vcGeneratorControlRequests)
            .where(eq(schema.vcGeneratorControlRequests.id, first.id))
            .limit(1);
        const replaced = replacedRows[0];

        expect(pending.id).toBe(second.id);
        if (!replaced) {
            throw new Error('Expected replaced control request row.');
        }
        expect(replaced.status).toBe('cancelled');
        expect(replaced.errorMessage).toBe('replaced-by-new-request');
    });

    it('rejects invalid control request input before writing', async () => {
        const generated = await createGeneratedChannel();
        const invalidAction = await createVcGeneratorControlRequest(getDb(), {
            guildId: 'guild-1',
            generatedChannelId: generated.id,
            panelChannelId: 'panel-channel-1',
            targetChannelId: 'generated-1',
            requesterUserId: 'user-1',
            controlAction: 'dance',
            expiresAt: new Date('2026-06-26T12:10:00.000Z'),
        });
        const invalidStatus = await updateVcGeneratorControlRequest(getDb(), {
            requestId: generated.id,
            status: 'sleeping',
        });

        expect(invalidAction.isErr()).toBe(true);
        expect(invalidAction._unsafeUnwrapErr()).toStrictEqual({
            type: 'invalid-value',
            field: 'controlAction',
        });
        expect(invalidStatus.isErr()).toBe(true);
        expect(invalidStatus._unsafeUnwrapErr()).toStrictEqual({
            type: 'invalid-value',
            field: 'status',
        });
    });

    it('expires due pending control requests in bounded batches', async () => {
        const generated = await createGeneratedChannel();
        const now = new Date('2026-06-26T12:15:00.000Z');
        const expiredFirst = await expectOk(
            createVcGeneratorControlRequest(getDb(), {
                guildId: 'guild-1',
                generatedChannelId: generated.id,
                panelChannelId: 'panel-channel-1',
                targetChannelId: 'generated-1',
                requesterUserId: 'user-1',
                controlAction: 'rename',
                expiresAt: new Date('2026-06-26T12:00:00.000Z'),
            })
        );
        const expiredSecond = await expectOk(
            createVcGeneratorControlRequest(getDb(), {
                guildId: 'guild-1',
                generatedChannelId: generated.id,
                panelChannelId: 'panel-channel-2',
                targetChannelId: 'generated-1',
                requesterUserId: 'user-2',
                controlAction: 'rename',
                expiresAt: new Date('2026-06-26T12:05:00.000Z'),
            })
        );
        await expectOk(
            createVcGeneratorControlRequest(getDb(), {
                guildId: 'guild-1',
                generatedChannelId: generated.id,
                panelChannelId: 'panel-channel-3',
                targetChannelId: 'generated-1',
                requesterUserId: 'user-3',
                controlAction: 'rename',
                expiresAt: new Date('2026-06-26T12:30:00.000Z'),
            })
        );

        const expired = await expectOk(expirePendingVcGeneratorControlRequests(getDb(), { now, limit: 1 }));

        expect(expired).toHaveLength(1);
        expect(expired[0]).toMatchObject({
            id: expiredFirst.id,
            status: 'expired',
            errorMessage: 'expired-by-maintenance',
            completedAt: now,
        });

        const firstLookup = await findPendingVcGeneratorControlRequest(getDb(), {
            guildId: 'guild-1',
            panelChannelId: 'panel-channel-1',
            requesterUserId: 'user-1',
        });
        const secondLookup = await expectOk(
            findPendingVcGeneratorControlRequest(getDb(), {
                guildId: 'guild-1',
                panelChannelId: 'panel-channel-2',
                requesterUserId: 'user-2',
            })
        );

        expect(firstLookup.isErr()).toBe(true);
        expect(secondLookup.id).toBe(expiredSecond.id);
    });

    it('does not expire completed or future control requests', async () => {
        const generated = await createGeneratedChannel();
        const future = await expectOk(
            createVcGeneratorControlRequest(getDb(), {
                guildId: 'guild-1',
                generatedChannelId: generated.id,
                panelChannelId: 'panel-channel-1',
                targetChannelId: 'generated-1',
                requesterUserId: 'user-1',
                controlAction: 'rename',
                expiresAt: new Date('2026-06-26T12:30:00.000Z'),
            })
        );
        const applied = await expectOk(
            createVcGeneratorControlRequest(getDb(), {
                guildId: 'guild-1',
                generatedChannelId: generated.id,
                panelChannelId: 'panel-channel-2',
                targetChannelId: 'generated-1',
                requesterUserId: 'user-2',
                controlAction: 'rename',
                status: 'applied',
                expiresAt: new Date('2026-06-26T12:00:00.000Z'),
            })
        );

        const expired = await expectOk(
            expirePendingVcGeneratorControlRequests(getDb(), {
                now: new Date('2026-06-26T12:15:00.000Z'),
            })
        );

        const futureLookup = await expectOk(
            findPendingVcGeneratorControlRequest(getDb(), {
                guildId: 'guild-1',
                panelChannelId: 'panel-channel-1',
                requesterUserId: 'user-1',
            })
        );
        const appliedRows = await getDb()
            .select()
            .from(schema.vcGeneratorControlRequests)
            .where(eq(schema.vcGeneratorControlRequests.id, applied.id))
            .limit(1);

        expect(expired).toHaveLength(0);
        expect(futureLookup.id).toBe(future.id);
        expect(appliedRows[0]?.status).toBe('applied');
    });
});

async function createRule() {
    return expectOk(
        upsertVcGeneratorRule(getDb(), {
            guildId: 'guild-1',
            sourceChannelId: 'voice-source-1',
            categoryId: 'category-1',
            nameTemplate: '{user} room',
            enabled: true,
        })
    );
}

async function createGeneratedChannel() {
    const rule = await createRule();

    return expectOk(
        upsertGeneratedVoiceChannel(getDb(), {
            guildId: 'guild-1',
            ruleId: rule.id,
            channelId: 'generated-1',
            ownerUserId: 'user-1',
        })
    );
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

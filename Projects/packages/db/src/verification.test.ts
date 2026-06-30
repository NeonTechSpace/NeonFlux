import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createPgliteTestDatabase, type PgliteTestDatabase } from '../test-support/pglite-test-database.js';

import { upsertGuild } from './guilds.js';
import {
    deleteVerificationFlow,
    findActiveVerificationRecord,
    findEnabledVerificationFlowByReaction,
    listVerificationFlowsByGuildId,
    revokeVerificationRecord,
    upsertVerificationFlow,
    upsertVerificationRecord,
} from './verification.js';

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

describe('verification repository', () => {
    beforeEach(async () => {
        await expectOk(upsertGuild(getDb(), { guildId: 'guild-1' }));
        await expectOk(upsertGuild(getDb(), { guildId: 'guild-2' }));
    });

    it('upserts and lists guild-scoped verification flows', async () => {
        const created = await expectOk(
            upsertVerificationFlow(getDb(), {
                guildId: 'guild-1',
                channelId: 'channel-1',
                messageId: 'message-1',
                emojiKey: 'unicode:check',
                verifiedRoleId: 'role-1',
            })
        );
        const updated = await expectOk(
            upsertVerificationFlow(getDb(), {
                guildId: 'guild-1',
                channelId: 'channel-2',
                messageId: 'message-1',
                emojiKey: 'unicode:star',
                verifiedRoleId: 'role-2',
                enabled: false,
            })
        );
        await expectOk(
            upsertVerificationFlow(getDb(), {
                guildId: 'guild-2',
                channelId: 'channel-1',
                messageId: 'message-1',
                emojiKey: 'unicode:check',
                verifiedRoleId: 'role-1',
            })
        );

        const all = await expectOk(listVerificationFlowsByGuildId(getDb(), { guildId: 'guild-1' }));
        const enabled = await expectOk(listVerificationFlowsByGuildId(getDb(), { guildId: 'guild-1', enabled: true }));

        expect(updated.id).toBe(created.id);
        expect(
            all.map((flow) => [flow.channelId, flow.messageId, flow.emojiKey, flow.verifiedRoleId, flow.enabled])
        ).toStrictEqual([['channel-2', 'message-1', 'unicode:star', 'role-2', false]]);
        expect(enabled).toHaveLength(0);
    });

    it('finds enabled verification flows by reaction', async () => {
        await expectOk(
            upsertVerificationFlow(getDb(), {
                guildId: 'guild-1',
                channelId: 'channel-1',
                messageId: 'message-1',
                emojiKey: 'unicode:check',
                verifiedRoleId: 'role-1',
            })
        );

        const match = await expectOk(
            findEnabledVerificationFlowByReaction(getDb(), {
                guildId: 'guild-1',
                messageId: 'message-1',
                emojiKey: 'unicode:check',
            })
        );
        const missing = await findEnabledVerificationFlowByReaction(getDb(), {
            guildId: 'guild-1',
            messageId: 'message-1',
            emojiKey: 'unicode:star',
        });

        expect(match.verifiedRoleId).toBe('role-1');
        expect(missing.isErr()).toBe(true);
        expect(missing._unsafeUnwrapErr()).toStrictEqual({ type: 'not-found' });
    });

    it('deletes one verification flow by guild and message', async () => {
        await expectOk(
            upsertVerificationFlow(getDb(), {
                guildId: 'guild-1',
                channelId: 'channel-1',
                messageId: 'message-1',
                emojiKey: 'unicode:check',
                verifiedRoleId: 'role-1',
            })
        );

        const deleted = await expectOk(deleteVerificationFlow(getDb(), { guildId: 'guild-1', messageId: 'message-1' }));
        const flows = await expectOk(listVerificationFlowsByGuildId(getDb(), { guildId: 'guild-1' }));

        expect(deleted.messageId).toBe('message-1');
        expect(flows).toHaveLength(0);
    });

    it('upserts, finds, revokes, and reactivates verification records', async () => {
        const verified = await expectOk(
            upsertVerificationRecord(getDb(), {
                guildId: 'guild-1',
                userId: 'user-1',
                method: 'reaction',
            })
        );
        const active = await expectOk(findActiveVerificationRecord(getDb(), { guildId: 'guild-1', userId: 'user-1' }));
        const revoked = await expectOk(revokeVerificationRecord(getDb(), { guildId: 'guild-1', userId: 'user-1' }));
        const missing = await findActiveVerificationRecord(getDb(), { guildId: 'guild-1', userId: 'user-1' });
        const reactivated = await expectOk(
            upsertVerificationRecord(getDb(), {
                guildId: 'guild-1',
                userId: 'user-1',
                method: 'reaction',
            })
        );

        expect(active.id).toBe(verified.id);
        expect(revoked.revokedAt).toBeInstanceOf(Date);
        expect(missing.isErr()).toBe(true);
        expect(missing._unsafeUnwrapErr()).toStrictEqual({ type: 'not-found' });
        expect(reactivated.id).toBe(verified.id);
        expect(reactivated.revokedAt).toBeNull();
    });

    it('rejects blank verification flow input', async () => {
        const result = await upsertVerificationFlow(getDb(), {
            guildId: 'guild-1',
            channelId: 'channel-1',
            messageId: 'message-1',
            emojiKey: ' ',
            verifiedRoleId: 'role-1',
        });

        expect(result.isErr()).toBe(true);
        expect(result._unsafeUnwrapErr()).toStrictEqual({
            type: 'missing-input',
            field: 'emojiKey',
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
    return createPgliteTestDatabase('verification');
}

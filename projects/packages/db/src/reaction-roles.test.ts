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
import {
    deleteReactionRoleMessage,
    deleteReactionRoleOptionByMessage,
    findEnabledReactionRoleOptionByReaction,
    findReactionRoleMessage,
    listActiveReactionRoleAssignmentsByGuildMessageUser,
    listActiveReactionRoleAssignmentsByGuildUser,
    listReactionRoleMessagesByGuildId,
    markReactionRoleAssignmentRemoved,
    markReactionRoleAssignmentsRemovedByMessageUser,
    upsertReactionRoleAssignment,
    upsertReactionRoleMessage,
    upsertReactionRoleOptionByMessage,
} from './reaction-roles.js';
import * as schema from './schema.js';

const projectRoot = fileURLToPath(new URL('../../..', import.meta.url));
const migrationsFolder = join(projectRoot, 'packages', 'db', 'drizzle');
const testDataRoot = join(projectRoot, 'data', 'pglite-reaction-roles-test');

let testDatabase: TestDatabase | undefined;

describe('reaction role repository', () => {
    beforeEach(async () => {
        testDatabase = await createTestDatabase();
        await expectOk(upsertGuild(getDb(), { guildId: 'guild-1' }));
        await expectOk(upsertGuild(getDb(), { guildId: 'guild-2' }));
    });

    afterEach(async () => {
        await testDatabase?.close();
        testDatabase = undefined;
    });

    it('upserts and lists guild-scoped reaction-role messages with options', async () => {
        const created = await expectOk(
            upsertReactionRoleMessage(getDb(), {
                guildId: 'guild-1',
                channelId: 'channel-1',
                messageId: 'message-1',
            })
        );
        const updated = await expectOk(
            upsertReactionRoleMessage(getDb(), {
                guildId: 'guild-1',
                channelId: 'channel-2',
                messageId: 'message-1',
                mode: 'exclusive',
                source: 'dashboard',
                messageContent: 'Pick one',
                messageEmbeds: [{ description: 'Choose wisely' }],
                generateOverview: true,
                enabled: false,
            })
        );
        await expectOk(
            upsertReactionRoleOptionByMessage(getDb(), {
                guildId: 'guild-1',
                messageId: 'message-1',
                emojiKey: 'unicode:check',
                roleId: 'role-1',
                position: 2,
            })
        );
        await expectOk(
            upsertReactionRoleOptionByMessage(getDb(), {
                guildId: 'guild-1',
                messageId: 'message-1',
                emojiKey: 'custom:party:123',
                roleId: 'role-2',
                position: 1,
            })
        );
        await expectOk(
            upsertReactionRoleMessage(getDb(), {
                guildId: 'guild-2',
                channelId: 'other-channel',
                messageId: 'message-1',
            })
        );

        const messages = await expectOk(listReactionRoleMessagesByGuildId(getDb(), { guildId: 'guild-1' }));

        expect(updated.id).toBe(created.id);
        expect(messages).toHaveLength(1);
        expect(messages[0]).toMatchObject({
            guildId: 'guild-1',
            channelId: 'channel-2',
            messageId: 'message-1',
            mode: 'exclusive',
            source: 'dashboard',
            messageContent: 'Pick one',
            messageEmbeds: [{ description: 'Choose wisely' }],
            generateOverview: true,
            enabled: false,
        });
        expect(messages[0]?.options.map((option) => [option.emojiKey, option.roleId])).toStrictEqual([
            ['custom:party:123', 'role-2'],
            ['unicode:check', 'role-1'],
        ]);
    });

    it('finds an enabled reaction option by public reaction IDs', async () => {
        await expectOk(
            upsertReactionRoleMessage(getDb(), {
                guildId: 'guild-1',
                channelId: 'channel-1',
                messageId: 'message-1',
            })
        );
        await expectOk(
            upsertReactionRoleOptionByMessage(getDb(), {
                guildId: 'guild-1',
                messageId: 'message-1',
                emojiKey: 'unicode:check',
                roleId: 'role-1',
            })
        );

        const match = await expectOk(
            findEnabledReactionRoleOptionByReaction(getDb(), {
                guildId: 'guild-1',
                messageId: 'message-1',
                emojiKey: 'unicode:check',
            })
        );
        const missingGuild = await findEnabledReactionRoleOptionByReaction(getDb(), {
            guildId: 'guild-2',
            messageId: 'message-1',
            emojiKey: 'unicode:check',
        });

        expect(match.message.channelId).toBe('channel-1');
        expect(match.option.roleId).toBe('role-1');
        expect(missingGuild.isErr()).toBe(true);
        expect(missingGuild._unsafeUnwrapErr()).toStrictEqual({ type: 'not-found' });
    });

    it('does not match disabled or stale reaction-role messages', async () => {
        await expectOk(
            upsertReactionRoleMessage(getDb(), {
                guildId: 'guild-1',
                channelId: 'channel-1',
                messageId: 'disabled-message',
                enabled: false,
            })
        );
        await expectOk(
            upsertReactionRoleOptionByMessage(getDb(), {
                guildId: 'guild-1',
                messageId: 'disabled-message',
                emojiKey: 'unicode:check',
                roleId: 'role-1',
            })
        );
        const staleMessage = await expectOk(
            upsertReactionRoleMessage(getDb(), {
                guildId: 'guild-1',
                channelId: 'channel-1',
                messageId: 'stale-message',
            })
        );
        await expectOk(
            upsertReactionRoleOptionByMessage(getDb(), {
                guildId: 'guild-1',
                messageId: 'stale-message',
                emojiKey: 'unicode:check',
                roleId: 'role-1',
            })
        );
        await getDb()
            .update(schema.reactionRoleMessages)
            .set({ staleAt: new Date('2026-06-27T00:00:00.000Z') })
            .where(eq(schema.reactionRoleMessages.id, staleMessage.id));

        const disabled = await findEnabledReactionRoleOptionByReaction(getDb(), {
            guildId: 'guild-1',
            messageId: 'disabled-message',
            emojiKey: 'unicode:check',
        });
        const stale = await findEnabledReactionRoleOptionByReaction(getDb(), {
            guildId: 'guild-1',
            messageId: 'stale-message',
            emojiKey: 'unicode:check',
        });

        expect(disabled.isErr()).toBe(true);
        expect(disabled._unsafeUnwrapErr()).toStrictEqual({ type: 'not-found' });
        expect(stale.isErr()).toBe(true);
        expect(stale._unsafeUnwrapErr()).toStrictEqual({ type: 'not-found' });
    });

    it('deletes options and cascades options when a message is deleted', async () => {
        await expectOk(
            upsertReactionRoleMessage(getDb(), {
                guildId: 'guild-1',
                channelId: 'channel-1',
                messageId: 'message-1',
            })
        );
        await expectOk(
            upsertReactionRoleOptionByMessage(getDb(), {
                guildId: 'guild-1',
                messageId: 'message-1',
                emojiKey: 'unicode:check',
                roleId: 'role-1',
            })
        );
        await expectOk(
            upsertReactionRoleOptionByMessage(getDb(), {
                guildId: 'guild-1',
                messageId: 'message-1',
                emojiKey: 'unicode:star',
                roleId: 'role-2',
            })
        );

        const deletedOption = await expectOk(
            deleteReactionRoleOptionByMessage(getDb(), {
                guildId: 'guild-1',
                messageId: 'message-1',
                emojiKey: 'unicode:star',
            })
        );
        await expectOk(deleteReactionRoleMessage(getDb(), { guildId: 'guild-1', messageId: 'message-1' }));
        const messages = await expectOk(listReactionRoleMessagesByGuildId(getDb(), { guildId: 'guild-1' }));
        const missingMessage = await findReactionRoleMessage(getDb(), { guildId: 'guild-1', messageId: 'message-1' });

        expect(deletedOption.roleId).toBe('role-2');
        expect(messages).toHaveLength(0);
        expect(missingMessage.isErr()).toBe(true);
        expect(missingMessage._unsafeUnwrapErr()).toStrictEqual({ type: 'not-found' });
    });

    it('records assignment removal and reactivation', async () => {
        const assigned = await expectOk(
            upsertReactionRoleAssignment(getDb(), {
                guildId: 'guild-1',
                messageId: 'message-1',
                userId: 'user-1',
                roleId: 'role-1',
                emojiKey: 'unicode:check',
            })
        );
        const removed = await expectOk(
            markReactionRoleAssignmentRemoved(getDb(), {
                guildId: 'guild-1',
                messageId: 'message-1',
                userId: 'user-1',
                roleId: 'role-1',
            })
        );
        const reactivated = await expectOk(
            upsertReactionRoleAssignment(getDb(), {
                guildId: 'guild-1',
                messageId: 'message-1',
                userId: 'user-1',
                roleId: 'role-1',
                emojiKey: 'unicode:check',
            })
        );

        expect(removed.id).toBe(assigned.id);
        expect(removed.removedAt).toBeInstanceOf(Date);
        expect(reactivated.id).toBe(assigned.id);
        expect(reactivated.removedAt).toBeNull();
        expect(reactivated.assignedAt.getTime()).toBeGreaterThanOrEqual(assigned.assignedAt.getTime());
    });

    it('lists active reaction-role assignments for member repair', async () => {
        await expectOk(
            upsertReactionRoleAssignment(getDb(), {
                guildId: 'guild-1',
                messageId: 'message-1',
                userId: 'user-1',
                roleId: 'role-2',
                emojiKey: 'unicode:two',
            })
        );
        await expectOk(
            upsertReactionRoleAssignment(getDb(), {
                guildId: 'guild-1',
                messageId: 'message-1',
                userId: 'user-1',
                roleId: 'role-1',
                emojiKey: 'unicode:one',
            })
        );
        await expectOk(
            upsertReactionRoleAssignment(getDb(), {
                guildId: 'guild-1',
                messageId: 'message-1',
                userId: 'user-2',
                roleId: 'role-3',
                emojiKey: 'unicode:three',
            })
        );
        await expectOk(
            markReactionRoleAssignmentRemoved(getDb(), {
                guildId: 'guild-1',
                messageId: 'message-1',
                userId: 'user-1',
                roleId: 'role-2',
            })
        );

        const active = await expectOk(
            listActiveReactionRoleAssignmentsByGuildUser(getDb(), {
                guildId: 'guild-1',
                userId: 'user-1',
            })
        );

        expect(active.map((assignment) => assignment.roleId)).toStrictEqual(['role-1']);
    });

    it('lists and removes active assignments for one reaction-role message user', async () => {
        await expectOk(
            upsertReactionRoleAssignment(getDb(), {
                guildId: 'guild-1',
                messageId: 'message-1',
                userId: 'user-1',
                roleId: 'role-2',
                emojiKey: 'unicode:two',
            })
        );
        await expectOk(
            upsertReactionRoleAssignment(getDb(), {
                guildId: 'guild-1',
                messageId: 'message-1',
                userId: 'user-1',
                roleId: 'role-1',
                emojiKey: 'unicode:one',
            })
        );
        await expectOk(
            upsertReactionRoleAssignment(getDb(), {
                guildId: 'guild-1',
                messageId: 'message-2',
                userId: 'user-1',
                roleId: 'role-3',
                emojiKey: 'unicode:three',
            })
        );

        const activeBefore = await expectOk(
            listActiveReactionRoleAssignmentsByGuildMessageUser(getDb(), {
                guildId: 'guild-1',
                messageId: 'message-1',
                userId: 'user-1',
            })
        );
        const removed = await expectOk(
            markReactionRoleAssignmentsRemovedByMessageUser(getDb(), {
                guildId: 'guild-1',
                messageId: 'message-1',
                userId: 'user-1',
            })
        );
        const activeAfter = await expectOk(
            listActiveReactionRoleAssignmentsByGuildMessageUser(getDb(), {
                guildId: 'guild-1',
                messageId: 'message-1',
                userId: 'user-1',
            })
        );
        const otherMessageActive = await expectOk(
            listActiveReactionRoleAssignmentsByGuildMessageUser(getDb(), {
                guildId: 'guild-1',
                messageId: 'message-2',
                userId: 'user-1',
            })
        );

        expect(activeBefore.map((assignment) => assignment.roleId).sort()).toStrictEqual(['role-1', 'role-2']);
        expect(removed).toHaveLength(2);
        expect(removed.every((assignment) => assignment.removedAt instanceof Date)).toBe(true);
        expect(activeAfter).toHaveLength(0);
        expect(otherMessageActive.map((assignment) => assignment.roleId)).toStrictEqual(['role-3']);
    });

    it('rejects blank reaction-role input', async () => {
        const result = await upsertReactionRoleMessage(getDb(), {
            guildId: 'guild-1',
            channelId: ' ',
            messageId: 'message-1',
        });

        expect(result.isErr()).toBe(true);
        expect(result._unsafeUnwrapErr()).toStrictEqual({
            type: 'missing-input',
            field: 'channelId',
        });
    });

    it('rejects invalid reaction-role mode and option position', async () => {
        const invalidMode = await upsertReactionRoleMessage(getDb(), {
            guildId: 'guild-1',
            channelId: 'channel-1',
            messageId: 'message-1',
            mode: 'additive' as never,
        });
        await expectOk(
            upsertReactionRoleMessage(getDb(), {
                guildId: 'guild-1',
                channelId: 'channel-1',
                messageId: 'message-1',
            })
        );
        const invalidPosition = await upsertReactionRoleOptionByMessage(getDb(), {
            guildId: 'guild-1',
            messageId: 'message-1',
            emojiKey: 'unicode:check',
            roleId: 'role-1',
            position: -1,
        });

        expect(invalidMode.isErr()).toBe(true);
        expect(invalidMode._unsafeUnwrapErr()).toStrictEqual({ type: 'invalid-value', field: 'mode' });
        expect(invalidPosition.isErr()).toBe(true);
        expect(invalidPosition._unsafeUnwrapErr()).toStrictEqual({ type: 'invalid-value', field: 'position' });
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

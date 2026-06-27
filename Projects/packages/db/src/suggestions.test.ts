import { randomUUID } from 'node:crypto';
import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { upsertGuild } from './guilds.js';
import * as schema from './schema.js';
import {
    createSuggestion,
    deleteSuggestionBoard,
    deleteSuggestionVote,
    findDefaultSuggestionBoardByGuildId,
    findSuggestionByGuildMessageId,
    findSuggestionVote,
    listSuggestionBoardsByGuildId,
    upsertSuggestionBoard,
    upsertSuggestionVote,
} from './suggestions.js';

const projectRoot = fileURLToPath(new URL('../../..', import.meta.url));
const migrationsFolder = join(projectRoot, 'packages', 'db', 'drizzle');
const testDataRoot = join(projectRoot, 'data', 'pglite-suggestions-test');

let testDatabase: TestDatabase | undefined;

describe('suggestions repository', () => {
    beforeEach(async () => {
        testDatabase = await createTestDatabase();
        await expectOk(upsertGuild(getDb(), { guildId: 'guild-1' }));
        await expectOk(upsertGuild(getDb(), { guildId: 'guild-2' }));
    });

    afterEach(async () => {
        await testDatabase?.close();
        testDatabase = undefined;
    });

    it('upserts, lists, and deletes guild-scoped suggestion boards', async () => {
        const created = await expectOk(
            upsertSuggestionBoard(getDb(), {
                guildId: 'guild-1',
                channelId: 'channel-1',
                name: 'ideas',
            })
        );
        const updated = await expectOk(
            upsertSuggestionBoard(getDb(), {
                guildId: 'guild-1',
                channelId: 'channel-2',
                name: 'ideas',
                enabled: false,
            })
        );
        await expectOk(
            upsertSuggestionBoard(getDb(), {
                guildId: 'guild-1',
                channelId: 'channel-3',
                name: 'features',
            })
        );
        await expectOk(
            upsertSuggestionBoard(getDb(), {
                guildId: 'guild-2',
                channelId: 'channel-1',
                name: 'ideas',
            })
        );

        const all = await expectOk(listSuggestionBoardsByGuildId(getDb(), { guildId: 'guild-1' }));
        const enabled = await expectOk(
            listSuggestionBoardsByGuildId(getDb(), {
                guildId: 'guild-1',
                enabledOnly: true,
            })
        );
        const deleted = await expectOk(
            deleteSuggestionBoard(getDb(), {
                guildId: 'guild-1',
                name: 'ideas',
            })
        );

        expect(updated.id).toBe(created.id);
        expect(all.map((board) => [board.name, board.channelId, board.enabled])).toStrictEqual([
            ['features', 'channel-3', true],
            ['ideas', 'channel-2', false],
        ]);
        expect(enabled.map((board) => board.name)).toStrictEqual(['features']);
        expect(deleted.id).toBe(created.id);
    });

    it('finds the default enabled board by guild', async () => {
        await expectOk(
            upsertSuggestionBoard(getDb(), {
                guildId: 'guild-1',
                channelId: 'channel-disabled',
                name: 'disabled',
                enabled: false,
            })
        );
        await expectOk(
            upsertSuggestionBoard(getDb(), {
                guildId: 'guild-1',
                channelId: 'channel-enabled',
                name: 'enabled',
            })
        );

        const found = await expectOk(findDefaultSuggestionBoardByGuildId(getDb(), { guildId: 'guild-1' }));
        const missing = await findDefaultSuggestionBoardByGuildId(getDb(), { guildId: 'guild-2' });

        expect(found.name).toBe('enabled');
        expect(missing.isErr()).toBe(true);
        expect(missing._unsafeUnwrapErr()).toStrictEqual({ type: 'not-found' });
    });

    it('creates suggestions with channel/message traceability and records votes', async () => {
        const board = await expectOk(
            upsertSuggestionBoard(getDb(), {
                guildId: 'guild-1',
                channelId: 'channel-1',
                name: 'ideas',
            })
        );
        const suggestion = await expectOk(
            createSuggestion(getDb(), {
                guildId: 'guild-1',
                boardId: board.id,
                channelId: 'channel-1',
                messageId: 'message-1',
                authorUserId: 'user-1',
                content: 'Add more neon.',
            })
        );
        const vote = await expectOk(
            upsertSuggestionVote(getDb(), {
                suggestionId: suggestion.id,
                userId: 'voter-1',
                vote: 'up',
            })
        );
        const updatedVote = await expectOk(
            upsertSuggestionVote(getDb(), {
                suggestionId: suggestion.id,
                userId: 'voter-1',
                vote: 'down',
            })
        );
        const foundSuggestion = await expectOk(
            findSuggestionByGuildMessageId(getDb(), {
                guildId: 'guild-1',
                messageId: 'message-1',
            })
        );
        const foundVote = await expectOk(
            findSuggestionVote(getDb(), {
                suggestionId: suggestion.id,
                userId: 'voter-1',
            })
        );
        const deletedVote = await expectOk(
            deleteSuggestionVote(getDb(), {
                suggestionId: suggestion.id,
                userId: 'voter-1',
            })
        );

        expect(foundSuggestion.id).toBe(suggestion.id);
        expect(vote.id).toBe(updatedVote.id);
        expect(foundVote.vote).toBe('down');
        expect(deletedVote.id).toBe(vote.id);
    });

    it('rejects blank board input and invalid vote values', async () => {
        const blankBoard = await upsertSuggestionBoard(getDb(), {
            guildId: 'guild-1',
            channelId: ' ',
            name: 'ideas',
        });
        const invalidVote = await upsertSuggestionVote(getDb(), {
            suggestionId: randomUUID(),
            userId: 'user-1',
            vote: 'maybe',
        });

        expect(blankBoard.isErr()).toBe(true);
        expect(blankBoard._unsafeUnwrapErr()).toStrictEqual({
            type: 'missing-input',
            field: 'channelId',
        });
        expect(invalidVote.isErr()).toBe(true);
        expect(invalidVote._unsafeUnwrapErr()).toStrictEqual({
            type: 'invalid-value',
            field: 'vote',
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

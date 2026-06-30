import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createPgliteTestDatabase, type PgliteTestDatabase } from '../test-support/pglite-test-database.js';

import { createWebSession, findActiveWebSessionById, revokeWebSession, type WebSessionRecord } from './web-sessions.js';

const validSessionId = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFG';
const secondValidSessionId = '9876543210abcdefghijklmnopqrstuvwxyzABCDEFG';
const fluxerUserId = 'fluxer-user-id';
const expiresAt = new Date('2100-01-01T00:00:00.000Z');

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

describe('createWebSession', () => {
    it('creates a session row and returns normalized camelCase fields', async () => {
        const session = await createSession();

        expect(session).toMatchObject({
            id: validSessionId,
            fluxerUserId,
            expiresAt,
            revokedAt: null,
        });
        expect(session.createdAt).toBeInstanceOf(Date);
    });

    it('rejects a blank session id', async () => {
        const result = await createWebSession(getDb(), {
            sessionId: '   ',
            fluxerUserId,
            expiresAt,
        });

        expect(result.isErr()).toBe(true);
        expect(result._unsafeUnwrapErr()).toBe('missing-session-id');
    });

    it('rejects a blank Fluxer user id', async () => {
        const result = await createWebSession(getDb(), {
            sessionId: validSessionId,
            fluxerUserId: '   ',
            expiresAt,
        });

        expect(result.isErr()).toBe(true);
        expect(result._unsafeUnwrapErr()).toBe('missing-fluxer-user-id');
    });

    it('rejects an invalid expiry', async () => {
        const result = await createWebSession(getDb(), {
            sessionId: validSessionId,
            fluxerUserId,
            expiresAt: new Date(Number.NaN),
        });

        expect(result.isErr()).toBe(true);
        expect(result._unsafeUnwrapErr()).toBe('invalid-expiry');
    });

    it('rejects a nonfuture expiry', async () => {
        const result = await createWebSession(getDb(), {
            sessionId: validSessionId,
            fluxerUserId,
            expiresAt: new Date('2000-01-01T00:00:00.000Z'),
        });

        expect(result.isErr()).toBe(true);
        expect(result._unsafeUnwrapErr()).toBe('invalid-expiry');
    });
});

describe('findActiveWebSessionById', () => {
    it('finds an active unexpired, unrevoked session', async () => {
        await createSession();

        const result = await findActiveWebSessionById(getDb(), {
            sessionId: validSessionId,
            now: new Date('2099-01-01T00:00:00.000Z'),
        });

        expect(result.isOk()).toBe(true);
        expect(result._unsafeUnwrap()).toMatchObject({
            id: validSessionId,
            fluxerUserId,
            expiresAt,
            revokedAt: null,
        });
    });

    it('returns not-found for a missing session', async () => {
        const result = await findActiveWebSessionById(getDb(), {
            sessionId: validSessionId,
            now: new Date('2099-01-01T00:00:00.000Z'),
        });

        expect(result.isErr()).toBe(true);
        expect(result._unsafeUnwrapErr()).toBe('not-found');
    });

    it('returns not-found for an expired session', async () => {
        await createSession();

        const result = await findActiveWebSessionById(getDb(), {
            sessionId: validSessionId,
            now: new Date('2100-01-01T00:00:00.001Z'),
        });

        expect(result.isErr()).toBe(true);
        expect(result._unsafeUnwrapErr()).toBe('not-found');
    });

    it('returns not-found for a revoked session', async () => {
        await createSession();
        await revokeWebSession(getDb(), {
            sessionId: validSessionId,
            revokedAt: new Date('2099-01-01T00:00:00.000Z'),
        });

        const result = await findActiveWebSessionById(getDb(), {
            sessionId: validSessionId,
            now: new Date('2099-01-02T00:00:00.000Z'),
        });

        expect(result.isErr()).toBe(true);
        expect(result._unsafeUnwrapErr()).toBe('not-found');
    });
});

describe('revokeWebSession', () => {
    it('revokes an existing session and sets revokedAt', async () => {
        const revokedAt = new Date('2099-01-01T00:00:00.000Z');

        await createSession();

        const result = await revokeWebSession(getDb(), {
            sessionId: validSessionId,
            revokedAt,
        });

        expect(result.isOk()).toBe(true);
        expect(result._unsafeUnwrap()).toMatchObject({
            id: validSessionId,
            fluxerUserId,
            expiresAt,
            revokedAt,
        });
    });

    it('returns not-found when revoking a missing session', async () => {
        const result = await revokeWebSession(getDb(), {
            sessionId: secondValidSessionId,
            revokedAt: new Date('2099-01-01T00:00:00.000Z'),
        });

        expect(result.isErr()).toBe(true);
        expect(result._unsafeUnwrapErr()).toBe('not-found');
    });
});

async function createSession(): Promise<WebSessionRecord> {
    const result = await createWebSession(getDb(), {
        sessionId: validSessionId,
        fluxerUserId,
        expiresAt,
    });

    expect(result.isOk()).toBe(true);

    return result._unsafeUnwrap();
}

async function resetTestDatabase(): Promise<void> {
    if (!testDatabase) {
        throw new Error('Test database was not initialized');
    }

    await testDatabase.reset();
}

function getDb(): Parameters<typeof createWebSession>[0] {
    if (!testDatabase) {
        throw new Error('Test database was not initialized');
    }

    return testDatabase.db;
}

type TestDatabase = PgliteTestDatabase;

function createTestDatabase(): Promise<TestDatabase> {
    return createPgliteTestDatabase('web-sessions');
}

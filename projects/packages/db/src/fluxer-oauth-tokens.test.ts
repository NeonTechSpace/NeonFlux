import { randomUUID } from 'node:crypto';
import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    findUsableFluxerOAuthTokenSetByUserId,
    invalidateFluxerOAuthTokenSet,
    upsertFluxerOAuthTokenSet,
    type FluxerOAuthTokenRecord,
} from './fluxer-oauth-tokens.js';
import * as schema from './schema.js';
import type { EncryptedOAuthTokenPayload } from './schema.js';

const projectRoot = fileURLToPath(new URL('../../..', import.meta.url));
const migrationsFolder = join(projectRoot, 'packages', 'db', 'drizzle');
const testDataRoot = join(projectRoot, 'data', 'pglite-fluxer-oauth-tokens-test');
const fluxerUserId = 'fluxer-user-id';
const accessTokenExpiresAt = new Date('2026-06-22T00:00:00.000Z');
const replacementAccessTokenExpiresAt = new Date('2026-06-23T00:00:00.000Z');
const encryptedAccessToken = createEncryptedToken('access');
const encryptedRefreshToken = createEncryptedToken('refresh');
const replacementEncryptedAccessToken = createEncryptedToken('replacement-access');
const replacementEncryptedRefreshToken = createEncryptedToken('replacement-refresh');

let testDatabase: TestDatabase | undefined;

describe('upsertFluxerOAuthTokenSet', () => {
    beforeEach(async () => {
        testDatabase = await createTestDatabase();
    });

    afterEach(async () => {
        await testDatabase?.close();
        testDatabase = undefined;
        vi.useRealTimers();
    });

    it('upserts a token set and returns normalized camelCase fields', async () => {
        const tokenSet = await upsertTokenSet({
            fluxerUserId: ' fluxer-user-id ',
            tokenType: ' Bearer ',
            scopes: [' identify ', 'guilds'],
        });

        expect(tokenSet).toMatchObject({
            fluxerUserId,
            accessToken: encryptedAccessToken,
            refreshToken: encryptedRefreshToken,
            tokenType: 'Bearer',
            accessTokenExpiresAt,
            scopes: ['identify', 'guilds'],
            invalidatedAt: null,
        });
        expect(tokenSet.createdAt).toBeInstanceOf(Date);
        expect(tokenSet.updatedAt).toBeInstanceOf(Date);
    });

    it('replaces an existing token set, updates updatedAt, and clears invalidatedAt', async () => {
        const firstUpdatedAt = new Date('2026-06-21T00:00:00.000Z');
        const invalidatedAt = new Date('2026-06-21T01:00:00.000Z');
        const secondUpdatedAt = new Date('2026-06-21T02:00:00.000Z');

        vi.useFakeTimers();
        vi.setSystemTime(firstUpdatedAt);
        const firstTokenSet = await upsertTokenSet();

        const invalidation = await invalidateFluxerOAuthTokenSet(getDb(), {
            fluxerUserId,
            invalidatedAt,
        });

        expect(invalidation.isOk()).toBe(true);

        vi.setSystemTime(secondUpdatedAt);
        const replacement = await upsertTokenSet({
            accessToken: replacementEncryptedAccessToken,
            refreshToken: replacementEncryptedRefreshToken,
            tokenType: 'Bearer',
            accessTokenExpiresAt: replacementAccessTokenExpiresAt,
            scopes: ['guilds', 'email'],
        });

        expect(replacement).toMatchObject({
            fluxerUserId,
            accessToken: replacementEncryptedAccessToken,
            refreshToken: replacementEncryptedRefreshToken,
            tokenType: 'Bearer',
            accessTokenExpiresAt: replacementAccessTokenExpiresAt,
            scopes: ['guilds', 'email'],
            invalidatedAt: null,
            createdAt: firstTokenSet.createdAt,
            updatedAt: secondUpdatedAt,
        });
    });

    it('rejects a blank Fluxer user id', async () => {
        const result = await upsertFluxerOAuthTokenSet(getDb(), {
            fluxerUserId: '   ',
            accessToken: encryptedAccessToken,
            refreshToken: encryptedRefreshToken,
            tokenType: 'Bearer',
            accessTokenExpiresAt,
            scopes: ['identify'],
        });

        expect(result.isErr()).toBe(true);
        expect(result._unsafeUnwrapErr()).toBe('missing-fluxer-user-id');
    });

    it('rejects an invalid access token payload', async () => {
        const result = await upsertFluxerOAuthTokenSet(getDb(), {
            fluxerUserId,
            accessToken: {
                ...encryptedAccessToken,
                ciphertext: '   ',
            },
            refreshToken: encryptedRefreshToken,
            tokenType: 'Bearer',
            accessTokenExpiresAt,
            scopes: ['identify'],
        });

        expect(result.isErr()).toBe(true);
        expect(result._unsafeUnwrapErr()).toBe('invalid-access-token');
    });

    it('rejects an invalid refresh token payload', async () => {
        const result = await upsertFluxerOAuthTokenSet(getDb(), {
            fluxerUserId,
            accessToken: encryptedAccessToken,
            refreshToken: {
                ...encryptedRefreshToken,
                authTag: '',
            },
            tokenType: 'Bearer',
            accessTokenExpiresAt,
            scopes: ['identify'],
        });

        expect(result.isErr()).toBe(true);
        expect(result._unsafeUnwrapErr()).toBe('invalid-refresh-token');
    });

    it('allows a missing refresh token', async () => {
        const result = await upsertFluxerOAuthTokenSet(getDb(), {
            fluxerUserId,
            accessToken: encryptedAccessToken,
            tokenType: 'Bearer',
            accessTokenExpiresAt,
            scopes: ['identify'],
        });

        expect(result.isOk()).toBe(true);
        expect(result._unsafeUnwrap().refreshToken).toBeNull();
    });

    it('rejects a blank token type', async () => {
        const result = await upsertFluxerOAuthTokenSet(getDb(), {
            fluxerUserId,
            accessToken: encryptedAccessToken,
            refreshToken: encryptedRefreshToken,
            tokenType: '   ',
            accessTokenExpiresAt,
            scopes: ['identify'],
        });

        expect(result.isErr()).toBe(true);
        expect(result._unsafeUnwrapErr()).toBe('missing-token-type');
    });

    it('rejects an invalid expiry', async () => {
        const result = await upsertFluxerOAuthTokenSet(getDb(), {
            fluxerUserId,
            accessToken: encryptedAccessToken,
            refreshToken: encryptedRefreshToken,
            tokenType: 'Bearer',
            accessTokenExpiresAt: new Date(Number.NaN),
            scopes: ['identify'],
        });

        expect(result.isErr()).toBe(true);
        expect(result._unsafeUnwrapErr()).toBe('invalid-expiry');
    });

    it('rejects empty scopes', async () => {
        const result = await upsertFluxerOAuthTokenSet(getDb(), {
            fluxerUserId,
            accessToken: encryptedAccessToken,
            refreshToken: encryptedRefreshToken,
            tokenType: 'Bearer',
            accessTokenExpiresAt,
            scopes: ['   '],
        });

        expect(result.isErr()).toBe(true);
        expect(result._unsafeUnwrapErr()).toBe('missing-scopes');
    });
});

describe('findUsableFluxerOAuthTokenSetByUserId', () => {
    beforeEach(async () => {
        testDatabase = await createTestDatabase();
    });

    afterEach(async () => {
        await testDatabase?.close();
        testDatabase = undefined;
    });

    it('finds a non-invalidated token set by Fluxer user id', async () => {
        await upsertTokenSet();

        const result = await findUsableFluxerOAuthTokenSetByUserId(getDb(), {
            fluxerUserId: ' fluxer-user-id ',
        });

        expect(result.isOk()).toBe(true);
        expect(result._unsafeUnwrap()).toMatchObject({
            fluxerUserId,
            accessToken: encryptedAccessToken,
            refreshToken: encryptedRefreshToken,
            tokenType: 'Bearer',
            accessTokenExpiresAt,
            scopes: ['identify', 'guilds'],
            invalidatedAt: null,
        });
    });

    it('finds a non-invalidated token set even when the access token is expired', async () => {
        await upsertTokenSet({
            accessTokenExpiresAt: new Date('2000-01-01T00:00:00.000Z'),
        });

        const result = await findUsableFluxerOAuthTokenSetByUserId(getDb(), {
            fluxerUserId,
        });

        expect(result.isOk()).toBe(true);
        expect(result._unsafeUnwrap().accessTokenExpiresAt).toStrictEqual(new Date('2000-01-01T00:00:00.000Z'));
    });

    it('returns not-found for a missing token set', async () => {
        const result = await findUsableFluxerOAuthTokenSetByUserId(getDb(), {
            fluxerUserId,
        });

        expect(result.isErr()).toBe(true);
        expect(result._unsafeUnwrapErr()).toBe('not-found');
    });

    it('returns not-found for an invalidated token set', async () => {
        await upsertTokenSet();
        await invalidateFluxerOAuthTokenSet(getDb(), {
            fluxerUserId,
            invalidatedAt: new Date('2026-06-21T00:00:00.000Z'),
        });

        const result = await findUsableFluxerOAuthTokenSetByUserId(getDb(), {
            fluxerUserId,
        });

        expect(result.isErr()).toBe(true);
        expect(result._unsafeUnwrapErr()).toBe('not-found');
    });

    it('rejects a blank Fluxer user id', async () => {
        const result = await findUsableFluxerOAuthTokenSetByUserId(getDb(), {
            fluxerUserId: '   ',
        });

        expect(result.isErr()).toBe(true);
        expect(result._unsafeUnwrapErr()).toBe('missing-fluxer-user-id');
    });
});

describe('invalidateFluxerOAuthTokenSet', () => {
    beforeEach(async () => {
        testDatabase = await createTestDatabase();
    });

    afterEach(async () => {
        await testDatabase?.close();
        testDatabase = undefined;
    });

    it('invalidates an existing token set', async () => {
        const invalidatedAt = new Date('2026-06-21T00:00:00.000Z');

        await upsertTokenSet();

        const result = await invalidateFluxerOAuthTokenSet(getDb(), {
            fluxerUserId: ' fluxer-user-id ',
            invalidatedAt,
        });

        expect(result.isOk()).toBe(true);
        expect(result._unsafeUnwrap()).toMatchObject({
            fluxerUserId,
            invalidatedAt,
        });
    });

    it('returns not-found when invalidating a missing token set', async () => {
        const result = await invalidateFluxerOAuthTokenSet(getDb(), {
            fluxerUserId,
            invalidatedAt: new Date('2026-06-21T00:00:00.000Z'),
        });

        expect(result.isErr()).toBe(true);
        expect(result._unsafeUnwrapErr()).toBe('not-found');
    });

    it('rejects a blank Fluxer user id', async () => {
        const result = await invalidateFluxerOAuthTokenSet(getDb(), {
            fluxerUserId: '   ',
            invalidatedAt: new Date('2026-06-21T00:00:00.000Z'),
        });

        expect(result.isErr()).toBe(true);
        expect(result._unsafeUnwrapErr()).toBe('missing-fluxer-user-id');
    });
});

async function upsertTokenSet(
    overrides: Partial<Parameters<typeof upsertFluxerOAuthTokenSet>[1]> = {}
): Promise<FluxerOAuthTokenRecord> {
    const result = await upsertFluxerOAuthTokenSet(getDb(), {
        fluxerUserId,
        accessToken: encryptedAccessToken,
        refreshToken: encryptedRefreshToken,
        tokenType: 'Bearer',
        accessTokenExpiresAt,
        scopes: ['identify', 'guilds'],
        ...overrides,
    });

    expect(result.isOk()).toBe(true);

    return result._unsafeUnwrap();
}

function createEncryptedToken(prefix: string): EncryptedOAuthTokenPayload {
    return {
        version: 'v1',
        iv: `${prefix}-iv`,
        ciphertext: `${prefix}-ciphertext`,
        authTag: `${prefix}-auth-tag`,
    };
}

function getDb(): Parameters<typeof upsertFluxerOAuthTokenSet>[0] {
    if (!testDatabase) {
        throw new Error('Test database was not initialized');
    }

    return testDatabase.db;
}

type TestDatabase = {
    db: Parameters<typeof upsertFluxerOAuthTokenSet>[0];
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

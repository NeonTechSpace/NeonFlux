import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { createPgliteTestDatabase, type PgliteTestDatabase } from '../test-support/pglite-test-database.js';

import {
    findUsableFluxerOAuthTokenSetByUserId,
    invalidateFluxerOAuthTokenSet,
    upsertFluxerOAuthTokenSet,
    type FluxerOAuthTokenRecord,
} from './fluxer-oauth-tokens.js';
import type { EncryptedOAuthTokenPayload } from './schema.js';

const fluxerUserId = 'fluxer-user-id';
const accessTokenExpiresAt = new Date('2026-06-22T00:00:00.000Z');
const replacementAccessTokenExpiresAt = new Date('2026-06-23T00:00:00.000Z');
const encryptedAccessToken = createEncryptedToken('access');
const encryptedRefreshToken = createEncryptedToken('refresh');
const replacementEncryptedAccessToken = createEncryptedToken('replacement-access');
const replacementEncryptedRefreshToken = createEncryptedToken('replacement-refresh');

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

describe('upsertFluxerOAuthTokenSet', () => {
    afterEach(() => {
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

async function resetTestDatabase(): Promise<void> {
    if (!testDatabase) {
        throw new Error('Test database was not initialized');
    }

    await testDatabase.reset();
}

function getDb(): Parameters<typeof upsertFluxerOAuthTokenSet>[0] {
    if (!testDatabase) {
        throw new Error('Test database was not initialized');
    }

    return testDatabase.db;
}

type TestDatabase = PgliteTestDatabase;

function createTestDatabase(): Promise<TestDatabase> {
    return createPgliteTestDatabase('fluxer-oauth-tokens');
}

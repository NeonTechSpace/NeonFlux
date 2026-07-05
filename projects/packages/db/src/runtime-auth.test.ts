import { describe, expect, it } from 'vitest';

import type { ConvexDatabase } from './convex.js';
import {
    createWebSession,
    findActiveWebSessionById,
    findUsableFluxerOAuthTokenSetByUserId,
    invalidateFluxerOAuthTokenSet,
    revokeWebSession,
    upsertFluxerOAuthTokenSet,
} from './runtime-auth.js';

const encryptedToken = {
    authTag: 'auth-tag',
    ciphertext: 'ciphertext',
    iv: 'iv',
    version: 'v1',
};
const session = {
    createdAt: '2026-07-03T08:00:00.000Z',
    expiresAt: '2026-07-03T09:00:00.000Z',
    fluxerUserId: 'fluxer-user-1',
    id: 'session-1',
    revokedAt: null,
};
const revokedSession = {
    ...session,
    revokedAt: '2026-07-03T08:30:00.000Z',
};
const tokenSet = {
    accessToken: encryptedToken,
    accessTokenExpiresAt: '2026-07-03T09:00:00.000Z',
    createdAt: '2026-07-03T08:00:00.000Z',
    fluxerUserId: 'fluxer-user-1',
    invalidatedAt: null,
    refreshToken: null,
    scopes: ['identify', 'guilds'],
    tokenType: 'Bearer',
    updatedAt: '2026-07-03T08:10:00.000Z',
};
const invalidatedTokenSet = {
    ...tokenSet,
    invalidatedAt: '2026-07-03T08:30:00.000Z',
};

describe('Convex auth-store database functions', () => {
    it('creates, finds, and revokes web sessions through Convex', async () => {
        const db = createConvexDb({
            mutationResults: [session, revokedSession],
            queryResults: [session],
        });

        const created = await createWebSession(db, {
            expiresAt: new Date(session.expiresAt),
            fluxerUserId: session.fluxerUserId,
            sessionId: session.id,
        });
        const found = await findActiveWebSessionById(db, {
            now: new Date('2026-07-03T08:15:00.000Z'),
            sessionId: session.id,
        });
        const revoked = await revokeWebSession(db, {
            revokedAt: new Date(revokedSession.revokedAt),
            sessionId: session.id,
        });

        expect(created._unsafeUnwrap()).toStrictEqual(toWebSessionRecord(session));
        expect(found._unsafeUnwrap()).toStrictEqual(toWebSessionRecord(session));
        expect(revoked._unsafeUnwrap()).toStrictEqual(toWebSessionRecord(revokedSession));
        expect(db.client.mutationCalls[0]?.args).toStrictEqual({
            expiresAt: session.expiresAt,
            fluxerUserId: session.fluxerUserId,
            sessionId: session.id,
        });
        expect(db.client.queryCalls[0]?.args).toStrictEqual({
            now: '2026-07-03T08:15:00.000Z',
            sessionId: session.id,
        });
    });

    it('maps web session nulls and validation failures to the app-facing contract', async () => {
        const db = createConvexDb({
            mutationErrors: [new Error('missing-session-id')],
            queryResults: [null],
        });

        const missing = await findActiveWebSessionById(db, { sessionId: session.id });
        const invalidNow = await findActiveWebSessionById(db, {
            now: new Date(Number.NaN),
            sessionId: session.id,
        });
        const invalidRevoke = await revokeWebSession(db, {
            revokedAt: new Date(Number.NaN),
            sessionId: session.id,
        });
        const invalidCreate = await createWebSession(db, {
            expiresAt: new Date('2026-07-03T09:00:00.000Z'),
            fluxerUserId: session.fluxerUserId,
            sessionId: ' ',
        });

        expect(missing._unsafeUnwrapErr()).toBe('not-found');
        expect(invalidNow._unsafeUnwrapErr()).toBe('not-found');
        expect(invalidRevoke._unsafeUnwrapErr()).toBe('database-error');
        expect(invalidCreate._unsafeUnwrapErr()).toBe('missing-session-id');
    });

    it('upserts, finds, and invalidates Fluxer OAuth tokens through Convex', async () => {
        const db = createConvexDb({
            mutationResults: [tokenSet, invalidatedTokenSet],
            queryResults: [tokenSet],
        });

        const upserted = await upsertFluxerOAuthTokenSet(db, {
            accessToken: encryptedToken,
            accessTokenExpiresAt: new Date(tokenSet.accessTokenExpiresAt),
            fluxerUserId: tokenSet.fluxerUserId,
            refreshToken: null,
            scopes: tokenSet.scopes,
            tokenType: tokenSet.tokenType,
        });
        const found = await findUsableFluxerOAuthTokenSetByUserId(db, {
            fluxerUserId: tokenSet.fluxerUserId,
        });
        const invalidated = await invalidateFluxerOAuthTokenSet(db, {
            fluxerUserId: tokenSet.fluxerUserId,
            invalidatedAt: new Date(invalidatedTokenSet.invalidatedAt),
        });

        expect(upserted._unsafeUnwrap()).toStrictEqual(toOAuthTokenRecord(tokenSet));
        expect(found._unsafeUnwrap()).toStrictEqual(toOAuthTokenRecord(tokenSet));
        expect(invalidated._unsafeUnwrap()).toStrictEqual(toOAuthTokenRecord(invalidatedTokenSet));
        expect(db.client.mutationCalls[0]?.args).toStrictEqual({
            accessToken: encryptedToken,
            accessTokenExpiresAt: tokenSet.accessTokenExpiresAt,
            fluxerUserId: tokenSet.fluxerUserId,
            scopes: tokenSet.scopes,
            tokenType: tokenSet.tokenType,
        });
    });

    it('maps OAuth token nulls and validation failures to the app-facing contract', async () => {
        const db = createConvexDb({
            mutationErrors: [new Error('missing-scopes')],
            queryResults: [null],
        });

        const missing = await findUsableFluxerOAuthTokenSetByUserId(db, {
            fluxerUserId: tokenSet.fluxerUserId,
        });
        const invalidatedAt = await invalidateFluxerOAuthTokenSet(db, {
            fluxerUserId: tokenSet.fluxerUserId,
            invalidatedAt: new Date(Number.NaN),
        });
        const missingScopes = await upsertFluxerOAuthTokenSet(db, {
            accessToken: encryptedToken,
            accessTokenExpiresAt: new Date(tokenSet.accessTokenExpiresAt),
            fluxerUserId: tokenSet.fluxerUserId,
            scopes: [],
            tokenType: tokenSet.tokenType,
        });

        expect(missing._unsafeUnwrapErr()).toBe('not-found');
        expect(invalidatedAt._unsafeUnwrapErr()).toBe('database-error');
        expect(missingScopes._unsafeUnwrapErr()).toBe('missing-scopes');
    });
});

function toWebSessionRecord(record: typeof session | typeof revokedSession) {
    return {
        createdAt: new Date(record.createdAt),
        expiresAt: new Date(record.expiresAt),
        fluxerUserId: record.fluxerUserId,
        id: record.id,
        revokedAt: record.revokedAt ? new Date(record.revokedAt) : null,
    };
}

function toOAuthTokenRecord(record: typeof tokenSet | typeof invalidatedTokenSet) {
    return {
        accessToken: record.accessToken,
        accessTokenExpiresAt: new Date(record.accessTokenExpiresAt),
        createdAt: new Date(record.createdAt),
        fluxerUserId: record.fluxerUserId,
        invalidatedAt: record.invalidatedAt ? new Date(record.invalidatedAt) : null,
        refreshToken: record.refreshToken,
        scopes: record.scopes,
        tokenType: record.tokenType,
        updatedAt: new Date(record.updatedAt),
    };
}

function createConvexDb(input: {
    mutationErrors?: Error[];
    mutationResults?: unknown[];
    queryErrors?: Error[];
    queryResults?: unknown[];
}): ConvexDatabase & {
    client: {
        mutationCalls: Array<{ args: unknown; reference: unknown }>;
        queryCalls: Array<{ args: unknown; reference: unknown }>;
    };
} {
    const mutationErrors = [...(input.mutationErrors ?? [])];
    const mutationResults = [...(input.mutationResults ?? [])];
    const queryErrors = [...(input.queryErrors ?? [])];
    const queryResults = [...(input.queryResults ?? [])];
    const client = {
        mutationCalls: [] as Array<{ args: unknown; reference: unknown }>,
        queryCalls: [] as Array<{ args: unknown; reference: unknown }>,
        mutation(reference: unknown, args: unknown): Promise<unknown> {
            this.mutationCalls.push({ args, reference });
            const error = mutationErrors.shift();

            if (error) return Promise.reject(error);

            return Promise.resolve(mutationResults.shift());
        },
        query(reference: unknown, args: unknown): Promise<unknown> {
            this.queryCalls.push({ args, reference });
            const error = queryErrors.shift();

            if (error) return Promise.reject(error);

            return Promise.resolve(queryResults.shift());
        },
    };

    return {
        client: client as unknown as ConvexDatabase['client'] & typeof client,
        kind: 'convex',
        serviceName: 'web',
    };
}

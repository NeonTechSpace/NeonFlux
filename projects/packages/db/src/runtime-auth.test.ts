import { describe, expect, it } from 'vitest';

import type { ConvexDatabase } from './convex.js';
import {
    claimFluxerOAuthTokenRefreshLease,
    completeFluxerOAuthTokenRefresh,
    createWebSession,
    findActiveWebSessionById,
    findUsableFluxerOAuthTokenSetByUserId,
    invalidateFluxerOAuthTokenSet,
    recordFluxerOAuthTokenRefreshFailure,
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
    credentialGeneration: 1,
    createdAt: '2026-07-03T08:00:00.000Z',
    fluxerUserId: 'fluxer-user-1',
    invalidatedAt: null,
    refreshToken: null,
    scopes: ['identify', 'guilds'],
    tokenType: 'Bearer',
    updatedAt: '2026-07-03T08:10:00.000Z',
};
const refreshedTokenSet = {
    ...tokenSet,
    accessTokenExpiresAt: '2026-07-03T10:00:00.000Z',
    credentialGeneration: 2,
    refreshToken: encryptedToken,
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

    it('routes OAuth credential generation, lease, completion, cooldown, and terminal deletion through Convex', async () => {
        const db = createConvexDb({
            mutationResults: [
                tokenSet,
                { status: 'claimed' },
                { status: 'applied', tokenSet: refreshedTokenSet },
                { status: 'applied' },
                { status: 'deleted' },
            ],
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
        const claim = await claimFluxerOAuthTokenRefreshLease(db, {
            expectedGeneration: 1,
            fluxerUserId: tokenSet.fluxerUserId,
            leaseId: 'lease-1',
            leaseOwner: 'web-1',
        });
        const completed = await completeFluxerOAuthTokenRefresh(db, {
            accessToken: encryptedToken,
            accessTokenExpiresAt: new Date(refreshedTokenSet.accessTokenExpiresAt),
            expectedGeneration: 1,
            fluxerUserId: tokenSet.fluxerUserId,
            leaseId: 'lease-1',
            refreshToken: encryptedToken,
            scopes: tokenSet.scopes,
            tokenType: tokenSet.tokenType,
        });
        const failure = await recordFluxerOAuthTokenRefreshFailure(db, {
            cooldownMs: 5_000,
            expectedGeneration: 1,
            fluxerUserId: tokenSet.fluxerUserId,
            leaseId: 'lease-1',
        });
        const invalidated = await invalidateFluxerOAuthTokenSet(db, {
            expectedGeneration: 1,
            fluxerUserId: tokenSet.fluxerUserId,
            leaseId: 'lease-1',
        });

        expect(upserted._unsafeUnwrap()).toStrictEqual(toOAuthTokenRecord(tokenSet));
        expect(found._unsafeUnwrap()).toStrictEqual(toOAuthTokenRecord(tokenSet));
        expect(claim._unsafeUnwrap()).toStrictEqual({ status: 'claimed' });
        expect(completed._unsafeUnwrap()).toStrictEqual({
            status: 'applied',
            tokenSet: toOAuthTokenRecord(refreshedTokenSet),
        });
        expect(failure._unsafeUnwrap()).toStrictEqual({ status: 'applied' });
        expect(invalidated._unsafeUnwrap()).toStrictEqual({ status: 'deleted' });
        expect(db.client.mutationCalls[0]?.args).toStrictEqual({
            accessToken: encryptedToken,
            accessTokenExpiresAt: tokenSet.accessTokenExpiresAt,
            fluxerUserId: tokenSet.fluxerUserId,
            scopes: tokenSet.scopes,
            tokenType: tokenSet.tokenType,
        });
        expect(db.client.mutationCalls[1]?.args).toStrictEqual({
            expectedGeneration: 1,
            fluxerUserId: tokenSet.fluxerUserId,
            leaseId: 'lease-1',
            leaseOwner: 'web-1',
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
        const invalidGeneration = await invalidateFluxerOAuthTokenSet(db, {
            expectedGeneration: -1,
            fluxerUserId: tokenSet.fluxerUserId,
            leaseId: 'lease-1',
        });
        const missingScopes = await upsertFluxerOAuthTokenSet(db, {
            accessToken: encryptedToken,
            accessTokenExpiresAt: new Date(tokenSet.accessTokenExpiresAt),
            fluxerUserId: tokenSet.fluxerUserId,
            scopes: [],
            tokenType: tokenSet.tokenType,
        });

        expect(missing._unsafeUnwrapErr()).toBe('not-found');
        expect(invalidGeneration._unsafeUnwrapErr()).toBe('database-error');
        expect(missingScopes._unsafeUnwrapErr()).toBe('missing-scopes');
    });

    it('maps an active distributed refresh lease with its retry time', async () => {
        const db = createConvexDb({
            mutationResults: [{ retryAt: '2026-07-03T08:00:15.000Z', status: 'busy' }],
        });

        const result = await claimFluxerOAuthTokenRefreshLease(db, {
            expectedGeneration: 1,
            fluxerUserId: tokenSet.fluxerUserId,
            leaseId: 'lease-2',
            leaseOwner: 'web-2',
        });

        expect(result._unsafeUnwrap()).toStrictEqual({
            retryAt: new Date('2026-07-03T08:00:15.000Z'),
            status: 'busy',
        });
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

function toOAuthTokenRecord(record: typeof tokenSet | typeof refreshedTokenSet) {
    return {
        accessToken: record.accessToken,
        accessTokenExpiresAt: new Date(record.accessTokenExpiresAt),
        credentialGeneration: record.credentialGeneration,
        createdAt: new Date(record.createdAt),
        fluxerUserId: record.fluxerUserId,
        invalidatedAt: null,
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

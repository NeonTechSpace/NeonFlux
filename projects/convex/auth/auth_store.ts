import { v, type GenericId } from 'convex/values';

import { internal } from '../_generated/api.js';
import { requireNeonFluxService } from '../auth.js';
import {
    decideFluxerOAuthRefreshLeaseClaim,
    isActiveSession,
    matchesFluxerOAuthRefreshLease,
    normalizeCredentialGeneration,
    normalizeEncryptedTokenPayload,
    normalizeFutureTimestamp,
    normalizeOptionalEncryptedTokenPayload,
    normalizeRequiredString,
    normalizeScopes,
    normalizeTimestamp,
    type EncryptedOAuthTokenPayload,
    type FluxerOAuthTokenRecord,
    type WebSessionRecord,
} from './auth_store_model.js';
import { internalMutation, mutation, query, type MutationCtx, type QueryCtx } from '../_generated/server.js';
type AuthStoreQueryCtx = QueryCtx;
type AuthStoreMutationCtx = MutationCtx;

type StoredWebSessionDocument = {
    _id: GenericId<'webSessions'>;
    createdAt: string;
    expiresAt: string;
    fluxerUserId: string;
    id: string;
    revokedAt?: string;
};

type StoredFluxerOAuthTokenDocument = {
    _id: GenericId<'fluxerOauthTokens'>;
    accessToken: EncryptedOAuthTokenPayload;
    accessTokenExpiresAt: string;
    credentialGeneration?: number;
    createdAt: string;
    fluxerUserId: string;
    invalidatedAt?: string;
    refreshToken?: EncryptedOAuthTokenPayload;
    refreshLeaseExpiresAt?: string;
    refreshLeaseGeneration?: number;
    refreshLeaseId?: string;
    refreshLeaseOwner?: string;
    refreshRetryAfter?: string;
    scopes: string[];
    tokenType: string;
    updatedAt: string;
};

const allowedAuthStoreServices = ['web'] as const;
export const AUTH_STATE_RETENTION_GRACE_MS = 24 * 60 * 60 * 1_000;
export const OAUTH_REFRESH_LEASE_DURATION_MS = 60_000;
export const OAUTH_REFRESH_MAXIMUM_COOLDOWN_MS = 30_000;
const authCleanupBatchSize = 100;

const encryptedOAuthTokenPayloadValidator = v.object({
    authTag: v.string(),
    ciphertext: v.string(),
    iv: v.string(),
    version: v.string(),
});
const webSessionRecordValidator = v.object({
    createdAt: v.string(),
    expiresAt: v.string(),
    fluxerUserId: v.string(),
    id: v.string(),
    revokedAt: v.union(v.string(), v.null()),
});
const fluxerOAuthTokenRecordValidator = v.object({
    accessToken: encryptedOAuthTokenPayloadValidator,
    accessTokenExpiresAt: v.string(),
    credentialGeneration: v.number(),
    createdAt: v.string(),
    fluxerUserId: v.string(),
    invalidatedAt: v.union(v.string(), v.null()),
    refreshToken: v.union(encryptedOAuthTokenPayloadValidator, v.null()),
    scopes: v.array(v.string()),
    tokenType: v.string(),
    updatedAt: v.string(),
});
const fluxerOAuthRefreshLeaseClaimValidator = v.union(
    v.object({ status: v.literal('claimed') }),
    v.object({ retryAt: v.string(), status: v.literal('busy') }),
    v.object({ retryAt: v.string(), status: v.literal('cooldown') }),
    v.object({ status: v.literal('missing') }),
    v.object({ status: v.literal('stale') })
);
const fluxerOAuthRefreshCompletionValidator = v.union(
    v.object({ status: v.literal('applied'), tokenSet: fluxerOAuthTokenRecordValidator }),
    v.object({ status: v.literal('stale') })
);
const fluxerOAuthRefreshMutationStatusValidator = v.union(
    v.object({ status: v.literal('applied') }),
    v.object({ status: v.literal('stale') })
);

export const createWebSession = mutation({
    args: {
        expiresAt: v.string(),
        fluxerUserId: v.string(),
        sessionId: v.string(),
    },
    returns: webSessionRecordValidator,
    handler: async (ctx: AuthStoreMutationCtx, args) => {
        await requireNeonFluxService(ctx, allowedAuthStoreServices);
        const sessionId = unwrap(normalizeRequiredString(args.sessionId, 'missing-session-id'));
        const fluxerUserId = unwrap(normalizeRequiredString(args.fluxerUserId, 'missing-fluxer-user-id'));
        const expiresAt = unwrap(normalizeFutureTimestamp(args.expiresAt)).isoString;
        const existingSession = await findWebSessionDocument(ctx, sessionId);

        if (existingSession) {
            throw new Error('web-session-already-exists');
        }

        const now = new Date().toISOString();
        const document = {
            createdAt: now,
            expiresAt,
            fluxerUserId,
            id: sessionId,
        };

        await ctx.db.insert('webSessions', document);

        return toWebSessionRecord(document);
    },
});

export const findActiveWebSessionById = query({
    args: {
        now: v.optional(v.string()),
        sessionId: v.string(),
    },
    returns: v.union(webSessionRecordValidator, v.null()),
    handler: async (ctx: AuthStoreQueryCtx, args) => {
        await requireNeonFluxService(ctx, allowedAuthStoreServices);
        const sessionId = unwrap(normalizeRequiredString(args.sessionId, 'missing-session-id'));
        const session = await findWebSessionDocument(ctx, sessionId);
        const nowMs = args.now ? Date.parse(unwrap(normalizeTimestamp(args.now))) : Date.now();

        if (!session || !isActiveSession(session, nowMs)) {
            return null;
        }

        return toWebSessionRecord(session);
    },
});

export const revokeWebSession = mutation({
    args: {
        revokedAt: v.optional(v.string()),
        sessionId: v.string(),
    },
    returns: v.union(webSessionRecordValidator, v.null()),
    handler: async (ctx: AuthStoreMutationCtx, args) => {
        await requireNeonFluxService(ctx, allowedAuthStoreServices);
        const sessionId = unwrap(normalizeRequiredString(args.sessionId, 'missing-session-id'));
        const session = await findWebSessionDocument(ctx, sessionId);

        if (!session) {
            return null;
        }

        if (session.revokedAt) {
            return toWebSessionRecord(session);
        }

        const revokedAt = args.revokedAt ? unwrap(normalizeTimestamp(args.revokedAt)) : new Date().toISOString();
        await ctx.db.patch('webSessions', session._id, { revokedAt });

        return toWebSessionRecord({
            ...session,
            revokedAt,
        });
    },
});

export const upsertFluxerOAuthTokenSet = mutation({
    args: {
        accessToken: encryptedOAuthTokenPayloadValidator,
        accessTokenExpiresAt: v.string(),
        fluxerUserId: v.string(),
        refreshToken: v.optional(encryptedOAuthTokenPayloadValidator),
        scopes: v.array(v.string()),
        tokenType: v.string(),
    },
    returns: fluxerOAuthTokenRecordValidator,
    handler: async (ctx: AuthStoreMutationCtx, args) => {
        await requireNeonFluxService(ctx, allowedAuthStoreServices);
        const fluxerUserId = unwrap(normalizeRequiredString(args.fluxerUserId, 'missing-fluxer-user-id'));
        const accessToken = unwrap(normalizeEncryptedTokenPayload(args.accessToken, 'invalid-access-token'));
        const refreshToken = unwrap(normalizeOptionalEncryptedTokenPayload(args.refreshToken));
        const tokenType = unwrap(normalizeRequiredString(args.tokenType, 'missing-token-type'));
        const accessTokenExpiresAt = unwrap(normalizeTimestamp(args.accessTokenExpiresAt));
        const scopes = unwrap(normalizeScopes(args.scopes));
        const now = new Date().toISOString();
        const existingTokenSet = await findFluxerOAuthTokenDocument(ctx, fluxerUserId);

        if (existingTokenSet) {
            const credentialGeneration = unwrap(normalizeCredentialGeneration(existingTokenSet.credentialGeneration));
            const patch = {
                accessToken,
                accessTokenExpiresAt,
                credentialGeneration: credentialGeneration + 1,
                invalidatedAt: undefined,
                refreshToken,
                refreshLeaseExpiresAt: undefined,
                refreshLeaseGeneration: undefined,
                refreshLeaseId: undefined,
                refreshLeaseOwner: undefined,
                refreshRetryAfter: undefined,
                scopes,
                tokenType,
                updatedAt: now,
            };

            await ctx.db.patch('fluxerOauthTokens', existingTokenSet._id, patch);

            return toFluxerOAuthTokenRecord({
                ...existingTokenSet,
                ...patch,
            });
        }

        const document = {
            accessToken,
            accessTokenExpiresAt,
            credentialGeneration: 1,
            createdAt: now,
            fluxerUserId,
            ...(refreshToken ? { refreshToken } : {}),
            scopes,
            tokenType,
            updatedAt: now,
        };

        await ctx.db.insert('fluxerOauthTokens', document);

        return toFluxerOAuthTokenRecord(document);
    },
});

export const findUsableFluxerOAuthTokenSetByUserId = query({
    args: {
        fluxerUserId: v.string(),
    },
    returns: v.union(fluxerOAuthTokenRecordValidator, v.null()),
    handler: async (ctx: AuthStoreQueryCtx, args) => {
        await requireNeonFluxService(ctx, allowedAuthStoreServices);
        const fluxerUserId = unwrap(normalizeRequiredString(args.fluxerUserId, 'missing-fluxer-user-id'));
        const tokenSet = await findFluxerOAuthTokenDocument(ctx, fluxerUserId);

        if (!tokenSet || tokenSet.invalidatedAt) {
            return null;
        }

        return toFluxerOAuthTokenRecord(tokenSet);
    },
});

export const claimFluxerOAuthTokenRefreshLease = mutation({
    args: {
        expectedGeneration: v.number(),
        fluxerUserId: v.string(),
        leaseId: v.string(),
        leaseOwner: v.string(),
    },
    returns: fluxerOAuthRefreshLeaseClaimValidator,
    handler: async (ctx: AuthStoreMutationCtx, args) => {
        await requireNeonFluxService(ctx, allowedAuthStoreServices);
        const fluxerUserId = unwrap(normalizeRequiredString(args.fluxerUserId, 'missing-fluxer-user-id'));
        const expectedGeneration = unwrap(normalizeCredentialGeneration(args.expectedGeneration));
        const leaseId = unwrap(normalizeRequiredString(args.leaseId, 'missing-lease-id'));
        const leaseOwner = unwrap(normalizeRequiredString(args.leaseOwner, 'missing-lease-owner'));
        const nowMs = Date.now();
        const leaseExpiresAt = new Date(nowMs + OAUTH_REFRESH_LEASE_DURATION_MS).toISOString();
        const tokenSet = await findFluxerOAuthTokenDocument(ctx, fluxerUserId);
        const decision = decideFluxerOAuthRefreshLeaseClaim(tokenSet, {
            expectedGeneration,
            nowMs,
        });

        if (decision.status !== 'claimable') {
            return decision;
        }

        if (!tokenSet) {
            return { status: 'missing' as const };
        }

        await ctx.db.patch('fluxerOauthTokens', tokenSet._id, {
            refreshLeaseExpiresAt: leaseExpiresAt,
            refreshLeaseGeneration: expectedGeneration,
            refreshLeaseId: leaseId,
            refreshLeaseOwner: leaseOwner,
            refreshRetryAfter: undefined,
        });

        return { status: 'claimed' as const };
    },
});

export const completeFluxerOAuthTokenRefresh = mutation({
    args: {
        accessToken: encryptedOAuthTokenPayloadValidator,
        accessTokenExpiresAt: v.string(),
        expectedGeneration: v.number(),
        fluxerUserId: v.string(),
        leaseId: v.string(),
        refreshToken: encryptedOAuthTokenPayloadValidator,
        scopes: v.array(v.string()),
        tokenType: v.string(),
    },
    returns: fluxerOAuthRefreshCompletionValidator,
    handler: async (ctx: AuthStoreMutationCtx, args) => {
        await requireNeonFluxService(ctx, allowedAuthStoreServices);
        const fluxerUserId = unwrap(normalizeRequiredString(args.fluxerUserId, 'missing-fluxer-user-id'));
        const expectedGeneration = unwrap(normalizeCredentialGeneration(args.expectedGeneration));
        const leaseId = unwrap(normalizeRequiredString(args.leaseId, 'missing-lease-id'));
        const accessToken = unwrap(normalizeEncryptedTokenPayload(args.accessToken, 'invalid-access-token'));
        const refreshToken = unwrap(normalizeEncryptedTokenPayload(args.refreshToken, 'invalid-refresh-token'));
        const tokenType = unwrap(normalizeRequiredString(args.tokenType, 'missing-token-type'));
        const accessTokenExpiresAt = unwrap(normalizeTimestamp(args.accessTokenExpiresAt));
        const scopes = unwrap(normalizeScopes(args.scopes));
        const tokenSet = await findFluxerOAuthTokenDocument(ctx, fluxerUserId);

        if (!matchesFluxerOAuthRefreshLease(tokenSet, { expectedGeneration, leaseId })) {
            return { status: 'stale' as const };
        }

        if (!tokenSet) {
            return { status: 'stale' as const };
        }

        const patch = {
            accessToken,
            accessTokenExpiresAt,
            credentialGeneration: expectedGeneration + 1,
            invalidatedAt: undefined,
            refreshLeaseExpiresAt: undefined,
            refreshLeaseGeneration: undefined,
            refreshLeaseId: undefined,
            refreshLeaseOwner: undefined,
            refreshRetryAfter: undefined,
            refreshToken,
            scopes,
            tokenType,
            updatedAt: new Date().toISOString(),
        };

        await ctx.db.patch('fluxerOauthTokens', tokenSet._id, patch);

        return {
            status: 'applied' as const,
            tokenSet: toFluxerOAuthTokenRecord({ ...tokenSet, ...patch }),
        };
    },
});

export const recordFluxerOAuthTokenRefreshFailure = mutation({
    args: {
        cooldownMs: v.number(),
        expectedGeneration: v.number(),
        fluxerUserId: v.string(),
        leaseId: v.string(),
    },
    returns: fluxerOAuthRefreshMutationStatusValidator,
    handler: async (ctx: AuthStoreMutationCtx, args) => {
        await requireNeonFluxService(ctx, allowedAuthStoreServices);
        const fluxerUserId = unwrap(normalizeRequiredString(args.fluxerUserId, 'missing-fluxer-user-id'));
        const expectedGeneration = unwrap(normalizeCredentialGeneration(args.expectedGeneration));
        const leaseId = unwrap(normalizeRequiredString(args.leaseId, 'missing-lease-id'));
        if (!Number.isSafeInteger(args.cooldownMs) || args.cooldownMs < 0) {
            throw new Error('invalid-expiry');
        }

        const retryAt = new Date(
            Date.now() + Math.min(args.cooldownMs, OAUTH_REFRESH_MAXIMUM_COOLDOWN_MS)
        ).toISOString();
        const tokenSet = await findFluxerOAuthTokenDocument(ctx, fluxerUserId);

        if (!matchesFluxerOAuthRefreshLease(tokenSet, { expectedGeneration, leaseId })) {
            return { status: 'stale' as const };
        }

        if (!tokenSet) {
            return { status: 'stale' as const };
        }

        await ctx.db.patch('fluxerOauthTokens', tokenSet._id, {
            refreshLeaseExpiresAt: undefined,
            refreshLeaseGeneration: undefined,
            refreshLeaseId: undefined,
            refreshLeaseOwner: undefined,
            refreshRetryAfter: retryAt,
        });

        return { status: 'applied' as const };
    },
});

export const pruneAuthStateBatch = internalMutation({
    args: {
        cursor: v.optional(v.string()),
        phase: v.optional(v.union(v.literal('sessions'), v.literal('tokens'))),
    },
    returns: v.null(),
    handler: async (ctx: AuthStoreMutationCtx, args) => {
        const cutoff = new Date(Date.now() - AUTH_STATE_RETENTION_GRACE_MS).toISOString();
        const phase = args.phase ?? 'sessions';

        if (phase === 'tokens') {
            const tokenPage = await ctx.db.query('fluxerOauthTokens').paginate({
                cursor: args.cursor ?? null,
                numItems: authCleanupBatchSize,
            });

            for (const tokenSet of tokenPage.page) {
                if (Date.parse(tokenSet.updatedAt) > Date.parse(cutoff)) continue;

                const siblingSession = await ctx.db
                    .query('webSessions')
                    .withIndex('by_fluxer_user_id', (query) => query.eq('fluxerUserId', tokenSet.fluxerUserId))
                    .first();

                if (!siblingSession) {
                    await ctx.db.delete('fluxerOauthTokens', tokenSet._id);
                }
            }

            if (!tokenPage.isDone) {
                await ctx.scheduler.runAfter(0, internal.auth.auth_store.pruneAuthStateBatch, {
                    cursor: tokenPage.continueCursor,
                    phase: 'tokens',
                });
            }

            return null;
        }

        const expiredSessions = await ctx.db
            .query('webSessions')
            .withIndex('by_expires_at', (query) => query.lt('expiresAt', cutoff))
            .take(authCleanupBatchSize);
        const revokedSessions = await ctx.db
            .query('webSessions')
            .withIndex('by_revoked_at', (query) => query.gt('revokedAt', '').lt('revokedAt', cutoff))
            .take(authCleanupBatchSize);
        const sessionsToDelete = new Map(
            [...expiredSessions, ...revokedSessions].map((session) => [session._id, session] as const)
        );
        const sessionBatch = [...sessionsToDelete.values()].slice(0, authCleanupBatchSize);

        for (const session of sessionBatch) {
            await ctx.db.delete('webSessions', session._id);
        }

        await ctx.scheduler.runAfter(0, internal.auth.auth_store.pruneAuthStateBatch, {
            phase: sessionBatch.length === authCleanupBatchSize ? 'sessions' : 'tokens',
        });

        return null;
    },
});

export const invalidateFluxerOAuthTokenSet = mutation({
    args: {
        expectedGeneration: v.number(),
        fluxerUserId: v.string(),
        leaseId: v.string(),
    },
    returns: v.union(v.object({ status: v.literal('deleted') }), v.object({ status: v.literal('stale') })),
    handler: async (ctx: AuthStoreMutationCtx, args) => {
        await requireNeonFluxService(ctx, allowedAuthStoreServices);
        const fluxerUserId = unwrap(normalizeRequiredString(args.fluxerUserId, 'missing-fluxer-user-id'));
        const expectedGeneration = unwrap(normalizeCredentialGeneration(args.expectedGeneration));
        const leaseId = unwrap(normalizeRequiredString(args.leaseId, 'missing-lease-id'));
        const tokenSet = await findFluxerOAuthTokenDocument(ctx, fluxerUserId);

        if (!matchesFluxerOAuthRefreshLease(tokenSet, { expectedGeneration, leaseId })) {
            return { status: 'stale' as const };
        }

        if (!tokenSet) {
            return { status: 'stale' as const };
        }

        await ctx.db.delete('fluxerOauthTokens', tokenSet._id);

        return { status: 'deleted' as const };
    },
});

async function findWebSessionDocument(
    ctx: AuthStoreQueryCtx | AuthStoreMutationCtx,
    sessionId: string
): Promise<StoredWebSessionDocument | null> {
    return await ctx.db
        .query('webSessions')
        .withIndex('by_session_id', (query) => query.eq('id', sessionId))
        .unique();
}

async function findFluxerOAuthTokenDocument(
    ctx: AuthStoreQueryCtx | AuthStoreMutationCtx,
    fluxerUserId: string
): Promise<StoredFluxerOAuthTokenDocument | null> {
    return await ctx.db
        .query('fluxerOauthTokens')
        .withIndex('by_fluxer_user_id', (query) => query.eq('fluxerUserId', fluxerUserId))
        .unique();
}

function unwrap<Value>(result: { ok: true; value: Value } | { error: string; ok: false }): Value {
    if (!result.ok) {
        throw new Error(result.error);
    }

    return result.value;
}

function toWebSessionRecord(document: {
    createdAt: string;
    expiresAt: string;
    fluxerUserId: string;
    id: string;
    revokedAt?: string;
}): WebSessionRecord {
    return {
        createdAt: document.createdAt,
        expiresAt: document.expiresAt,
        fluxerUserId: document.fluxerUserId,
        id: document.id,
        revokedAt: document.revokedAt ?? null,
    };
}

function toFluxerOAuthTokenRecord(document: {
    accessToken: EncryptedOAuthTokenPayload;
    accessTokenExpiresAt: string;
    credentialGeneration?: number;
    createdAt: string;
    fluxerUserId: string;
    invalidatedAt?: string | undefined;
    refreshToken?: EncryptedOAuthTokenPayload | undefined;
    scopes: string[];
    tokenType: string;
    updatedAt: string;
}): FluxerOAuthTokenRecord {
    return {
        accessToken: document.accessToken,
        accessTokenExpiresAt: document.accessTokenExpiresAt,
        credentialGeneration: unwrap(normalizeCredentialGeneration(document.credentialGeneration)),
        createdAt: document.createdAt,
        fluxerUserId: document.fluxerUserId,
        invalidatedAt: document.invalidatedAt ?? null,
        refreshToken: document.refreshToken ?? null,
        scopes: document.scopes,
        tokenType: document.tokenType,
        updatedAt: document.updatedAt,
    };
}

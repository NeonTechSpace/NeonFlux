import {
    mutationGeneric,
    queryGeneric,
    type DataModelFromSchemaDefinition,
    type GenericMutationCtx,
    type GenericQueryCtx,
} from 'convex/server';
import { v, type GenericId } from 'convex/values';

import { requireNeonFluxService } from '../auth.js';
import {
    isActiveSession,
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
import type schema from '../schema.js';

type NeonFluxDataModel = DataModelFromSchemaDefinition<typeof schema>;
type AuthStoreQueryCtx = GenericQueryCtx<NeonFluxDataModel>;
type AuthStoreMutationCtx = GenericMutationCtx<NeonFluxDataModel>;

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
    createdAt: string;
    fluxerUserId: string;
    invalidatedAt?: string;
    refreshToken?: EncryptedOAuthTokenPayload;
    scopes: string[];
    tokenType: string;
    updatedAt: string;
};

const allowedAuthStoreServices = ['web'] as const;

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
    createdAt: v.string(),
    fluxerUserId: v.string(),
    invalidatedAt: v.union(v.string(), v.null()),
    refreshToken: v.union(encryptedOAuthTokenPayloadValidator, v.null()),
    scopes: v.array(v.string()),
    tokenType: v.string(),
    updatedAt: v.string(),
});

export const createWebSession = mutationGeneric({
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

export const findActiveWebSessionById = queryGeneric({
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

export const revokeWebSession = mutationGeneric({
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

        const revokedAt = args.revokedAt ? unwrap(normalizeTimestamp(args.revokedAt)) : new Date().toISOString();
        await ctx.db.patch(session._id, { revokedAt });

        return toWebSessionRecord({
            ...session,
            revokedAt,
        });
    },
});

export const upsertFluxerOAuthTokenSet = mutationGeneric({
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
            const patch = {
                accessToken,
                accessTokenExpiresAt,
                invalidatedAt: undefined,
                refreshToken,
                scopes,
                tokenType,
                updatedAt: now,
            };

            await ctx.db.patch(existingTokenSet._id, patch);

            return toFluxerOAuthTokenRecord({
                ...existingTokenSet,
                ...patch,
            });
        }

        const document = {
            accessToken,
            accessTokenExpiresAt,
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

export const findUsableFluxerOAuthTokenSetByUserId = queryGeneric({
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

export const invalidateFluxerOAuthTokenSet = mutationGeneric({
    args: {
        fluxerUserId: v.string(),
        invalidatedAt: v.optional(v.string()),
    },
    returns: v.union(fluxerOAuthTokenRecordValidator, v.null()),
    handler: async (ctx: AuthStoreMutationCtx, args) => {
        await requireNeonFluxService(ctx, allowedAuthStoreServices);
        const fluxerUserId = unwrap(normalizeRequiredString(args.fluxerUserId, 'missing-fluxer-user-id'));
        const tokenSet = await findFluxerOAuthTokenDocument(ctx, fluxerUserId);

        if (!tokenSet) {
            return null;
        }

        const invalidatedAt = args.invalidatedAt
            ? unwrap(normalizeTimestamp(args.invalidatedAt))
            : new Date().toISOString();
        await ctx.db.patch(tokenSet._id, { invalidatedAt });

        return toFluxerOAuthTokenRecord({
            ...tokenSet,
            invalidatedAt,
        });
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
        createdAt: document.createdAt,
        fluxerUserId: document.fluxerUserId,
        invalidatedAt: document.invalidatedAt ?? null,
        refreshToken: document.refreshToken ?? null,
        scopes: document.scopes,
        tokenType: document.tokenType,
        updatedAt: document.updatedAt,
    };
}

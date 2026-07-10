import { api } from '@neonflux/convex-api';
import { err, ok, type Result } from 'neverthrow';

import type {
    EncryptedOAuthTokenPayload,
    FluxerOAuthRefreshCompletion,
    FluxerOAuthRefreshLeaseClaim,
    FluxerOAuthRefreshMutationStatus,
    FluxerOAuthTokenRecord,
    FluxerOAuthTokenRepositoryError,
    WebSessionRecord,
    WebSessionRepositoryError,
} from './contracts.js';

import type { ConvexDatabase } from './convex.js';

type WebSessionDb = ConvexDatabase;
type FluxerOAuthTokenDb = ConvexDatabase;

type ConvexWebSessionRecord = {
    createdAt: string;
    expiresAt: string;
    fluxerUserId: string;
    id: string;
    revokedAt: string | null;
};

type ConvexFluxerOAuthTokenRecord = {
    accessToken: EncryptedOAuthTokenPayload;
    accessTokenExpiresAt: string;
    credentialGeneration: number;
    createdAt: string;
    fluxerUserId: string;
    invalidatedAt: string | null;
    refreshToken: EncryptedOAuthTokenPayload | null;
    scopes: string[];
    tokenType: string;
    updatedAt: string;
};

export async function createWebSession(
    db: WebSessionDb,
    input: {
        expiresAt: Date;
        fluxerUserId: string;
        sessionId: string;
    }
): Promise<Result<WebSessionRecord, WebSessionRepositoryError>> {
    if (!isValidDate(input.expiresAt)) {
        return err('invalid-expiry');
    }

    try {
        const session = await db.client.mutation(api.auth_store.createWebSession, {
            expiresAt: input.expiresAt.toISOString(),
            fluxerUserId: input.fluxerUserId,
            sessionId: input.sessionId,
        });

        return ok(toWebSessionRecord(session));
    } catch (error) {
        return err(mapWebSessionError(error));
    }
}

export async function findActiveWebSessionById(
    db: WebSessionDb,
    input: {
        now?: Date;
        sessionId: string;
    }
): Promise<Result<WebSessionRecord, WebSessionRepositoryError>> {
    if (input.now && !isValidDate(input.now)) {
        return err('not-found');
    }

    try {
        const session = await db.client.query(api.auth_store.findActiveWebSessionById, {
            ...(input.now ? { now: input.now.toISOString() } : {}),
            sessionId: input.sessionId,
        });

        return session ? ok(toWebSessionRecord(session)) : err('not-found');
    } catch (error) {
        return err(mapWebSessionError(error));
    }
}

export async function revokeWebSession(
    db: WebSessionDb,
    input: {
        revokedAt?: Date;
        sessionId: string;
    }
): Promise<Result<WebSessionRecord, WebSessionRepositoryError>> {
    if (input.revokedAt && !isValidDate(input.revokedAt)) {
        return err('database-error');
    }

    try {
        const session = await db.client.mutation(api.auth_store.revokeWebSession, {
            ...(input.revokedAt ? { revokedAt: input.revokedAt.toISOString() } : {}),
            sessionId: input.sessionId,
        });

        return session ? ok(toWebSessionRecord(session)) : err('not-found');
    } catch (error) {
        return err(mapWebSessionError(error));
    }
}

export async function upsertFluxerOAuthTokenSet(
    db: FluxerOAuthTokenDb,
    input: {
        accessToken: EncryptedOAuthTokenPayload;
        accessTokenExpiresAt: Date;
        fluxerUserId: string;
        refreshToken?: EncryptedOAuthTokenPayload | null;
        scopes: readonly string[];
        tokenType: string;
    }
): Promise<Result<FluxerOAuthTokenRecord, FluxerOAuthTokenRepositoryError>> {
    if (!isValidDate(input.accessTokenExpiresAt)) {
        return err('invalid-expiry');
    }

    try {
        const tokenSet = await db.client.mutation(api.auth_store.upsertFluxerOAuthTokenSet, {
            accessToken: input.accessToken,
            accessTokenExpiresAt: input.accessTokenExpiresAt.toISOString(),
            fluxerUserId: input.fluxerUserId,
            ...(input.refreshToken ? { refreshToken: input.refreshToken } : {}),
            scopes: [...input.scopes],
            tokenType: input.tokenType,
        });

        return ok(toFluxerOAuthTokenRecord(tokenSet));
    } catch (error) {
        return err(mapFluxerOAuthTokenError(error));
    }
}

export async function findUsableFluxerOAuthTokenSetByUserId(
    db: FluxerOAuthTokenDb,
    input: { fluxerUserId: string }
): Promise<Result<FluxerOAuthTokenRecord, FluxerOAuthTokenRepositoryError>> {
    try {
        const tokenSet = await db.client.query(api.auth_store.findUsableFluxerOAuthTokenSetByUserId, input);

        return tokenSet ? ok(toFluxerOAuthTokenRecord(tokenSet)) : err('not-found');
    } catch (error) {
        return err(mapFluxerOAuthTokenError(error));
    }
}

export async function claimFluxerOAuthTokenRefreshLease(
    db: FluxerOAuthTokenDb,
    input: {
        expectedGeneration: number;
        fluxerUserId: string;
        leaseId: string;
        leaseOwner: string;
    }
): Promise<Result<FluxerOAuthRefreshLeaseClaim, FluxerOAuthTokenRepositoryError>> {
    if (!isValidCredentialGeneration(input.expectedGeneration)) {
        return err('database-error');
    }

    try {
        const claim = await db.client.mutation(api.auth_store.claimFluxerOAuthTokenRefreshLease, {
            expectedGeneration: input.expectedGeneration,
            fluxerUserId: input.fluxerUserId,
            leaseId: input.leaseId,
            leaseOwner: input.leaseOwner,
        });

        switch (claim.status) {
            case 'busy':
            case 'cooldown':
                return ok({ retryAt: new Date(claim.retryAt), status: claim.status });

            case 'claimed':
            case 'missing':
            case 'stale':
                return ok({ status: claim.status });
        }
    } catch (error) {
        return err(mapFluxerOAuthTokenError(error));
    }
}

export async function completeFluxerOAuthTokenRefresh(
    db: FluxerOAuthTokenDb,
    input: {
        accessToken: EncryptedOAuthTokenPayload;
        accessTokenExpiresAt: Date;
        expectedGeneration: number;
        fluxerUserId: string;
        leaseId: string;
        refreshToken: EncryptedOAuthTokenPayload;
        scopes: readonly string[];
        tokenType: string;
    }
): Promise<Result<FluxerOAuthRefreshCompletion, FluxerOAuthTokenRepositoryError>> {
    if (!isValidCredentialGeneration(input.expectedGeneration) || !isValidDate(input.accessTokenExpiresAt)) {
        return err('database-error');
    }

    try {
        const completion = await db.client.mutation(api.auth_store.completeFluxerOAuthTokenRefresh, {
            accessToken: input.accessToken,
            accessTokenExpiresAt: input.accessTokenExpiresAt.toISOString(),
            expectedGeneration: input.expectedGeneration,
            fluxerUserId: input.fluxerUserId,
            leaseId: input.leaseId,
            refreshToken: input.refreshToken,
            scopes: [...input.scopes],
            tokenType: input.tokenType,
        });

        return completion.status === 'applied'
            ? ok({ status: 'applied', tokenSet: toFluxerOAuthTokenRecord(completion.tokenSet) })
            : ok({ status: 'stale' });
    } catch (error) {
        return err(mapFluxerOAuthTokenError(error));
    }
}

export async function recordFluxerOAuthTokenRefreshFailure(
    db: FluxerOAuthTokenDb,
    input: {
        cooldownMs: number;
        expectedGeneration: number;
        fluxerUserId: string;
        leaseId: string;
    }
): Promise<Result<FluxerOAuthRefreshMutationStatus, FluxerOAuthTokenRepositoryError>> {
    if (
        !isValidCredentialGeneration(input.expectedGeneration) ||
        !Number.isSafeInteger(input.cooldownMs) ||
        input.cooldownMs < 0
    ) {
        return err('database-error');
    }

    try {
        return ok(
            await db.client.mutation(api.auth_store.recordFluxerOAuthTokenRefreshFailure, {
                cooldownMs: input.cooldownMs,
                expectedGeneration: input.expectedGeneration,
                fluxerUserId: input.fluxerUserId,
                leaseId: input.leaseId,
            })
        );
    } catch (error) {
        return err(mapFluxerOAuthTokenError(error));
    }
}

export async function invalidateFluxerOAuthTokenSet(
    db: FluxerOAuthTokenDb,
    input: {
        expectedGeneration: number;
        fluxerUserId: string;
        leaseId: string;
    }
): Promise<Result<FluxerOAuthRefreshMutationStatus, FluxerOAuthTokenRepositoryError>> {
    if (!isValidCredentialGeneration(input.expectedGeneration)) {
        return err('database-error');
    }

    try {
        return ok(
            await db.client.mutation(api.auth_store.invalidateFluxerOAuthTokenSet, {
                expectedGeneration: input.expectedGeneration,
                fluxerUserId: input.fluxerUserId,
                leaseId: input.leaseId,
            })
        );
    } catch (error) {
        return err(mapFluxerOAuthTokenError(error));
    }
}

function toWebSessionRecord(record: ConvexWebSessionRecord): WebSessionRecord {
    return {
        createdAt: new Date(record.createdAt),
        expiresAt: new Date(record.expiresAt),
        fluxerUserId: record.fluxerUserId,
        id: record.id,
        revokedAt: record.revokedAt ? new Date(record.revokedAt) : null,
    };
}

function toFluxerOAuthTokenRecord(record: ConvexFluxerOAuthTokenRecord): FluxerOAuthTokenRecord {
    return {
        accessToken: record.accessToken,
        accessTokenExpiresAt: new Date(record.accessTokenExpiresAt),
        credentialGeneration: record.credentialGeneration,
        createdAt: new Date(record.createdAt),
        fluxerUserId: record.fluxerUserId,
        invalidatedAt: record.invalidatedAt ? new Date(record.invalidatedAt) : null,
        refreshToken: record.refreshToken,
        scopes: record.scopes,
        tokenType: record.tokenType,
        updatedAt: new Date(record.updatedAt),
    };
}

function mapWebSessionError(error: unknown): WebSessionRepositoryError {
    if (!(error instanceof Error)) {
        return 'database-error';
    }

    if (error.message.includes('missing-session-id')) return 'missing-session-id';
    if (error.message.includes('missing-fluxer-user-id')) return 'missing-fluxer-user-id';
    if (error.message.includes('invalid-expiry')) return 'invalid-expiry';

    return 'database-error';
}

function mapFluxerOAuthTokenError(error: unknown): FluxerOAuthTokenRepositoryError {
    if (!(error instanceof Error)) {
        return 'database-error';
    }

    if (error.message.includes('missing-fluxer-user-id')) return 'missing-fluxer-user-id';
    if (error.message.includes('invalid-access-token')) return 'invalid-access-token';
    if (error.message.includes('invalid-refresh-token')) return 'invalid-refresh-token';
    if (error.message.includes('missing-token-type')) return 'missing-token-type';
    if (error.message.includes('invalid-expiry')) return 'invalid-expiry';
    if (error.message.includes('missing-scopes')) return 'missing-scopes';

    return 'database-error';
}

function isValidDate(date: Date): boolean {
    return Number.isFinite(date.getTime());
}

function isValidCredentialGeneration(value: number): boolean {
    return Number.isSafeInteger(value) && value >= 0;
}

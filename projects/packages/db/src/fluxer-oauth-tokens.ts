import { and, eq, isNull } from 'drizzle-orm';
import type { PgDatabase } from 'drizzle-orm/pg-core/db';
import type { PgQueryResultHKT } from 'drizzle-orm/pg-core/session';
import { err, ok, type Result } from 'neverthrow';

import type * as schema from './schema.js';
import { fluxerOauthTokens, type EncryptedOAuthTokenPayload } from './schema.js';

export type FluxerOAuthTokenRecord = {
    fluxerUserId: string;
    accessToken: EncryptedOAuthTokenPayload;
    refreshToken: EncryptedOAuthTokenPayload | null;
    tokenType: string;
    accessTokenExpiresAt: Date;
    scopes: string[];
    invalidatedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
};

export type FluxerOAuthTokenRepositoryError =
    | 'missing-fluxer-user-id'
    | 'invalid-access-token'
    | 'invalid-refresh-token'
    | 'missing-token-type'
    | 'invalid-expiry'
    | 'missing-scopes'
    | 'not-found'
    | 'database-error';

type FluxerOAuthTokenDatabase = PgDatabase<PgQueryResultHKT, typeof schema>;
type FluxerOAuthTokenRow = typeof fluxerOauthTokens.$inferSelect;

export async function upsertFluxerOAuthTokenSet(
    db: FluxerOAuthTokenDatabase,
    input: {
        fluxerUserId: string;
        accessToken: EncryptedOAuthTokenPayload;
        refreshToken?: EncryptedOAuthTokenPayload | null;
        tokenType: string;
        accessTokenExpiresAt: Date;
        scopes: readonly string[];
    }
): Promise<Result<FluxerOAuthTokenRecord, FluxerOAuthTokenRepositoryError>> {
    const fluxerUserIdResult = normalizeRequiredString(input.fluxerUserId, 'missing-fluxer-user-id');

    if (fluxerUserIdResult.isErr()) {
        return err(fluxerUserIdResult.error);
    }

    const accessTokenResult = normalizeEncryptedTokenPayload(input.accessToken, 'invalid-access-token');

    if (accessTokenResult.isErr()) {
        return err(accessTokenResult.error);
    }

    const refreshTokenResult = normalizeOptionalEncryptedTokenPayload(input.refreshToken, 'invalid-refresh-token');

    if (refreshTokenResult.isErr()) {
        return err(refreshTokenResult.error);
    }

    const tokenTypeResult = normalizeRequiredString(input.tokenType, 'missing-token-type');

    if (tokenTypeResult.isErr()) {
        return err(tokenTypeResult.error);
    }

    if (!isValidDate(input.accessTokenExpiresAt)) {
        return err('invalid-expiry');
    }

    const scopesResult = normalizeScopes(input.scopes);

    if (scopesResult.isErr()) {
        return err(scopesResult.error);
    }

    const updatedAt = new Date();

    try {
        const tokens = await db
            .insert(fluxerOauthTokens)
            .values({
                fluxerUserId: fluxerUserIdResult.value,
                accessToken: accessTokenResult.value,
                refreshToken: refreshTokenResult.value,
                tokenType: tokenTypeResult.value,
                accessTokenExpiresAt: input.accessTokenExpiresAt,
                scopes: scopesResult.value,
                invalidatedAt: null,
                updatedAt,
            })
            .onConflictDoUpdate({
                target: fluxerOauthTokens.fluxerUserId,
                set: {
                    accessToken: accessTokenResult.value,
                    refreshToken: refreshTokenResult.value,
                    tokenType: tokenTypeResult.value,
                    accessTokenExpiresAt: input.accessTokenExpiresAt,
                    scopes: scopesResult.value,
                    invalidatedAt: null,
                    updatedAt,
                },
            })
            .returning();
        const token = tokens[0];

        if (!token) {
            return err('database-error');
        }

        return ok(toFluxerOAuthTokenRecord(token));
    } catch {
        return err('database-error');
    }
}

export async function findUsableFluxerOAuthTokenSetByUserId(
    db: FluxerOAuthTokenDatabase,
    input: { fluxerUserId: string }
): Promise<Result<FluxerOAuthTokenRecord, FluxerOAuthTokenRepositoryError>> {
    const fluxerUserIdResult = normalizeRequiredString(input.fluxerUserId, 'missing-fluxer-user-id');

    if (fluxerUserIdResult.isErr()) {
        return err(fluxerUserIdResult.error);
    }

    try {
        const tokens = await db
            .select()
            .from(fluxerOauthTokens)
            .where(
                and(
                    eq(fluxerOauthTokens.fluxerUserId, fluxerUserIdResult.value),
                    isNull(fluxerOauthTokens.invalidatedAt)
                )
            )
            .limit(1);
        const token = tokens[0];

        if (!token) {
            return err('not-found');
        }

        return ok(toFluxerOAuthTokenRecord(token));
    } catch {
        return err('database-error');
    }
}

export async function invalidateFluxerOAuthTokenSet(
    db: FluxerOAuthTokenDatabase,
    input: {
        fluxerUserId: string;
        invalidatedAt?: Date;
    }
): Promise<Result<FluxerOAuthTokenRecord, FluxerOAuthTokenRepositoryError>> {
    const fluxerUserIdResult = normalizeRequiredString(input.fluxerUserId, 'missing-fluxer-user-id');

    if (fluxerUserIdResult.isErr()) {
        return err(fluxerUserIdResult.error);
    }

    const invalidatedAt = input.invalidatedAt ?? new Date();

    if (!isValidDate(invalidatedAt)) {
        return err('database-error');
    }

    try {
        const tokens = await db
            .update(fluxerOauthTokens)
            .set({ invalidatedAt })
            .where(eq(fluxerOauthTokens.fluxerUserId, fluxerUserIdResult.value))
            .returning();
        const token = tokens[0];

        if (!token) {
            return err('not-found');
        }

        return ok(toFluxerOAuthTokenRecord(token));
    } catch {
        return err('database-error');
    }
}

function normalizeRequiredString<E extends FluxerOAuthTokenRepositoryError>(
    value: string,
    error: E
): Result<string, E> {
    const normalizedValue = value.trim();

    if (normalizedValue.length === 0) {
        return err(error);
    }

    return ok(normalizedValue);
}

function normalizeEncryptedTokenPayload<E extends FluxerOAuthTokenRepositoryError>(
    value: unknown,
    error: E
): Result<EncryptedOAuthTokenPayload, E> {
    if (!isObjectRecord(value)) {
        return err(error);
    }

    const version = normalizePayloadString(value.version);
    const iv = normalizePayloadString(value.iv);
    const ciphertext = normalizePayloadString(value.ciphertext);
    const authTag = normalizePayloadString(value.authTag);

    if (!version || !iv || !ciphertext || !authTag) {
        return err(error);
    }

    return ok({
        version,
        iv,
        ciphertext,
        authTag,
    });
}

function normalizeOptionalEncryptedTokenPayload<E extends FluxerOAuthTokenRepositoryError>(
    value: unknown,
    error: E
): Result<EncryptedOAuthTokenPayload | null, E> {
    if (value === undefined || value === null) {
        return ok(null);
    }

    return normalizeEncryptedTokenPayload(value, error);
}

function normalizeScopes(scopes: readonly string[]): Result<string[], 'missing-scopes'> {
    const normalizedScopes = scopes.map((scope) => scope.trim()).filter((scope) => scope.length > 0);

    if (normalizedScopes.length === 0) {
        return err('missing-scopes');
    }

    return ok(normalizedScopes);
}

function normalizePayloadString(value: unknown): string | undefined {
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isValidDate(date: Date): boolean {
    return Number.isFinite(date.getTime());
}

function toFluxerOAuthTokenRecord(token: FluxerOAuthTokenRow): FluxerOAuthTokenRecord {
    return {
        fluxerUserId: token.fluxerUserId,
        accessToken: token.accessToken,
        refreshToken: token.refreshToken,
        tokenType: token.tokenType,
        accessTokenExpiresAt: token.accessTokenExpiresAt,
        scopes: token.scopes,
        invalidatedAt: token.invalidatedAt,
        createdAt: token.createdAt,
        updatedAt: token.updatedAt,
    };
}

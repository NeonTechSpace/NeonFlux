export type EncryptedOAuthTokenPayload = {
    authTag: string;
    ciphertext: string;
    iv: string;
    version: string;
};

export type WebSessionRecord = {
    createdAt: string;
    expiresAt: string;
    fluxerUserId: string;
    id: string;
    revokedAt: string | null;
};

export type FluxerOAuthTokenRecord = {
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

export type AuthStoreInputError =
    | 'invalid-access-token'
    | 'invalid-expiry'
    | 'invalid-generation'
    | 'invalid-refresh-token'
    | 'missing-fluxer-user-id'
    | 'missing-lease-id'
    | 'missing-lease-owner'
    | 'missing-scopes'
    | 'missing-session-id'
    | 'missing-token-type';

export type AuthStoreResult<Value> = { ok: true; value: Value } | { error: AuthStoreInputError; ok: false };

export type FluxerOAuthRefreshCoordinationState = {
    credentialGeneration?: number;
    invalidatedAt?: string;
    refreshLeaseExpiresAt?: string;
    refreshLeaseGeneration?: number;
    refreshLeaseId?: string;
    refreshRetryAfter?: string;
};

export type FluxerOAuthRefreshLeaseDecision =
    | { status: 'claimable' }
    | { retryAt: string; status: 'busy' | 'cooldown' }
    | { status: 'missing' | 'stale' };

export function normalizeRequiredString(value: string, error: AuthStoreInputError): AuthStoreResult<string> {
    const normalizedValue = value.trim();

    return normalizedValue ? { ok: true, value: normalizedValue } : { error, ok: false };
}

export function normalizeCredentialGeneration(value: number | undefined): AuthStoreResult<number> {
    const generation = value ?? 0;

    return Number.isSafeInteger(generation) && generation >= 0
        ? { ok: true, value: generation }
        : { error: 'invalid-generation', ok: false };
}

export function decideFluxerOAuthRefreshLeaseClaim(
    state: FluxerOAuthRefreshCoordinationState | null,
    input: { expectedGeneration: number; nowMs: number }
): FluxerOAuthRefreshLeaseDecision {
    if (!state || state.invalidatedAt) {
        return { status: 'missing' };
    }

    const generation = normalizeCredentialGeneration(state.credentialGeneration);

    if (!generation.ok || generation.value !== input.expectedGeneration) {
        return { status: 'stale' };
    }

    const retryAtMs = Date.parse(state.refreshRetryAfter ?? '');

    if (Number.isFinite(retryAtMs) && retryAtMs > input.nowMs) {
        return { retryAt: new Date(retryAtMs).toISOString(), status: 'cooldown' };
    }

    const leaseExpiresAtMs = Date.parse(state.refreshLeaseExpiresAt ?? '');
    const hasMatchingActiveLease =
        Boolean(state.refreshLeaseId) &&
        state.refreshLeaseGeneration === generation.value &&
        Number.isFinite(leaseExpiresAtMs) &&
        leaseExpiresAtMs > input.nowMs;

    return hasMatchingActiveLease
        ? { retryAt: new Date(leaseExpiresAtMs).toISOString(), status: 'busy' }
        : { status: 'claimable' };
}

export function matchesFluxerOAuthRefreshLease(
    state: FluxerOAuthRefreshCoordinationState | null,
    input: { expectedGeneration: number; leaseId: string }
): boolean {
    if (!state || state.invalidatedAt) {
        return false;
    }

    const generation = normalizeCredentialGeneration(state.credentialGeneration);

    return (
        generation.ok &&
        generation.value === input.expectedGeneration &&
        state.refreshLeaseGeneration === input.expectedGeneration &&
        state.refreshLeaseId === input.leaseId
    );
}

export function normalizeFutureTimestamp(
    value: string,
    nowMs = Date.now()
): AuthStoreResult<{ isoString: string; timeMs: number }> {
    const parsedTimeMs = Date.parse(value);

    if (!Number.isFinite(parsedTimeMs) || parsedTimeMs <= nowMs) {
        return { error: 'invalid-expiry', ok: false };
    }

    return { ok: true, value: { isoString: new Date(parsedTimeMs).toISOString(), timeMs: parsedTimeMs } };
}

export function normalizeTimestamp(value: string): AuthStoreResult<string> {
    const parsedTimeMs = Date.parse(value);

    if (!Number.isFinite(parsedTimeMs)) {
        return { error: 'invalid-expiry', ok: false };
    }

    return { ok: true, value: new Date(parsedTimeMs).toISOString() };
}

export function normalizeEncryptedTokenPayload(
    value: EncryptedOAuthTokenPayload,
    error: 'invalid-access-token' | 'invalid-refresh-token'
): AuthStoreResult<EncryptedOAuthTokenPayload> {
    const version = normalizePayloadString(value.version);
    const iv = normalizePayloadString(value.iv);
    const ciphertext = normalizePayloadString(value.ciphertext);
    const authTag = normalizePayloadString(value.authTag);

    if (!version || !iv || !ciphertext || !authTag) {
        return { error, ok: false };
    }

    return {
        ok: true,
        value: {
            authTag,
            ciphertext,
            iv,
            version,
        },
    };
}

export function normalizeOptionalEncryptedTokenPayload(
    value: EncryptedOAuthTokenPayload | null | undefined
): AuthStoreResult<EncryptedOAuthTokenPayload | undefined> {
    if (!value) {
        return { ok: true, value: undefined };
    }

    return normalizeEncryptedTokenPayload(value, 'invalid-refresh-token');
}

export function normalizeScopes(scopes: readonly string[]): AuthStoreResult<string[]> {
    const normalizedScopes = scopes.map((scope) => scope.trim()).filter((scope) => scope.length > 0);

    if (normalizedScopes.length === 0) {
        return { error: 'missing-scopes', ok: false };
    }

    return { ok: true, value: normalizedScopes };
}

export function isActiveSession(session: { expiresAt: string; revokedAt?: string }, nowMs = Date.now()): boolean {
    return !session.revokedAt && Date.parse(session.expiresAt) > nowMs;
}

function normalizePayloadString(value: string): string | undefined {
    const normalizedValue = value.trim();

    return normalizedValue.length > 0 ? normalizedValue : undefined;
}

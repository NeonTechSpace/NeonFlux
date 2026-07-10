import { err, ok, type Result } from 'neverthrow';

export const FLUXER_AUTHORIZE_URL = 'https://web.fluxer.app/oauth2/authorize';
export const FLUXER_OAUTH_TOKEN_URL = 'https://api.fluxer.app/v1/oauth2/token';
export const FLUXER_OAUTH_REFRESH_MAX_ATTEMPTS = 3;
export const FLUXER_OAUTH_REFRESH_MAX_RETRY_DELAY_MS = 5_000;
export const FLUXER_OAUTH_REQUEST_TIMEOUT_MS = 10_000;

const MAX_OAUTH_EXPIRES_IN_SECONDS = 2_147_483_647;
const OAUTH_REFRESH_RETRY_BASE_DELAY_MS = 250;

export type FluxerOAuthScope = 'identify' | 'guilds' | 'email' | 'connections' | 'bot';

export type BuildFluxerAuthorizeUrlInput = {
    appId: string;
    redirectUrl: string;
    scopes: readonly FluxerOAuthScope[];
    state?: string;
};

export type ExchangeFluxerAuthorizationCodeInput = {
    appId: string;
    clientSecret: string;
    code: string;
    redirectUrl: string;
};

export type RefreshFluxerOAuthTokenInput = {
    appId: string;
    clientSecret: string;
    refreshToken: string;
};

export type FluxerOAuthTokenResponse = {
    accessToken: string;
    tokenType: string;
    expiresIn: number;
    refreshToken: string;
    scope: string;
};

export type FluxerOAuthTokenExchangeError =
    | { type: 'missing-input'; field: 'appId' | 'clientSecret' | 'code' | 'redirectUrl' }
    | { type: 'request-failed'; status: number; statusText: string }
    | { type: 'network-error'; error: unknown }
    | { type: 'invalid-response' };

export type FluxerOAuthTokenRefreshError =
    | { type: 'missing-input'; field: 'appId' | 'clientSecret' | 'refreshToken' }
    | { type: 'request-failed'; status: number; statusText: string }
    | { type: 'ambiguous-response' }
    | { type: 'network-error' }
    | { type: 'terminal-response'; errorCode: 'invalid_grant'; status: number }
    | { type: 'transient-response'; retryAfterMs?: number; status: number; statusText: string }
    | { type: 'invalid-response' };

export function buildFluxerAuthorizeUrl(input: BuildFluxerAuthorizeUrlInput): string {
    const appId = input.appId.trim();
    const redirectUrl = input.redirectUrl.trim();
    const state = input.state?.trim();

    requireValue(appId, 'appId');
    requireValue(redirectUrl, 'redirectUrl');

    if (input.scopes.length === 0) {
        throw new Error('scopes is required');
    }

    if (input.state !== undefined) {
        requireValue(state ?? '', 'state');
    }

    const url = new URL(FLUXER_AUTHORIZE_URL);
    url.searchParams.set('client_id', appId);
    url.searchParams.set('scope', input.scopes.join(' '));
    url.searchParams.set('redirect_uri', redirectUrl);
    url.searchParams.set('response_type', 'code');

    if (state !== undefined) {
        url.searchParams.set('state', state);
    }

    return url.toString();
}

export async function exchangeFluxerAuthorizationCode(
    input: ExchangeFluxerAuthorizationCodeInput
): Promise<Result<FluxerOAuthTokenResponse, FluxerOAuthTokenExchangeError>> {
    const appId = input.appId.trim();
    const clientSecret = input.clientSecret.trim();
    const code = input.code.trim();
    const redirectUrl = input.redirectUrl.trim();

    if (!appId) {
        return err({ type: 'missing-input', field: 'appId' });
    }

    if (!clientSecret) {
        return err({ type: 'missing-input', field: 'clientSecret' });
    }

    if (!code) {
        return err({ type: 'missing-input', field: 'code' });
    }

    if (!redirectUrl) {
        return err({ type: 'missing-input', field: 'redirectUrl' });
    }

    const body = new FormData();
    body.set('grant_type', 'authorization_code');
    body.set('code', code);
    body.set('redirect_uri', redirectUrl);
    body.set('client_id', appId);
    body.set('client_secret', clientSecret);

    return submitFluxerOAuthTokenRequest(body);
}

export async function refreshFluxerOAuthToken(
    input: RefreshFluxerOAuthTokenInput
): Promise<Result<FluxerOAuthTokenResponse, FluxerOAuthTokenRefreshError>> {
    const appId = input.appId.trim();
    const clientSecret = input.clientSecret.trim();
    const refreshToken = input.refreshToken.trim();

    if (!appId) {
        return err({ type: 'missing-input', field: 'appId' });
    }

    if (!clientSecret) {
        return err({ type: 'missing-input', field: 'clientSecret' });
    }

    if (!refreshToken) {
        return err({ type: 'missing-input', field: 'refreshToken' });
    }

    const body = new FormData();
    body.set('grant_type', 'refresh_token');
    body.set('refresh_token', refreshToken);
    body.set('client_id', appId);
    body.set('client_secret', clientSecret);

    return submitFluxerOAuthRefreshRequest(body);
}

function requireValue(value: string, name: string): void {
    if (value.length === 0) {
        throw new Error(`${name} is required`);
    }
}

type FluxerOAuthTokenRequestError =
    | { type: 'request-failed'; status: number; statusText: string }
    | { type: 'network-error'; error: unknown }
    | { type: 'invalid-response' };

async function submitFluxerOAuthTokenRequest(
    body: FormData
): Promise<Result<FluxerOAuthTokenResponse, FluxerOAuthTokenRequestError>> {
    let response: Response;

    try {
        response = await fetch(FLUXER_OAUTH_TOKEN_URL, {
            method: 'POST',
            body,
            signal: AbortSignal.timeout(FLUXER_OAUTH_REQUEST_TIMEOUT_MS),
        });
    } catch (error) {
        return err({ type: 'network-error', error });
    }

    if (!response.ok) {
        return err({
            type: 'request-failed',
            status: response.status,
            statusText: response.statusText,
        });
    }

    let responseBody: unknown;

    try {
        responseBody = await response.json();
    } catch {
        return err({ type: 'invalid-response' });
    }

    const tokenResponse = parseFluxerOAuthTokenResponse(responseBody);

    if (!tokenResponse) {
        return err({ type: 'invalid-response' });
    }

    return ok(tokenResponse);
}

async function submitFluxerOAuthRefreshRequest(
    body: FormData
): Promise<Result<FluxerOAuthTokenResponse, FluxerOAuthTokenRefreshError>> {
    let hadAmbiguousAttempt = false;

    for (let attempt = 0; attempt < FLUXER_OAUTH_REFRESH_MAX_ATTEMPTS; attempt += 1) {
        let response: Response;

        try {
            response = await fetch(FLUXER_OAUTH_TOKEN_URL, {
                body,
                method: 'POST',
                signal: AbortSignal.timeout(FLUXER_OAUTH_REQUEST_TIMEOUT_MS),
            });
        } catch {
            hadAmbiguousAttempt = true;

            if (attempt + 1 >= FLUXER_OAUTH_REFRESH_MAX_ATTEMPTS) {
                return err({ type: 'network-error' });
            }

            await waitForOAuthRetry(readOAuthRetryDelayMs(undefined, attempt));
            continue;
        }

        if (response.ok) {
            return parseFluxerOAuthTokenResponseResult(response);
        }

        const retryAfterMs = readOAuthRetryDelayMs(response.headers.get('Retry-After'), attempt);

        if (isTransientOAuthStatus(response.status)) {
            hadAmbiguousAttempt ||= response.status >= 500;

            if (attempt + 1 < FLUXER_OAUTH_REFRESH_MAX_ATTEMPTS) {
                await waitForOAuthRetry(retryAfterMs);
                continue;
            }

            return err({
                type: 'transient-response',
                retryAfterMs,
                status: response.status,
                statusText: response.statusText,
            });
        }

        const errorCode = await readOAuthErrorCode(response);

        if (errorCode === 'invalid_grant' && !hadAmbiguousAttempt) {
            return err({
                type: 'terminal-response',
                errorCode,
                status: response.status,
            });
        }

        if (hadAmbiguousAttempt) {
            return err({ type: 'ambiguous-response' });
        }

        return err({
            type: 'request-failed',
            status: response.status,
            statusText: response.statusText,
        });
    }

    return err({ type: 'network-error' });
}

async function parseFluxerOAuthTokenResponseResult(
    response: Response
): Promise<Result<FluxerOAuthTokenResponse, { type: 'invalid-response' }>> {
    let responseBody: unknown;

    try {
        responseBody = await response.json();
    } catch {
        return err({ type: 'invalid-response' });
    }

    const tokenResponse = parseFluxerOAuthTokenResponse(responseBody);

    return tokenResponse ? ok(tokenResponse) : err({ type: 'invalid-response' });
}

async function readOAuthErrorCode(response: Response): Promise<string | undefined> {
    try {
        const body = (await response.json()) as unknown;

        if (isObject(body) && typeof body.error === 'string') {
            const errorCode = body.error.trim().toLowerCase();

            return errorCode || undefined;
        }
    } catch {
        return undefined;
    }

    return undefined;
}

function isTransientOAuthStatus(status: number): boolean {
    return status === 429 || (status >= 500 && status <= 599);
}

function readOAuthRetryDelayMs(retryAfter: string | null | undefined, attempt: number): number {
    const fallbackDelay = Math.min(
        OAUTH_REFRESH_RETRY_BASE_DELAY_MS * 2 ** attempt,
        FLUXER_OAUTH_REFRESH_MAX_RETRY_DELAY_MS
    );

    if (!retryAfter) {
        return fallbackDelay;
    }

    const seconds = Number(retryAfter);
    const retryAtMs = Date.parse(retryAfter);
    const parsedDelay = Number.isFinite(seconds) && seconds >= 0 ? seconds * 1_000 : retryAtMs - Date.now();

    return Number.isFinite(parsedDelay)
        ? Math.min(Math.max(0, parsedDelay), FLUXER_OAUTH_REFRESH_MAX_RETRY_DELAY_MS)
        : fallbackDelay;
}

function waitForOAuthRetry(delayMs: number): Promise<void> {
    return new Promise((resolve) => {
        setTimeout(resolve, delayMs);
    });
}

function parseFluxerOAuthTokenResponse(value: unknown): FluxerOAuthTokenResponse | undefined {
    if (!isObject(value)) {
        return undefined;
    }

    const accessToken = value.access_token;
    const tokenType = value.token_type;
    const expiresIn = value.expires_in;
    const refreshToken = value.refresh_token;
    const scope = value.scope;

    if (
        typeof accessToken !== 'string' ||
        typeof tokenType !== 'string' ||
        !isValidExpiresIn(expiresIn) ||
        typeof refreshToken !== 'string' ||
        typeof scope !== 'string'
    ) {
        return undefined;
    }

    return {
        accessToken,
        tokenType,
        expiresIn,
        refreshToken,
        scope,
    };
}

function isObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}

function isValidExpiresIn(value: unknown): value is number {
    return typeof value === 'number' && Number.isInteger(value) && value > 0 && value <= MAX_OAUTH_EXPIRES_IN_SECONDS;
}

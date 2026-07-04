import type { AuthConfig } from 'convex/server';

const privateJwkParameters = ['d', 'p', 'q', 'dp', 'dq', 'qi', 'oth'] as const;
const base64UrlPattern = /^[A-Za-z0-9_-]+$/u;

type ConvexAuthEnvironment = Partial<
    Pick<NodeJS.ProcessEnv, 'NEONFLUX_AUTH_JWT_AUDIENCE' | 'NEONFLUX_AUTH_JWT_ISSUER' | 'NEONFLUX_AUTH_JWT_JWKS'>
>;

export function createAuthConfigForEnv(env: ConvexAuthEnvironment = process.env): AuthConfig {
    const issuer = optionalValue(env.NEONFLUX_AUTH_JWT_ISSUER);
    const applicationID = optionalValue(env.NEONFLUX_AUTH_JWT_AUDIENCE);
    const jwks = optionalValue(env.NEONFLUX_AUTH_JWT_JWKS);
    const authIntent = Boolean(issuer ?? applicationID ?? jwks);

    if (!authIntent) {
        return { providers: [] };
    }

    if (!issuer) {
        throw new Error('NEONFLUX_AUTH_JWT_ISSUER is required for Convex auth config');
    }

    if (!applicationID) {
        throw new Error('NEONFLUX_AUTH_JWT_AUDIENCE is required for Convex auth config');
    }

    if (!jwks) {
        throw new Error('NEONFLUX_AUTH_JWT_JWKS is required for Convex auth config');
    }

    assertNeonFluxIssuer(issuer);

    return {
        providers: [
            {
                algorithm: 'RS256',
                applicationID,
                issuer,
                jwks: normalizeJwksConfig(jwks),
                type: 'customJwt',
            },
        ],
    };
}

function optionalValue(value: string | undefined): string | undefined {
    const trimmed = value?.trim();
    return trimmed && trimmed.length > 0 ? trimmed : undefined;
}

function assertNeonFluxIssuer(value: string): void {
    const url = parseHttpUrl(value, 'NEONFLUX_AUTH_JWT_ISSUER');

    if (url.hostname.toLowerCase().endsWith('fluxer.app')) {
        throw new Error('NEONFLUX_AUTH_JWT_ISSUER must be a NeonFlux issuer, not a Fluxer OAuth host');
    }
}

function parseHttpUrl(value: string, name: string): URL {
    let url: URL;

    try {
        url = new URL(value);
    } catch (error) {
        throw new Error(`${name} must be a valid HTTP or HTTPS URL`, { cause: error });
    }

    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        throw new Error(`${name} must be a valid HTTP or HTTPS URL`);
    }

    return url;
}

function normalizeJwksConfig(value: string): string {
    let url: URL;

    try {
        url = new URL(value);
    } catch (error) {
        throw new Error('NEONFLUX_AUTH_JWT_JWKS must be a valid HTTP(S) URL or JWKS data URI', { cause: error });
    }

    if (url.protocol !== 'data:' && url.protocol !== 'http:' && url.protocol !== 'https:') {
        throw new Error('NEONFLUX_AUTH_JWT_JWKS must be a valid HTTP(S) URL or JWKS data URI');
    }

    if (url.protocol === 'data:') {
        assertPublicJwksDataUri(value);
    }

    return url.protocol === 'data:' ? value : url.toString();
}

function assertPublicJwksDataUri(value: string): void {
    const commaIndex = value.indexOf(',');

    if (commaIndex < 0) {
        throw new Error('NEONFLUX_AUTH_JWT_JWKS must include a comma-separated data payload');
    }

    const metadata = value.slice('data:'.length, commaIndex).toLowerCase();
    const encodedPayload = value.slice(commaIndex + 1);
    const isBase64 = metadata.split(';').includes('base64');
    let body: string;

    try {
        body = isBase64 ? Buffer.from(encodedPayload, 'base64').toString('utf8') : decodeURIComponent(encodedPayload);
    } catch (error) {
        throw new Error('NEONFLUX_AUTH_JWT_JWKS data URI could not be decoded', { cause: error });
    }

    let jwks: unknown;

    try {
        jwks = JSON.parse(body);
    } catch (error) {
        throw new Error('NEONFLUX_AUTH_JWT_JWKS data URI must decode to JSON', { cause: error });
    }

    if (!isObjectRecord(jwks) || !Array.isArray(jwks.keys) || jwks.keys.length === 0) {
        throw new Error('NEONFLUX_AUTH_JWT_JWKS must contain a non-empty "keys" array');
    }

    for (const [index, key] of jwks.keys.entries()) {
        if (!isObjectRecord(key)) {
            throw new Error(`NEONFLUX_AUTH_JWT_JWKS has a non-object key at index ${index}`);
        }

        const leakedParameter = privateJwkParameters.find((parameter) => parameter in key);

        if (leakedParameter) {
            throw new Error(`NEONFLUX_AUTH_JWT_JWKS exposes private JWK parameter "${leakedParameter}"`);
        }

        assertPublicRsaSigningJwk(key, index);
    }
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function assertPublicRsaSigningJwk(key: Record<string, unknown>, index: number): void {
    if (key.kty !== 'RSA') {
        throw new Error(`NEONFLUX_AUTH_JWT_JWKS key at index ${index} must be an RSA public JWK`);
    }

    if (!isNonEmptyString(key.kid)) {
        throw new Error(`NEONFLUX_AUTH_JWT_JWKS key at index ${index} must include a non-empty "kid"`);
    }

    if (key.alg !== 'RS256') {
        throw new Error(`NEONFLUX_AUTH_JWT_JWKS key at index ${index} must use alg "RS256"`);
    }

    if (key.use !== 'sig') {
        throw new Error(`NEONFLUX_AUTH_JWT_JWKS key at index ${index} must use "sig"`);
    }

    for (const parameter of ['n', 'e'] as const) {
        if (!isBase64UrlString(key[parameter])) {
            throw new Error(
                `NEONFLUX_AUTH_JWT_JWKS key at index ${index} must include public RSA parameter "${parameter}"`
            );
        }
    }
}

function isNonEmptyString(value: unknown): value is string {
    return typeof value === 'string' && value.trim().length > 0;
}

function isBase64UrlString(value: unknown): value is string {
    return isNonEmptyString(value) && base64UrlPattern.test(value);
}

export default createAuthConfigForEnv();

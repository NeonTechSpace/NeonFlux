import type { AuthConfig } from 'convex/server';

const privateJwkParameters = ['d', 'p', 'q', 'dp', 'dq', 'qi', 'oth'] as const;
const base64UrlPattern = /^[A-Za-z0-9_-]+$/u;

type ConvexAuthEnvironment = Partial<
    Pick<
        NodeJS.ProcessEnv,
        | 'NEONFLUX_BOT_AUTH_JWT_AUDIENCE'
        | 'NEONFLUX_BOT_AUTH_JWT_ISSUER'
        | 'NEONFLUX_BOT_AUTH_JWT_JWKS'
        | 'NEONFLUX_USER_AUTH_JWT_AUDIENCE'
        | 'NEONFLUX_USER_AUTH_JWT_ISSUER'
        | 'NEONFLUX_USER_AUTH_JWT_JWKS'
        | 'NEONFLUX_WEB_AUTH_JWT_AUDIENCE'
        | 'NEONFLUX_WEB_AUTH_JWT_ISSUER'
        | 'NEONFLUX_WEB_AUTH_JWT_JWKS'
    >
>;

export function createAuthConfigForEnv(env: ConvexAuthEnvironment = process.env): AuthConfig {
    const providerInputs = [
        {
            applicationID: optionalValue(env.NEONFLUX_BOT_AUTH_JWT_AUDIENCE),
            issuer: optionalValue(env.NEONFLUX_BOT_AUTH_JWT_ISSUER),
            jwks: optionalValue(env.NEONFLUX_BOT_AUTH_JWT_JWKS),
            prefix: 'NEONFLUX_BOT_AUTH_JWT',
        },
        {
            applicationID: optionalValue(env.NEONFLUX_WEB_AUTH_JWT_AUDIENCE),
            issuer: optionalValue(env.NEONFLUX_WEB_AUTH_JWT_ISSUER),
            jwks: optionalValue(env.NEONFLUX_WEB_AUTH_JWT_JWKS),
            prefix: 'NEONFLUX_WEB_AUTH_JWT',
        },
        {
            applicationID: optionalValue(env.NEONFLUX_USER_AUTH_JWT_AUDIENCE),
            issuer: optionalValue(env.NEONFLUX_USER_AUTH_JWT_ISSUER),
            jwks: optionalValue(env.NEONFLUX_USER_AUTH_JWT_JWKS),
            prefix: 'NEONFLUX_USER_AUTH_JWT',
        },
    ];
    const authIntent = providerInputs.some(({ applicationID, issuer, jwks }) =>
        Boolean(applicationID ?? issuer ?? jwks)
    );

    if (!authIntent) {
        return { providers: [] };
    }

    const providers = providerInputs.map(({ applicationID, issuer, jwks, prefix }) => {
        if (!issuer) throw new Error(`${prefix}_ISSUER is required for Convex auth config`);
        if (!applicationID) throw new Error(`${prefix}_AUDIENCE is required for Convex auth config`);
        if (!jwks) throw new Error(`${prefix}_JWKS is required for Convex auth config`);

        const normalizedIssuer = normalizeNeonFluxIssuer(issuer, `${prefix}_ISSUER`);

        return {
            algorithm: 'RS256' as const,
            applicationID,
            issuer: normalizedIssuer,
            jwks: normalizeJwksConfig(jwks, `${prefix}_JWKS`),
            type: 'customJwt' as const,
        };
    });
    const issuers = new Set(providers.map((provider) => provider.issuer));

    if (issuers.size !== providers.length) {
        throw new Error('Bot, web, and user Convex JWT issuers must be distinct');
    }

    return { providers };
}

function optionalValue(value: string | undefined): string | undefined {
    const trimmed = value?.trim();
    return trimmed && trimmed.length > 0 ? trimmed : undefined;
}

function normalizeNeonFluxIssuer(value: string, name: string): string {
    const url = parseHttpUrl(value, name);

    if (url.hostname.toLowerCase().endsWith('fluxer.app')) {
        throw new Error(`${name} must be a NeonFlux issuer, not a Fluxer OAuth host`);
    }

    return url.toString();
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

function normalizeJwksConfig(value: string, name: string): string {
    let url: URL;

    try {
        url = new URL(value);
    } catch (error) {
        throw new Error(`${name} must be a valid HTTP(S) URL or JWKS data URI`, { cause: error });
    }

    if (url.protocol !== 'data:' && url.protocol !== 'http:' && url.protocol !== 'https:') {
        throw new Error(`${name} must be a valid HTTP(S) URL or JWKS data URI`);
    }

    if (url.protocol === 'data:') {
        assertPublicJwksDataUri(value, name);
    }

    return url.protocol === 'data:' ? value : url.toString();
}

function assertPublicJwksDataUri(value: string, name: string): void {
    const commaIndex = value.indexOf(',');

    if (commaIndex < 0) {
        throw new Error(`${name} must include a comma-separated data payload`);
    }

    const metadata = value.slice('data:'.length, commaIndex).toLowerCase();
    const encodedPayload = value.slice(commaIndex + 1);
    const isBase64 = metadata.split(';').includes('base64');
    let body: string;

    try {
        body = isBase64 ? Buffer.from(encodedPayload, 'base64').toString('utf8') : decodeURIComponent(encodedPayload);
    } catch (error) {
        throw new Error(`${name} data URI could not be decoded`, { cause: error });
    }

    let jwks: unknown;

    try {
        jwks = JSON.parse(body);
    } catch (error) {
        throw new Error(`${name} data URI must decode to JSON`, { cause: error });
    }

    if (!isObjectRecord(jwks) || !Array.isArray(jwks.keys) || jwks.keys.length === 0) {
        throw new Error(`${name} must contain a non-empty "keys" array`);
    }

    for (const [index, key] of jwks.keys.entries()) {
        if (!isObjectRecord(key)) {
            throw new Error(`${name} has a non-object key at index ${String(index)}`);
        }

        const leakedParameter = privateJwkParameters.find((parameter) => parameter in key);

        if (leakedParameter) {
            throw new Error(`${name} exposes private JWK parameter "${leakedParameter}"`);
        }

        assertPublicRsaSigningJwk(key, index, name);
    }
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function assertPublicRsaSigningJwk(key: Record<string, unknown>, index: number, name: string): void {
    const keyIndex = String(index);

    if (key.kty !== 'RSA') {
        throw new Error(`${name} key at index ${keyIndex} must be an RSA public JWK`);
    }

    if (!isNonEmptyString(key.kid)) {
        throw new Error(`${name} key at index ${keyIndex} must include a non-empty "kid"`);
    }

    if (key.alg !== 'RS256') {
        throw new Error(`${name} key at index ${keyIndex} must use alg "RS256"`);
    }

    if (key.use !== 'sig') {
        throw new Error(`${name} key at index ${keyIndex} must use "sig"`);
    }

    for (const parameter of ['n', 'e'] as const) {
        if (!isBase64UrlString(key[parameter])) {
            throw new Error(`${name} key at index ${keyIndex} must include public RSA parameter "${parameter}"`);
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

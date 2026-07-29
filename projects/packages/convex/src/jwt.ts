import { Buffer } from 'node:buffer';
import { createPrivateKey, createPublicKey } from 'node:crypto';

import {
    createLocalJWKSet,
    createRemoteJWKSet,
    importPKCS8,
    jwtVerify,
    SignJWT,
    type JWTVerifyGetKey,
    type JWTPayload,
} from 'jose';

const defaultKeyId = 'neonflux-convex-auth';
const defaultUserTokenLifetimeSeconds = 5 * 60;
const defaultServiceTokenLifetimeSeconds = 10 * 60;
const defaultPostingDelegationTokenLifetimeSeconds = 45;
const privateJwkParameters = ['d', 'p', 'q', 'dp', 'dq', 'qi', 'oth'] as const;
const base64UrlPattern = /^[A-Za-z0-9_-]+$/u;

export type NeonFluxJwtSignerConfig = {
    privateKeyPem: string;
} & NeonFluxJwtVerifierConfig;

export type NeonFluxJwtVerifierConfig = {
    audience: string;
    issuer: string;
    keyId?: string;
};

export type NeonFluxUserJwtInput = {
    expiresInSeconds?: number;
    fluxerUserId: string;
    manageableGuildIds?: string[];
    now?: Date;
    sessionId: string;
};

export type NeonFluxServiceJwtInput = {
    expiresInSeconds?: number;
    now?: Date;
    serviceName: 'bot' | 'web';
};

export type NeonFluxPostingDelegationJwtInput = {
    actorUserId: string;
    expiresInSeconds?: number;
    guildId: string;
    now?: Date;
    payloadHash: string;
    requestKey: string;
    requestedChannelId: string;
    retryOfOperationId?: string;
};

export type NeonFluxJwtClaims =
    | {
          fluxerUserId: string;
          kind: 'user';
          manageableGuildIds?: string[];
          sessionId: string;
      }
    | {
          kind: 'service';
          serviceName: 'bot' | 'web';
      }
    | {
          actorUserId: string;
          guildId: string;
          kind: 'posting-delegation';
          payloadHash: string;
          requestKey: string;
          requestedChannelId: string;
          retryOfOperationId?: string;
      };

export type NeonFluxJwtPayload = JWTPayload & {
    neonflux: NeonFluxJwtClaims;
};

export type LegacyNeonFluxJwtPayload = JWTPayload & {
    fluxerUserId?: string;
    kind: 'service' | 'user';
    manageableGuildIds?: string[];
    serviceName?: string;
    sessionId?: string;
};

export type NeonFluxPublicJwk = Record<string, unknown> & {
    alg: 'RS256';
    kid: string;
    use: 'sig';
};

export type NeonFluxJwks = {
    keys: NeonFluxPublicJwk[];
};

export async function signNeonFluxUserJwt(
    config: NeonFluxJwtSignerConfig,
    input: NeonFluxUserJwtInput
): Promise<string> {
    return signNeonFluxJwt(config, {
        claims: {
            fluxerUserId: input.fluxerUserId,
            kind: 'user',
            ...(input.manageableGuildIds ? { manageableGuildIds: input.manageableGuildIds } : {}),
            sessionId: input.sessionId,
        },
        expiresInSeconds: input.expiresInSeconds ?? defaultUserTokenLifetimeSeconds,
        ...(input.now ? { now: input.now } : {}),
        subject: `fluxer-user:${input.fluxerUserId}`,
    });
}

export async function signNeonFluxServiceJwt(
    config: NeonFluxJwtSignerConfig,
    input: NeonFluxServiceJwtInput
): Promise<string> {
    return signNeonFluxJwt(config, {
        claims: {
            kind: 'service',
            serviceName: input.serviceName,
        },
        expiresInSeconds: input.expiresInSeconds ?? defaultServiceTokenLifetimeSeconds,
        ...(input.now ? { now: input.now } : {}),
        subject: `service:${input.serviceName}`,
    });
}

export async function signNeonFluxPostingDelegationJwt(
    config: NeonFluxJwtSignerConfig,
    input: NeonFluxPostingDelegationJwtInput
): Promise<string> {
    return signNeonFluxJwt(config, {
        claims: {
            actorUserId: input.actorUserId,
            guildId: input.guildId,
            kind: 'posting-delegation',
            payloadHash: input.payloadHash,
            requestKey: input.requestKey,
            requestedChannelId: input.requestedChannelId,
            ...(input.retryOfOperationId ? { retryOfOperationId: input.retryOfOperationId } : {}),
        },
        expiresInSeconds: input.expiresInSeconds ?? defaultPostingDelegationTokenLifetimeSeconds,
        ...(input.now ? { now: input.now } : {}),
        subject: `posting-delegation:${input.actorUserId}:${input.requestKey}`,
    });
}

export function createNeonFluxJwks(config: NeonFluxJwtSignerConfig): NeonFluxJwks {
    const privateKey = createPrivateKey(normalizePrivateKeyPem(config.privateKeyPem));
    const publicKey = createPublicKey(privateKey);
    const jwk = publicKey.export({ format: 'jwk' }) as Record<string, unknown>;

    return {
        keys: [
            {
                ...jwk,
                alg: 'RS256',
                kid: config.keyId ?? defaultKeyId,
                use: 'sig',
            },
        ],
    };
}

export function createNeonFluxJwksDataUri(config: NeonFluxJwtSignerConfig): string {
    return `data:application/json,${encodeURIComponent(JSON.stringify(createNeonFluxJwks(config)))}`;
}

export function createNeonFluxJwkSetFromJwksConfig(value: string): JWTVerifyGetKey {
    const url = parseJwksConfigUrl(value, 'NEONFLUX_AUTH_JWT_JWKS');

    if (url.protocol === 'data:') {
        return createLocalJWKSet(parseNeonFluxJwksDataUri(value, 'NEONFLUX_AUTH_JWT_JWKS'));
    }

    return createRemoteJWKSet(url);
}

export function parseNeonFluxJwksDataUri(value: string, source = 'JWKS data URI'): NeonFluxJwks {
    const normalizedValue = value.trim();
    const url = parseJwksConfigUrl(normalizedValue, source);

    if (url.protocol !== 'data:') {
        throw new Error(`${source} must be a JWKS data URI`);
    }

    const commaIndex = normalizedValue.indexOf(',');

    if (commaIndex < 0) {
        throw new Error(`${source} must include a comma-separated data payload`);
    }

    const metadata = normalizedValue.slice('data:'.length, commaIndex).toLowerCase();
    const encodedPayload = normalizedValue.slice(commaIndex + 1);
    const isBase64 = metadata.split(';').includes('base64');
    let body: string;

    try {
        body = isBase64 ? Buffer.from(encodedPayload, 'base64').toString('utf8') : decodeURIComponent(encodedPayload);
    } catch (error) {
        throw new Error(`${source} could not be decoded`, { cause: error });
    }

    let jwks: unknown;

    try {
        jwks = JSON.parse(body);
    } catch (error) {
        throw new Error(`${source} must decode to JSON`, { cause: error });
    }

    assertPublicNeonFluxJwks(jwks, source);

    return jwks;
}

export function assertPublicNeonFluxJwks(jwks: unknown, source = 'JWKS'): asserts jwks is NeonFluxJwks {
    if (!isObjectRecord(jwks) || !Array.isArray(jwks.keys) || jwks.keys.length === 0) {
        throw new Error(`${source} must contain a non-empty "keys" array`);
    }

    for (const [index, key] of jwks.keys.entries()) {
        if (!isObjectRecord(key)) {
            throw new Error(`${source} has a non-object key at index ${String(index)}`);
        }

        const leakedParameter = privateJwkParameters.find((parameter) => parameter in key);

        if (leakedParameter) {
            throw new Error(
                `${source} exposes private JWK parameter "${leakedParameter}" at key index ${String(index)}`
            );
        }

        assertPublicRsaSigningJwk(key, index, source);
    }
}

export async function verifyNeonFluxJwt(config: NeonFluxJwtSignerConfig, token: string): Promise<NeonFluxJwtPayload> {
    const jwks = createLocalJWKSet(createNeonFluxJwks(config));

    return verifyNeonFluxJwtWithJwkSet(config, token, jwks);
}

export async function verifyNeonFluxJwtWithRemoteJwks(
    config: NeonFluxJwtVerifierConfig,
    token: string
): Promise<NeonFluxJwtPayload> {
    const jwks = createRemoteJWKSet(new URL('/.well-known/jwks.json', config.issuer));

    return verifyNeonFluxJwtWithJwkSet(config, token, jwks);
}

export async function verifyNeonFluxJwtWithConfiguredJwks(
    config: NeonFluxJwtVerifierConfig,
    token: string,
    jwksConfig: string
): Promise<NeonFluxJwtPayload> {
    return verifyNeonFluxJwtWithJwkSet(config, token, createNeonFluxJwkSetFromJwksConfig(jwksConfig));
}

export async function verifyNeonFluxJwtWithJwkSet(
    config: NeonFluxJwtVerifierConfig,
    token: string,
    jwks: JWTVerifyGetKey
): Promise<NeonFluxJwtPayload> {
    const { payload } = await jwtVerify(token, jwks, {
        audience: config.audience,
        issuer: config.issuer,
    });

    return payload as NeonFluxJwtPayload;
}

export function normalizePrivateKeyPem(value: string): string {
    return value.trim().replaceAll('\\n', '\n');
}

function parseJwksConfigUrl(value: string, source: string): URL {
    const normalizedValue = value.trim();

    if (!normalizedValue) {
        throw new Error(`${source} is required`);
    }

    let url: URL;

    try {
        url = new URL(normalizedValue);
    } catch (error) {
        throw new Error(`${source} must be a valid HTTP(S) URL or JWKS data URI`, { cause: error });
    }

    if (url.protocol !== 'data:' && url.protocol !== 'http:' && url.protocol !== 'https:') {
        throw new Error(`${source} must be a valid HTTP(S) URL or JWKS data URI`);
    }

    return url;
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function assertPublicRsaSigningJwk(key: Record<string, unknown>, index: number, source: string): void {
    const keyIndex = String(index);

    if (key.kty !== 'RSA') {
        throw new Error(`${source} key at index ${keyIndex} must be an RSA public JWK`);
    }

    if (!isNonEmptyString(key.kid)) {
        throw new Error(`${source} key at index ${keyIndex} must include a non-empty "kid"`);
    }

    if (key.alg !== 'RS256') {
        throw new Error(`${source} key at index ${keyIndex} must use alg "RS256"`);
    }

    if (key.use !== 'sig') {
        throw new Error(`${source} key at index ${keyIndex} must use "sig"`);
    }

    for (const parameter of ['n', 'e'] as const) {
        if (!isBase64UrlString(key[parameter])) {
            throw new Error(`${source} key at index ${keyIndex} must include public RSA parameter "${parameter}"`);
        }
    }
}

function isNonEmptyString(value: unknown): value is string {
    return typeof value === 'string' && value.trim().length > 0;
}

function isBase64UrlString(value: unknown): value is string {
    return isNonEmptyString(value) && base64UrlPattern.test(value);
}

async function signNeonFluxJwt(
    config: NeonFluxJwtSignerConfig,
    input: {
        claims: NeonFluxJwtClaims;
        expiresInSeconds: number;
        now?: Date;
        subject: string;
    }
): Promise<string> {
    const privateKey = await importPKCS8(normalizePrivateKeyPem(config.privateKeyPem), 'RS256');
    const issuedAt = Math.floor((input.now?.getTime() ?? Date.now()) / 1000);

    return new SignJWT({ neonflux: input.claims })
        .setProtectedHeader({
            alg: 'RS256',
            kid: config.keyId ?? defaultKeyId,
            typ: 'JWT',
        })
        .setAudience(config.audience)
        .setExpirationTime(issuedAt + input.expiresInSeconds)
        .setIssuedAt(issuedAt)
        .setIssuer(config.issuer)
        .setSubject(input.subject)
        .sign(privateKey);
}

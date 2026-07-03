import { createPrivateKey, createPublicKey } from 'node:crypto';

import { createLocalJWKSet, importPKCS8, jwtVerify, SignJWT, type JWTPayload } from 'jose';

const defaultKeyId = 'neonflux-convex-auth';
const defaultUserTokenLifetimeSeconds = 5 * 60;
const defaultServiceTokenLifetimeSeconds = 10 * 60;

export type NeonFluxJwtSignerConfig = {
    audience: string;
    issuer: string;
    keyId?: string;
    privateKeyPem: string;
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
    serviceName: 'bot' | 'web' | 'migration';
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
          serviceName: 'bot' | 'web' | 'migration';
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

export async function verifyNeonFluxJwt(config: NeonFluxJwtSignerConfig, token: string): Promise<NeonFluxJwtPayload> {
    const jwks = createLocalJWKSet(createNeonFluxJwks(config));
    const { payload } = await jwtVerify(token, jwks, {
        audience: config.audience,
        issuer: config.issuer,
    });

    return payload as NeonFluxJwtPayload;
}

export function normalizePrivateKeyPem(value: string): string {
    return value.trim().replaceAll('\\n', '\n');
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

import { generateKeyPairSync } from 'node:crypto';

import { createLocalJWKSet, jwtVerify } from 'jose';
import { describe, expect, it } from 'vitest';

import {
    createNeonFluxJwks,
    createNeonFluxJwksDataUri,
    normalizePrivateKeyPem,
    parseNeonFluxJwksDataUri,
    signNeonFluxPostingDelegationJwt,
    signNeonFluxServiceJwt,
    signNeonFluxUserJwt,
    verifyNeonFluxJwt,
    verifyNeonFluxJwtWithConfiguredJwks,
    verifyNeonFluxJwtWithJwkSet,
    type NeonFluxJwtSignerConfig,
} from './jwt.js';

describe('NeonFlux Convex JWTs', () => {
    it('signs user JWTs with Fluxer session claims for Convex auth', async () => {
        const config = createJwtConfig();
        const now = new Date();
        const issuedAt = Math.floor(now.getTime() / 1000);
        const token = await signNeonFluxUserJwt(config, {
            expiresInSeconds: 120,
            fluxerUserId: 'user-1',
            manageableGuildIds: ['guild-1', 'guild-2'],
            now,
            sessionId: 'session-1',
        });

        const payload = await verifyNeonFluxJwt(config, token);

        expect(payload).toMatchObject({
            aud: 'neonflux-convex',
            exp: issuedAt + 120,
            iat: issuedAt,
            iss: 'https://neonflux.example/auth',
            neonflux: {
                fluxerUserId: 'user-1',
                kind: 'user',
                manageableGuildIds: ['guild-1', 'guild-2'],
                sessionId: 'session-1',
            },
            sub: 'fluxer-user:user-1',
        });
    });

    it('signs short-lived service JWTs for runtime workers', async () => {
        const config = createJwtConfig();
        const token = await signNeonFluxServiceJwt(config, {
            now: new Date(),
            serviceName: 'bot',
        });

        const payload = await verifyNeonFluxJwt(config, token);

        expect(payload).toMatchObject({
            neonflux: {
                kind: 'service',
                serviceName: 'bot',
            },
            sub: 'service:bot',
        });
    });

    it('signs short-lived, resource-bound posting delegations', async () => {
        const config = createJwtConfig();
        const now = new Date();
        const token = await signNeonFluxPostingDelegationJwt(config, {
            actorUserId: 'user-1',
            guildId: 'guild-1',
            now,
            payloadHash: 'payload-hash',
            requestKey: 'request-1',
            requestedChannelId: 'channel-1',
        });

        await expect(verifyNeonFluxJwt(config, token)).resolves.toMatchObject({
            exp: Math.floor(now.getTime() / 1000) + 45,
            neonflux: {
                actorUserId: 'user-1',
                guildId: 'guild-1',
                kind: 'posting-delegation',
                payloadHash: 'payload-hash',
                requestKey: 'request-1',
                requestedChannelId: 'channel-1',
            },
            sub: 'posting-delegation:user-1:request-1',
        });
    });

    it('exports a public JWKS without private key material', () => {
        const config = createJwtConfig();
        const jwks = createNeonFluxJwks(config);

        expect(jwks.keys).toHaveLength(1);
        expect(jwks.keys[0]).toMatchObject({
            alg: 'RS256',
            kid: 'test-key',
            kty: 'RSA',
            use: 'sig',
        });
        expect(jwks.keys[0]).not.toHaveProperty('d');
        expect(jwks.keys[0]).not.toHaveProperty('p');
        expect(jwks.keys[0]).not.toHaveProperty('q');
    });

    it('rejects tokens with the wrong audience or issuer', async () => {
        const config = createJwtConfig();
        const token = await signNeonFluxUserJwt(config, {
            fluxerUserId: 'user-1',
            sessionId: 'session-1',
        });

        await expect(verifyNeonFluxJwt({ ...config, audience: 'other-audience' }, token)).rejects.toThrow();
        await expect(verifyNeonFluxJwt({ ...config, issuer: 'https://other.example/auth' }, token)).rejects.toThrow();
    });

    it('normalizes escaped PEM newlines before signing', async () => {
        const config = createJwtConfig();
        const escapedPrivateKey = config.privateKeyPem.replaceAll('\n', '\\n');
        const token = await signNeonFluxServiceJwt(
            {
                ...config,
                privateKeyPem: escapedPrivateKey,
            },
            {
                serviceName: 'bot',
            }
        );

        await expect(verifyNeonFluxJwt(config, token)).resolves.toMatchObject({
            neonflux: {
                serviceName: 'bot',
            },
        });
        expect(normalizePrivateKeyPem(escapedPrivateKey)).toContain('\n');
    });

    it('creates JWTs that can be verified by jose with the exported JWKS', async () => {
        const config = createJwtConfig();
        const token = await signNeonFluxServiceJwt(config, {
            serviceName: 'web',
        });

        await expect(jwtVerify(token, createLocalJWKSet(createNeonFluxJwks(config)))).resolves.toBeDefined();
    });

    it('creates an inline public JWKS data URI for Convex custom JWT auth', async () => {
        const config = createJwtConfig();
        const jwksDataUri = createNeonFluxJwksDataUri(config);
        const token = await signNeonFluxServiceJwt(config, {
            serviceName: 'web',
        });

        expect(jwksDataUri).toMatch(/^data:application\/json,/);
        expect(parseNeonFluxJwksDataUri(jwksDataUri)).toEqual(createNeonFluxJwks(config));
        await expect(verifyNeonFluxJwtWithConfiguredJwks(config, token, jwksDataUri)).resolves.toMatchObject({
            neonflux: {
                serviceName: 'web',
            },
        });
    });

    it('rejects inline JWKS data URIs that expose private key parameters', () => {
        const jwksDataUri = `data:application/json,${encodeURIComponent(
            JSON.stringify({ keys: [{ d: 'private', kid: 'leaked', kty: 'RSA' }] })
        )}`;

        expect(() => parseNeonFluxJwksDataUri(jwksDataUri, 'NEONFLUX_AUTH_JWT_JWKS')).toThrow(
            'NEONFLUX_AUTH_JWT_JWKS exposes private JWK parameter "d"'
        );
    });

    it('rejects inline JWKS data URIs without usable RSA public key material', () => {
        const jwksDataUri = `data:application/json,${encodeURIComponent(
            JSON.stringify({ keys: [{ alg: 'RS256', e: 'AQAB', kid: 'test', kty: 'RSA', use: 'sig' }] })
        )}`;

        expect(() => parseNeonFluxJwksDataUri(jwksDataUri, 'NEONFLUX_AUTH_JWT_JWKS')).toThrow(
            'NEONFLUX_AUTH_JWT_JWKS key at index 0 must include public RSA parameter "n"'
        );
    });

    it('fails verification when the issuer JWKS does not match the signing key', async () => {
        const config = createJwtConfig();
        const mismatchedConfig = createJwtConfig();
        const token = await signNeonFluxServiceJwt(config, {
            serviceName: 'web',
        });

        await expect(
            verifyNeonFluxJwtWithJwkSet(config, token, createLocalJWKSet(createNeonFluxJwks(mismatchedConfig)))
        ).rejects.toThrow();
    });
});

function createJwtConfig(): NeonFluxJwtSignerConfig {
    const { privateKey } = generateKeyPairSync('rsa', {
        modulusLength: 2048,
    });

    return {
        audience: 'neonflux-convex',
        issuer: 'https://neonflux.example/auth',
        keyId: 'test-key',
        privateKeyPem: privateKey.export({ format: 'pem', type: 'pkcs8' }),
    };
}

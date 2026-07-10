import { createNeonFluxJwksDataUri, parseNeonFluxJwksDataUri } from '../packages/convex/src/jwt.js';

export type ConvexAuthProviderKind = 'bot' | 'user' | 'web';

export function createConvexAuthJwksDataUriFromEnv(env: NodeJS.ProcessEnv, provider: ConvexAuthProviderKind): string {
    const prefix = `NEONFLUX_${provider.toUpperCase()}_AUTH_JWT`;
    const privateKeyPem = requireValue(env[`${prefix}_PRIVATE_KEY`], `${prefix}_PRIVATE_KEY`);
    const audience = requireValue(env[`${prefix}_AUDIENCE`], `${prefix}_AUDIENCE`);
    const issuer = requireValue(env[`${prefix}_ISSUER`], `${prefix}_ISSUER`);
    const jwksDataUri = createNeonFluxJwksDataUri({ audience, issuer, privateKeyPem });
    parseNeonFluxJwksDataUri(jwksDataUri, `generated ${prefix}_JWKS`);
    return jwksDataUri;
}

function requireValue(value: string | undefined, name: string): string {
    const normalized = value?.trim();
    if (!normalized) throw new Error(`${name} is required`);
    return normalized;
}

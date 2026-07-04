import { createNeonFluxJwksDataUri, parseNeonFluxJwksDataUri } from '../packages/convex/src/jwt.js';

const defaultAudience = 'neonflux-convex';
const defaultIssuer = 'http://localhost:3000/auth';

type ConvexJwksEnvironment = Partial<
    Pick<NodeJS.ProcessEnv, 'NEONFLUX_AUTH_JWT_AUDIENCE' | 'NEONFLUX_AUTH_JWT_ISSUER' | 'NEONFLUX_AUTH_JWT_PRIVATE_KEY'>
>;

export function createConvexAuthJwksDataUriFromEnv(env: ConvexJwksEnvironment = process.env): string {
    const privateKeyPem = optionalValue(env.NEONFLUX_AUTH_JWT_PRIVATE_KEY);

    if (!privateKeyPem) {
        throw new Error('NEONFLUX_AUTH_JWT_PRIVATE_KEY is required to generate NEONFLUX_AUTH_JWT_JWKS');
    }

    const jwksDataUri = createNeonFluxJwksDataUri({
        audience: optionalValue(env.NEONFLUX_AUTH_JWT_AUDIENCE) ?? defaultAudience,
        issuer: optionalValue(env.NEONFLUX_AUTH_JWT_ISSUER) ?? defaultIssuer,
        privateKeyPem,
    });

    parseNeonFluxJwksDataUri(jwksDataUri, 'generated NEONFLUX_AUTH_JWT_JWKS');

    return jwksDataUri;
}

function optionalValue(value: string | undefined): string | undefined {
    const trimmed = value?.trim();
    return trimmed && trimmed.length > 0 ? trimmed : undefined;
}

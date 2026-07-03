import type { AuthConfig } from 'convex/server';

type ConvexAuthEnvironment = Partial<
    Pick<NodeJS.ProcessEnv, 'NEONFLUX_AUTH_JWT_AUDIENCE' | 'NEONFLUX_AUTH_JWT_ISSUER'>
>;

export function createAuthConfigForEnv(env: ConvexAuthEnvironment = process.env): AuthConfig {
    const issuer = optionalValue(env.NEONFLUX_AUTH_JWT_ISSUER);
    const applicationID = optionalValue(env.NEONFLUX_AUTH_JWT_AUDIENCE);
    const authIntent = Boolean(issuer ?? applicationID);

    if (!authIntent) {
        return { providers: [] };
    }

    if (!issuer) {
        throw new Error('NEONFLUX_AUTH_JWT_ISSUER is required for Convex auth config');
    }

    if (!applicationID) {
        throw new Error('NEONFLUX_AUTH_JWT_AUDIENCE is required for Convex auth config');
    }

    return {
        providers: [
            {
                algorithm: 'RS256',
                applicationID,
                issuer,
                jwks: new URL('/.well-known/jwks.json', issuer).toString(),
                type: 'customJwt',
            },
        ],
    };
}

function optionalValue(value: string | undefined): string | undefined {
    const trimmed = value?.trim();
    return trimmed && trimmed.length > 0 ? trimmed : undefined;
}

export default createAuthConfigForEnv();

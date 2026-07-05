import { pathToFileURL } from 'node:url';

import { loadConvexConfig } from '../packages/config/src/env.js';
import { parseNeonFluxJwksDataUri } from '../packages/convex/src/jwt.js';
import { assertNoArgs } from './script-args.js';

const requiredConvexAuthConfigEnvNames = [
    'NEONFLUX_AUTH_JWT_ISSUER',
    'NEONFLUX_AUTH_JWT_AUDIENCE',
    'NEONFLUX_AUTH_JWT_JWKS',
] as const;
const forbiddenConvexAuthConfigEnvNames = ['NEONFLUX_AUTH_JWT_PRIVATE_KEY'] as const;

type ConvexAuthConfigValidationEnvironment = Partial<
    Pick<
        NodeJS.ProcessEnv,
        | 'NEONFLUX_AUTH_JWT_AUDIENCE'
        | 'NEONFLUX_AUTH_JWT_ISSUER'
        | 'NEONFLUX_AUTH_JWT_JWKS'
        | 'NEONFLUX_AUTH_JWT_PRIVATE_KEY'
    >
>;

export type ConvexAuthConfigValidation = {
    audience: string;
    issuer: string;
    jwksDescription: string;
};

export function validateConvexAuthConfigEnv(env: ConvexAuthConfigValidationEnvironment): ConvexAuthConfigValidation {
    const missing = requiredConvexAuthConfigEnvNames.filter((name) => !optionalValue(env[name]));
    const forbiddenPresent = forbiddenConvexAuthConfigEnvNames.filter((name) => optionalValue(env[name]));

    if (missing.length > 0 || forbiddenPresent.length > 0) {
        throw new Error(
            [
                'Convex auth config is not ready.',
                missing.length > 0 ? `Missing: ${missing.join(', ')}` : undefined,
                forbiddenPresent.length > 0 ? `Forbidden: ${forbiddenPresent.join(', ')}` : undefined,
            ]
                .filter((line): line is string => Boolean(line))
                .join('\n')
        );
    }

    const config = loadConvexConfig(env);

    return {
        audience: requireConfigValue(config.authJwtAudience, 'NEONFLUX_AUTH_JWT_AUDIENCE'),
        issuer: requireConfigValue(config.authJwtIssuer, 'NEONFLUX_AUTH_JWT_ISSUER'),
        jwksDescription: describeJwksConfig(requireConfigValue(config.authJwtJwks, 'NEONFLUX_AUTH_JWT_JWKS')),
    };
}

export function formatConvexAuthConfigValidation(validation: ConvexAuthConfigValidation): string {
    return [
        'Convex auth config is ready.',
        `Issuer: ${validation.issuer}`,
        `Audience: ${validation.audience}`,
        `JWKS: ${validation.jwksDescription}`,
        'NEONFLUX_AUTH_JWT_PRIVATE_KEY is not present.',
    ].join('\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    try {
        main();
    } catch (error: unknown) {
        process.stderr.write(`${formatErrorMessage(error)}\n`);
        process.exitCode = 1;
    }
}

function main(): void {
    assertNoArgs();

    const validation = validateConvexAuthConfigEnv(process.env);
    process.stdout.write(`${formatConvexAuthConfigValidation(validation)}\n`);
}

function describeJwksConfig(value: string): string {
    const url = new URL(value);

    if (url.protocol !== 'data:') {
        return url.toString();
    }

    const jwks = parseNeonFluxJwksDataUri(value, 'NEONFLUX_AUTH_JWT_JWKS');
    return `inline data URI (${String(jwks.keys.length)} key${jwks.keys.length === 1 ? '' : 's'})`;
}

function optionalValue(value: string | undefined): string | undefined {
    const trimmed = value?.trim();
    return trimmed && trimmed.length > 0 ? trimmed : undefined;
}

function requireConfigValue(value: string | undefined, name: string): string {
    const normalized = optionalValue(value);
    if (!normalized) throw new Error(`${name} is required`);
    return normalized;
}

function formatErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

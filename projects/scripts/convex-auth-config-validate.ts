import { pathToFileURL } from 'node:url';

import { loadConvexConfig, loadLocalEnv } from '../packages/config/src/env.js';
import { parseNeonFluxJwksDataUri } from '../packages/convex/src/jwt.js';
import { assertNoArgs } from './script-args.js';

const providerKinds = ['bot', 'web', 'user'] as const;
const requiredNames = providerKinds.flatMap((kind) => [
    `NEONFLUX_${kind.toUpperCase()}_AUTH_JWT_ISSUER`,
    `NEONFLUX_${kind.toUpperCase()}_AUTH_JWT_AUDIENCE`,
    `NEONFLUX_${kind.toUpperCase()}_AUTH_JWT_JWKS`,
]);
const forbiddenNames = providerKinds.map((kind) => `NEONFLUX_${kind.toUpperCase()}_AUTH_JWT_PRIVATE_KEY`);

export type ConvexAuthConfigValidation = {
    providers: Array<{
        audience: string;
        issuer: string;
        jwksDescription: string;
        kind: (typeof providerKinds)[number];
    }>;
};

export function validateConvexAuthConfigEnv(env: NodeJS.ProcessEnv): ConvexAuthConfigValidation {
    const missing = requiredNames.filter((name) => !optionalValue(env[name]));
    const forbiddenPresent = forbiddenNames.filter((name) => optionalValue(env[name]));

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
    const providers = providerKinds.map((kind) => {
        const prefix = `${kind}AuthJwt` as const;
        const environmentPrefix = `NEONFLUX_${kind.toUpperCase()}_AUTH_JWT`;
        const audience = requireConfigValue(config[`${prefix}Audience`], `${environmentPrefix}_AUDIENCE`);
        const issuer = requireConfigValue(config[`${prefix}Issuer`], `${environmentPrefix}_ISSUER`);
        const jwks = requireConfigValue(config[`${prefix}Jwks`], `${environmentPrefix}_JWKS`);

        return { audience, issuer, jwksDescription: describeJwksConfig(jwks, `${environmentPrefix}_JWKS`), kind };
    });

    if (new Set(providers.map(({ issuer }) => issuer)).size !== providers.length) {
        throw new Error('Bot, web, and user Convex JWT issuers must be distinct');
    }

    return { providers };
}

export function formatConvexAuthConfigValidation(validation: ConvexAuthConfigValidation): string {
    return [
        'Convex auth config is ready.',
        ...validation.providers.flatMap(({ audience, issuer, jwksDescription, kind }) => [
            `${kind}: issuer=${issuer}`,
            `${kind}: audience=${audience}`,
            `${kind}: JWKS=${jwksDescription}`,
        ]),
        'No Convex JWT private key is present.',
    ].join('\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    try {
        assertNoArgs();
        loadLocalEnv();
        process.stdout.write(`${formatConvexAuthConfigValidation(validateConvexAuthConfigEnv(process.env))}\n`);
    } catch (error: unknown) {
        process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
        process.exitCode = 1;
    }
}

function describeJwksConfig(value: string, name: string): string {
    const url = new URL(value);
    if (url.protocol !== 'data:') return url.toString();
    const jwks = parseNeonFluxJwksDataUri(value, name);
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

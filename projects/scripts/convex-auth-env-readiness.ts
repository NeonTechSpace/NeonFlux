import { execFile } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

import { loadConvexConfig, loadLocalEnv } from '../packages/config/src/env.js';
import { parseNeonFluxJwksDataUri } from '../packages/convex/src/jwt.js';

const execFileAsync = promisify(execFile);
const requiredConvexAuthEnvNames = [
    'NEONFLUX_AUTH_JWT_ISSUER',
    'NEONFLUX_AUTH_JWT_AUDIENCE',
    'NEONFLUX_AUTH_JWT_JWKS',
] as const;
const forbiddenConvexAuthEnvNames = ['NEONFLUX_AUTH_JWT_PRIVATE_KEY'] as const;

export type ConvexAuthEnvReadiness = {
    audience?: string;
    forbiddenPresent: string[];
    issuer?: string;
    jwksDescription?: string;
    missing: string[];
    names: string[];
    ok: boolean;
    valueErrors: string[];
};

export type ConvexAuthEnvValues = Partial<Record<(typeof requiredConvexAuthEnvNames)[number], string>>;

export function compareConvexAuthEnvValues(target: ConvexAuthEnvValues, deploy: ConvexAuthEnvValues): string[] {
    const errors: string[] = [];

    for (const name of requiredConvexAuthEnvNames) {
        const targetValue = optionalValue(target[name]);
        const deployValue = optionalValue(deploy[name]);

        if (targetValue && deployValue && targetValue !== deployValue) {
            errors.push(`Deploy env mismatch: ${name}`);
        }
    }

    return errors;
}

export function evaluateDeployConvexAuthEnvValues(deploy: ConvexAuthEnvValues): string[] {
    const readiness = evaluateConvexAuthEnvValues(deploy);

    return [
        ...readiness.missing.map((name) => `Deploy env missing: ${name}`),
        ...readiness.valueErrors.map((error) => `Deploy env invalid: ${error}`),
    ];
}

export function evaluateConvexAuthEnvNames(names: Iterable<string>): ConvexAuthEnvReadiness {
    const nameSet = new Set(Array.from(names, (name) => name.trim()).filter((name) => name.length > 0));
    const missing = requiredConvexAuthEnvNames.filter((name) => !nameSet.has(name));
    const forbiddenPresent = forbiddenConvexAuthEnvNames.filter((name) => nameSet.has(name));

    return {
        forbiddenPresent,
        missing,
        names: Array.from(nameSet).sort(),
        ok: missing.length === 0 && forbiddenPresent.length === 0,
        valueErrors: [],
    };
}

export function evaluateConvexAuthEnvValues(values: ConvexAuthEnvValues): ConvexAuthEnvReadiness {
    const missing = requiredConvexAuthEnvNames.filter((name) => !optionalValue(values[name]));
    const valueErrors: string[] = [];
    let audience: string | undefined;
    let issuer: string | undefined;
    let jwksDescription: string | undefined;

    try {
        const config = loadConvexConfig(values);

        audience = config.authJwtAudience;
        issuer = config.authJwtIssuer;
        jwksDescription = config.authJwtJwks ? describeJwksConfig(config.authJwtJwks) : undefined;
    } catch (error) {
        valueErrors.push(formatErrorMessage(error));
    }

    return {
        ...(audience ? { audience } : {}),
        forbiddenPresent: [],
        ...(issuer ? { issuer } : {}),
        ...(jwksDescription ? { jwksDescription } : {}),
        missing,
        names: Object.keys(values).sort(),
        ok: missing.length === 0 && valueErrors.length === 0,
        valueErrors,
    };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    await main().catch((error: unknown) => {
        process.stderr.write(`${formatErrorMessage(error)}\n`);
        process.exitCode = 1;
    });
}

async function main(): Promise<void> {
    loadLocalEnv();

    const args = parseConvexAuthEnvReadinessArgs(process.argv.slice(2));
    const deployment = optionalValue(args.deployment ?? process.env.CONVEX_DEPLOYMENT);
    const names = await listConvexEnvNames(deployment);
    const readiness = evaluateConvexAuthEnvNames(names);
    const deploymentLabel = deployment ?? 'default dev deployment';
    const targetValues = await getAvailableConvexAuthEnvValues(deployment, readiness.names);
    const valueReadiness = evaluateConvexAuthEnvValues(targetValues);
    const valueErrors = valueReadiness.valueErrors;
    const valueMissing = valueReadiness.missing.filter((name) => !readiness.missing.includes(name));
    const deployEnvValues = args.compareDeployEnv ? readPublicConvexAuthEnvValues(process.env) : undefined;
    const deployEnvErrors = deployEnvValues
        ? [
              ...evaluateDeployConvexAuthEnvValues(deployEnvValues),
              ...compareConvexAuthEnvValues(targetValues, deployEnvValues),
          ]
        : [];

    if (!readiness.ok || valueErrors.length > 0 || valueMissing.length > 0 || deployEnvErrors.length > 0) {
        const remediation = createRemediationLines(deployment);

        process.stderr.write(
            `${[
                `Convex auth env is not ready for ${deploymentLabel}.`,
                readiness.missing.length > 0 ? `Missing: ${readiness.missing.join(', ')}` : undefined,
                readiness.forbiddenPresent.length > 0
                    ? `Forbidden in Convex env: ${readiness.forbiddenPresent.join(', ')}`
                    : undefined,
                valueMissing.length > 0 ? `Missing values: ${valueMissing.join(', ')}` : undefined,
                ...valueErrors,
                ...deployEnvErrors,
                ...remediation,
            ]
                .filter((line): line is string => Boolean(line))
                .join('\n')}\n`
        );
        process.exitCode = 1;
        return;
    }

    const issuer = requireReadinessValue(valueReadiness.issuer, 'issuer');
    const audience = requireReadinessValue(valueReadiness.audience, 'audience');
    const jwksDescription = requireReadinessValue(valueReadiness.jwksDescription, 'jwksDescription');

    process.stdout.write(
        `${[
            `Convex auth env is ready for ${deploymentLabel}: ${requiredConvexAuthEnvNames.join(', ')}.`,
            `Issuer: ${issuer}`,
            `Audience: ${audience}`,
            `JWKS: ${jwksDescription}`,
            args.compareDeployEnv ? 'Deploy env public auth values match target.' : undefined,
        ]
            .filter((line): line is string => Boolean(line))
            .join('\n')}\n`
    );
}

async function listConvexEnvNames(deployment: string | undefined): Promise<string[]> {
    const require = createRequire(import.meta.url);
    const convexBin = join(dirname(require.resolve('convex/package.json')), 'bin', 'main.js');
    const childEnv = { ...process.env };

    delete childEnv.NEONFLUX_AUTH_JWT_PRIVATE_KEY;

    const result = await execFileAsync(
        process.execPath,
        [convexBin, 'env', 'list', ...createDeploymentArgs(deployment), '--names-only'],
        {
            env: childEnv,
            maxBuffer: 1024 * 1024,
            shell: false,
        }
    );

    return result.stdout
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.length > 0 && !line.startsWith('◇'));
}

async function getAvailableConvexAuthEnvValues(
    deployment: string | undefined,
    names: readonly string[]
): Promise<ConvexAuthEnvValues> {
    const availableRequiredNames = requiredConvexAuthEnvNames.filter((name) => names.includes(name));
    const entries = await Promise.all(
        availableRequiredNames.map(async (name) => [name, await getConvexEnvValue(name, deployment)] as const)
    );

    return Object.fromEntries(entries);
}

async function getConvexEnvValue(name: string, deployment: string | undefined): Promise<string> {
    const require = createRequire(import.meta.url);
    const convexBin = join(dirname(require.resolve('convex/package.json')), 'bin', 'main.js');
    const childEnv = { ...process.env };

    delete childEnv.NEONFLUX_AUTH_JWT_PRIVATE_KEY;

    const result = await execFileAsync(
        process.execPath,
        [convexBin, 'env', 'get', ...createDeploymentArgs(deployment), name],
        {
            env: childEnv,
            maxBuffer: 1024 * 1024,
            shell: false,
        }
    );

    return result.stdout.trim();
}

export function createDeploymentArgs(deployment: string | undefined): string[] {
    const normalizedDeployment = optionalValue(deployment);
    return normalizedDeployment ? ['--deployment', normalizeConvexCliDeploymentSelector(normalizedDeployment)] : [];
}

function normalizeConvexCliDeploymentSelector(deployment: string): string {
    const prefixedMatch = /^(?:dev|prod):(.+)$/.exec(deployment);
    return prefixedMatch?.[1] ?? deployment;
}

export function parseConvexAuthEnvReadinessArgs(args: string[]): { compareDeployEnv: boolean; deployment?: string } {
    const parsed: { compareDeployEnv: boolean; deployment?: string } = {
        compareDeployEnv: false,
    };

    for (let index = 0; index < args.length; index += 1) {
        const arg = args[index];

        switch (arg) {
            case undefined:
                throw new Error('Missing option');

            case '--':
                break;

            case '--deployment':
                if (parsed.deployment !== undefined) {
                    throw new Error('--deployment was provided multiple times');
                }

                parsed.deployment = readOptionValue(args, index, arg);
                index += 1;
                break;

            case '--compare-deploy-env':
                if (parsed.compareDeployEnv) {
                    throw new Error('--compare-deploy-env was provided multiple times');
                }

                parsed.compareDeployEnv = true;
                break;

            default:
                throw new Error(`Unknown option: ${arg}`);
        }
    }

    return parsed;
}

function readOptionValue(args: string[], index: number, name: string): string {
    const value = args[index + 1];

    if (!value || value.startsWith('--')) {
        throw new Error(`${name} requires a value`);
    }

    return value;
}

function optionalValue(value: string | undefined): string | undefined {
    const trimmed = value?.trim();
    return trimmed && trimmed.length > 0 ? trimmed : undefined;
}

function requireReadinessValue(value: string | undefined, field: string): string {
    if (value === undefined) throw new Error(`Missing ready ${field}`);
    return value;
}

function describeJwksConfig(value: string): string {
    const url = new URL(value);

    if (url.protocol !== 'data:') {
        return url.toString();
    }

    const jwks = parseNeonFluxJwksDataUri(value, 'NEONFLUX_AUTH_JWT_JWKS');
    return `inline data URI (${String(jwks.keys.length)} key${jwks.keys.length === 1 ? '' : 's'})`;
}

function readPublicConvexAuthEnvValues(env: NodeJS.ProcessEnv): ConvexAuthEnvValues {
    return {
        ...(env.NEONFLUX_AUTH_JWT_AUDIENCE ? { NEONFLUX_AUTH_JWT_AUDIENCE: env.NEONFLUX_AUTH_JWT_AUDIENCE } : {}),
        ...(env.NEONFLUX_AUTH_JWT_ISSUER ? { NEONFLUX_AUTH_JWT_ISSUER: env.NEONFLUX_AUTH_JWT_ISSUER } : {}),
        ...(env.NEONFLUX_AUTH_JWT_JWKS ? { NEONFLUX_AUTH_JWT_JWKS: env.NEONFLUX_AUTH_JWT_JWKS } : {}),
    };
}

export function createRemediationLines(deployment: string | undefined): string[] {
    const deploymentArgs = deployment ? ` --deployment ${deployment}` : '';

    return [
        `Next: pnpm convex:configure-auth-env -- --issuer <stable-NeonFlux-issuer>${deploymentArgs}`,
        deployment
            ? `After approval, apply with --apply --confirm-apply-target ${deployment}, then make the local or protected deploy environment match the same public auth values.`
            : 'After approval, rerun with --deployment <target> plus --apply --confirm-apply-target <target>, then make the local or protected deploy environment match the same public auth values.',
        'Then run pnpm convex:validate-auth-config and pnpm convex:check-auth-env -- --compare-deploy-env.',
        'Deploy Convex functions/auth config, then rerun pnpm convex:check-auth-env and pnpm convex:dev:once for local/dev rehearsal.',
    ];
}

function formatErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

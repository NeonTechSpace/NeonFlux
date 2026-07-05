import { execFile } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

import { loadLocalEnv } from '../packages/config/src/env.js';
import { createNeonFluxJwksDataUri, parseNeonFluxJwksDataUri } from '../packages/convex/src/jwt.js';

const execFileAsync = promisify(execFile);
const defaultAudience = 'neonflux-convex';
const publicConvexAuthEnvNames = [
    'NEONFLUX_AUTH_JWT_ISSUER',
    'NEONFLUX_AUTH_JWT_AUDIENCE',
    'NEONFLUX_AUTH_JWT_JWKS',
] as const;
const publicConvexAuthEnvApplyOrder = [
    'NEONFLUX_AUTH_JWT_JWKS',
    'NEONFLUX_AUTH_JWT_AUDIENCE',
    'NEONFLUX_AUTH_JWT_ISSUER',
] as const;

type ConvexAuthEnvConfigureEnvironment = Partial<
    Pick<
        NodeJS.ProcessEnv,
        | 'CONVEX_DEPLOYMENT'
        | 'NEONFLUX_AUTH_JWT_AUDIENCE'
        | 'NEONFLUX_AUTH_JWT_ISSUER'
        | 'NEONFLUX_AUTH_JWT_PRIVATE_KEY'
    >
>;

export type ConvexAuthEnvConfigureOptions = {
    audience?: string;
    deployment?: string;
    issuer?: string;
};

export type ConvexAuthEnvPlan = {
    audience: string;
    deployment?: string;
    deploymentLabel: string;
    issuer: string;
    jwksDataUri: string;
    keyIds: string[];
    names: ReadonlyArray<(typeof publicConvexAuthEnvNames)[number]>;
};
export type ConvexAuthEnvSetOperation = {
    name: (typeof publicConvexAuthEnvApplyOrder)[number];
    value: string;
};

export function createConvexAuthEnvPlan(
    env: ConvexAuthEnvConfigureEnvironment,
    options: ConvexAuthEnvConfigureOptions = {}
): ConvexAuthEnvPlan {
    const issuer = normalizeIssuer(options.issuer ?? env.NEONFLUX_AUTH_JWT_ISSUER);
    const audience = optionalValue(options.audience ?? env.NEONFLUX_AUTH_JWT_AUDIENCE) ?? defaultAudience;
    const deployment = optionalValue(options.deployment ?? env.CONVEX_DEPLOYMENT);
    const privateKeyPem = optionalValue(env.NEONFLUX_AUTH_JWT_PRIVATE_KEY);

    if (!privateKeyPem) {
        throw new Error('NEONFLUX_AUTH_JWT_PRIVATE_KEY is required to configure public Convex auth env');
    }

    const jwksDataUri = createNeonFluxJwksDataUri({
        audience,
        issuer,
        privateKeyPem,
    });
    const jwks = parseNeonFluxJwksDataUri(jwksDataUri, 'generated NEONFLUX_AUTH_JWT_JWKS');

    return {
        audience,
        ...(deployment ? { deployment } : {}),
        deploymentLabel: deployment ?? 'default dev deployment',
        issuer,
        jwksDataUri,
        keyIds: jwks.keys.map((key) => key.kid),
        names: publicConvexAuthEnvNames,
    };
}

export function formatConvexAuthEnvPlan(plan: ConvexAuthEnvPlan, mode: 'apply' | 'dry-run'): string {
    const action = mode === 'apply' ? 'Configured' : 'Would configure';
    const checkAuthCommand = plan.deployment
        ? `pnpm convex:check-auth-env -- --deployment ${plan.deployment}`
        : 'pnpm convex:check-auth-env';
    const compareDeployEnvCommand = `${checkAuthCommand} --compare-deploy-env`;
    const nextSteps =
        mode === 'apply'
            ? [
                  'Next: ensure the local or protected deploy environment has the same public auth values.',
                  'Then run: pnpm convex:validate-auth-config',
                  `Then run: ${compareDeployEnvCommand}`,
                  'Then deploy Convex functions/auth config for this environment.',
                  `Then run: ${checkAuthCommand}`,
                  'For local/dev rehearsal, run: pnpm convex:dev:once',
              ]
            : [
                  plan.deployment
                      ? `Next: review the deployment and issuer, then rerun with --apply --confirm-apply-target ${plan.deployment} only after approval.`
                      : 'Next: rerun with --deployment <target>; --apply requires an explicit deployment and matching confirmation.',
                  'After apply, make the local or protected deploy environment match these public auth values before deploying.',
              ];

    return [
        `${action} public Convex auth env for ${plan.deploymentLabel}: ${plan.names.join(', ')}.`,
        `Issuer: ${plan.issuer}`,
        `Audience: ${plan.audience}`,
        `JWKS key ids: ${plan.keyIds.join(', ')}`,
        'NEONFLUX_AUTH_JWT_PRIVATE_KEY is not sent to Convex.',
        `Apply order: ${publicConvexAuthEnvApplyOrder.join(', ')}.`,
        ...nextSteps,
    ]
        .filter((line): line is string => Boolean(line))
        .join('\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    await main().catch((error: unknown) => {
        process.stderr.write(`${formatErrorMessage(error)}\n`);
        process.exitCode = 1;
    });
}

async function main(): Promise<void> {
    loadLocalEnv();

    const args = parseConvexAuthEnvConfigureArgs(process.argv.slice(2));
    assertConvexAuthEnvConfigureMode(args);
    const audience = optionalValue(args.audience ?? process.env.NEONFLUX_AUTH_JWT_AUDIENCE);
    const deployment = optionalValue(args.deployment ?? process.env.CONVEX_DEPLOYMENT);
    const issuer = optionalValue(args.issuer ?? process.env.NEONFLUX_AUTH_JWT_ISSUER);
    const plan = createConvexAuthEnvPlan(process.env, {
        ...(audience ? { audience } : {}),
        ...(deployment ? { deployment } : {}),
        ...(issuer ? { issuer } : {}),
    });

    if (!args.apply) {
        process.stdout.write(`${formatConvexAuthEnvPlan(plan, 'dry-run')}\n`);
        return;
    }

    requireConvexAuthEnvApplyConfirmation(plan, args.confirmApplyTarget);
    await applyConvexAuthEnvPlan(plan);
    process.stdout.write(`${formatConvexAuthEnvPlan(plan, 'apply')}\n`);
}

export function requireConvexAuthEnvApplyConfirmation(
    plan: Pick<ConvexAuthEnvPlan, 'deployment' | 'deploymentLabel'>,
    confirmation: string | undefined
): void {
    if (!plan.deployment) {
        throw new Error('--apply requires explicit --deployment <target>');
    }

    const normalizedConfirmation = optionalValue(confirmation);

    if (!normalizedConfirmation) {
        throw new Error('--apply requires --confirm-apply-target <target>');
    }

    if (normalizedConfirmation !== plan.deployment) {
        throw new Error(
            `Apply confirmation target ${normalizedConfirmation} does not match deployment ${plan.deployment}`
        );
    }
}

export function assertConvexAuthEnvConfigureMode(args: {
    apply: boolean;
    confirmApplyTarget?: string;
    deployment?: string;
}): void {
    if (!args.apply && optionalValue(args.confirmApplyTarget)) {
        throw new Error('--confirm-apply-target requires --apply');
    }

    if (args.apply && !optionalValue(args.deployment)) {
        throw new Error('--apply requires explicit --deployment <target>');
    }
}

async function applyConvexAuthEnvPlan(plan: ConvexAuthEnvPlan): Promise<void> {
    for (const operation of createConvexAuthEnvSetOperations(plan)) {
        await setConvexEnv(operation.name, operation.value, plan.deployment);
    }
}

export function createConvexAuthEnvSetOperations(plan: ConvexAuthEnvPlan): ConvexAuthEnvSetOperation[] {
    const values = {
        NEONFLUX_AUTH_JWT_AUDIENCE: plan.audience,
        NEONFLUX_AUTH_JWT_ISSUER: plan.issuer,
        NEONFLUX_AUTH_JWT_JWKS: plan.jwksDataUri,
    } satisfies Record<(typeof publicConvexAuthEnvApplyOrder)[number], string>;

    return publicConvexAuthEnvApplyOrder.map((name) => ({
        name,
        value: values[name],
    }));
}

async function setConvexEnv(name: string, value: string, deployment: string | undefined): Promise<void> {
    const require = createRequire(import.meta.url);
    const convexBin = join(dirname(require.resolve('convex/package.json')), 'bin', 'main.js');
    const childEnv = { ...process.env };
    const args = ['env', 'set', ...createDeploymentArgs(deployment), name, value];

    delete childEnv.NEONFLUX_AUTH_JWT_PRIVATE_KEY;

    await execFileAsync(process.execPath, [convexBin, ...args], {
        env: childEnv,
        maxBuffer: 1024 * 1024,
        shell: false,
    });
}

export function createDeploymentArgs(deployment: string | undefined): string[] {
    const normalizedDeployment = optionalValue(deployment);
    return normalizedDeployment ? ['--deployment', normalizeConvexCliDeploymentSelector(normalizedDeployment)] : [];
}

function normalizeConvexCliDeploymentSelector(deployment: string): string {
    const prefixedMatch = /^(?:dev|prod):(.+)$/.exec(deployment);
    return prefixedMatch?.[1] ?? deployment;
}

export function parseConvexAuthEnvConfigureArgs(args: string[]): {
    apply: boolean;
    audience?: string;
    confirmApplyTarget?: string;
    deployment?: string;
    issuer?: string;
} {
    const parsed: {
        apply: boolean;
        audience?: string;
        confirmApplyTarget?: string;
        deployment?: string;
        issuer?: string;
    } = {
        apply: false,
    };

    for (let index = 0; index < args.length; index += 1) {
        const arg = args[index];

        switch (arg) {
            case undefined:
                throw new Error('Missing option');

            case '--':
                break;

            case '--apply':
                if (parsed.apply) {
                    throw new Error('--apply was provided multiple times');
                }

                parsed.apply = true;
                break;

            case '--audience':
                if (parsed.audience !== undefined) {
                    throw new Error('--audience was provided multiple times');
                }

                parsed.audience = readOptionValue(args, index, arg);
                index += 1;
                break;

            case '--confirm-apply-target':
                if (parsed.confirmApplyTarget !== undefined) {
                    throw new Error('--confirm-apply-target was provided multiple times');
                }

                parsed.confirmApplyTarget = readOptionValue(args, index, arg);
                index += 1;
                break;

            case '--deployment':
                if (parsed.deployment !== undefined) {
                    throw new Error('--deployment was provided multiple times');
                }

                parsed.deployment = readOptionValue(args, index, arg);
                index += 1;
                break;

            case '--issuer':
                if (parsed.issuer !== undefined) {
                    throw new Error('--issuer was provided multiple times');
                }

                parsed.issuer = readOptionValue(args, index, arg);
                index += 1;
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

function normalizeIssuer(value: string | undefined): string {
    const normalizedValue = optionalValue(value);

    if (!normalizedValue) {
        throw new Error('NEONFLUX_AUTH_JWT_ISSUER is required to configure public Convex auth env');
    }

    let url: URL;

    try {
        url = new URL(normalizedValue);
    } catch {
        throw new Error('NEONFLUX_AUTH_JWT_ISSUER must be a valid HTTP or HTTPS URL');
    }

    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        throw new Error('NEONFLUX_AUTH_JWT_ISSUER must be a valid HTTP or HTTPS URL');
    }

    if (url.hostname.toLowerCase().endsWith('fluxer.app')) {
        throw new Error('NEONFLUX_AUTH_JWT_ISSUER must be a NeonFlux issuer, not a Fluxer OAuth host');
    }

    return url.toString();
}

function optionalValue(value: string | undefined): string | undefined {
    const trimmed = value?.trim();
    return trimmed && trimmed.length > 0 ? trimmed : undefined;
}

function formatErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

import { execFile } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

import { loadLocalEnv } from '../packages/config/src/env.js';
import { createNeonFluxJwksDataUri, parseNeonFluxJwksDataUri } from '../packages/convex/src/jwt.js';

const execFileAsync = promisify(execFile);
const providerKinds = ['bot', 'web', 'user'] as const;
const privateKeyNames = providerKinds.map((kind) => `NEONFLUX_${kind.toUpperCase()}_AUTH_JWT_PRIVATE_KEY`);

export type ConvexAuthEnvSetOperation = { name: string; value: string };
export type ConvexAuthEnvPlan = {
    deployment?: string;
    deploymentLabel: string;
    operations: ConvexAuthEnvSetOperation[];
    providers: Array<{ audience: string; issuer: string; keyIds: string[]; kind: (typeof providerKinds)[number] }>;
};

export function createConvexAuthEnvPlan(
    env: NodeJS.ProcessEnv,
    options: { deployment?: string } = {}
): ConvexAuthEnvPlan {
    const deployment = optionalValue(options.deployment ?? env.CONVEX_DEPLOYMENT);
    const providers = providerKinds.map((kind) => {
        const environmentPrefix = `NEONFLUX_${kind.toUpperCase()}_AUTH_JWT`;
        const audience = requireValue(env[`${environmentPrefix}_AUDIENCE`], `${environmentPrefix}_AUDIENCE`);
        const issuer = normalizeIssuer(env[`${environmentPrefix}_ISSUER`], `${environmentPrefix}_ISSUER`);
        const privateKeyPem = requireValue(env[`${environmentPrefix}_PRIVATE_KEY`], `${environmentPrefix}_PRIVATE_KEY`);
        const jwksDataUri = createNeonFluxJwksDataUri({ audience, issuer, privateKeyPem });
        const jwks = parseNeonFluxJwksDataUri(jwksDataUri, `generated ${environmentPrefix}_JWKS`);

        return { audience, issuer, jwksDataUri, keyIds: jwks.keys.map((key) => key.kid), kind };
    });

    if (new Set(providers.map(({ issuer }) => issuer)).size !== providers.length) {
        throw new Error('Bot, web, and user Convex JWT issuers must be distinct');
    }

    return {
        ...(deployment ? { deployment } : {}),
        deploymentLabel: deployment ?? 'default dev deployment',
        operations: providers.flatMap(({ audience, issuer, jwksDataUri, kind }) => {
            const prefix = `NEONFLUX_${kind.toUpperCase()}_AUTH_JWT`;
            return [
                { name: `${prefix}_JWKS`, value: jwksDataUri },
                { name: `${prefix}_AUDIENCE`, value: audience },
                { name: `${prefix}_ISSUER`, value: issuer },
            ];
        }),
        providers: providers.map(({ audience, issuer, keyIds, kind }) => ({ audience, issuer, keyIds, kind })),
    };
}

export function createConvexAuthEnvSetOperations(plan: ConvexAuthEnvPlan): ConvexAuthEnvSetOperation[] {
    return plan.operations;
}

export function formatConvexAuthEnvPlan(plan: ConvexAuthEnvPlan, mode: 'apply' | 'dry-run'): string {
    return [
        `${mode === 'apply' ? 'Configured' : 'Would configure'} isolated Convex auth providers for ${plan.deploymentLabel}.`,
        ...plan.providers.map(
            ({ audience, issuer, keyIds, kind }) =>
                `${kind}: issuer=${issuer}, audience=${audience}, JWKS key ids=${keyIds.join(', ')}`
        ),
        'No private JWT key is sent to Convex.',
    ].join('\n');
}

export function requireConvexAuthEnvApplyConfirmation(
    plan: Pick<ConvexAuthEnvPlan, 'deployment' | 'deploymentLabel'>,
    confirmation: string | undefined
): void {
    if (!plan.deployment) throw new Error('--apply requires explicit --deployment <target>');
    if (optionalValue(confirmation) !== plan.deployment) {
        throw new Error(
            `Apply confirmation target ${confirmation ?? '(missing)'} does not match deployment ${plan.deployment}`
        );
    }
}

export function assertConvexAuthEnvConfigureMode(args: {
    apply: boolean;
    confirmApplyTarget?: string;
    deployment?: string;
}): void {
    if (!args.apply && optionalValue(args.confirmApplyTarget))
        throw new Error('--confirm-apply-target requires --apply');
    if (args.apply && !optionalValue(args.deployment))
        throw new Error('--apply requires explicit --deployment <target>');
}

export function createDeploymentArgs(deployment: string | undefined): string[] {
    const normalized = optionalValue(deployment);
    return normalized ? ['--deployment', /^(?:dev|prod):(.+)$/.exec(normalized)?.[1] ?? normalized] : [];
}

export function parseConvexAuthEnvConfigureArgs(args: string[]): {
    apply: boolean;
    confirmApplyTarget?: string;
    deployment?: string;
} {
    const parsed: { apply: boolean; confirmApplyTarget?: string; deployment?: string } = { apply: false };

    for (let index = 0; index < args.length; index += 1) {
        const arg = args[index];
        if (arg === '--apply') parsed.apply = true;
        else if (arg === '--deployment' || arg === '--confirm-apply-target') {
            const value = args[index + 1];
            if (!value) throw new Error(`${arg} requires a value`);
            if (arg === '--deployment') parsed.deployment = value;
            else parsed.confirmApplyTarget = value;
            index += 1;
        } else throw new Error(`Unknown argument: ${arg ?? ''}`);
    }

    return parsed;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    await main().catch((error: unknown) => {
        process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
        process.exitCode = 1;
    });
}

async function main(): Promise<void> {
    loadLocalEnv();
    const args = parseConvexAuthEnvConfigureArgs(process.argv.slice(2));
    assertConvexAuthEnvConfigureMode(args);
    const plan = createConvexAuthEnvPlan(process.env, { ...(args.deployment ? { deployment: args.deployment } : {}) });

    if (args.apply) {
        requireConvexAuthEnvApplyConfirmation(plan, args.confirmApplyTarget);
        for (const operation of plan.operations) await setConvexEnv(operation, plan.deployment);
    }

    process.stdout.write(`${formatConvexAuthEnvPlan(plan, args.apply ? 'apply' : 'dry-run')}\n`);
}

async function setConvexEnv(operation: ConvexAuthEnvSetOperation, deployment: string | undefined): Promise<void> {
    const require = createRequire(import.meta.url);
    const convexBin = join(dirname(require.resolve('convex/package.json')), 'bin', 'main.js');
    const childEnv = { ...process.env };
    for (const name of privateKeyNames) Reflect.deleteProperty(childEnv, name);
    await execFileAsync(
        process.execPath,
        [convexBin, 'env', 'set', ...createDeploymentArgs(deployment), operation.name, operation.value],
        { env: childEnv, maxBuffer: 1024 * 1024, shell: false }
    );
}

function normalizeIssuer(value: string | undefined, name: string): string {
    const normalized = requireValue(value, name);
    let url: URL;
    try {
        url = new URL(normalized);
    } catch {
        throw new Error(`${name} must be a valid HTTP or HTTPS URL`);
    }
    if (!['http:', 'https:'].includes(url.protocol) || url.hostname.toLowerCase().endsWith('fluxer.app')) {
        throw new Error(`${name} must be a NeonFlux HTTP(S) issuer`);
    }
    return url.toString();
}

function optionalValue(value: string | undefined): string | undefined {
    const trimmed = value?.trim();
    return trimmed && trimmed.length > 0 ? trimmed : undefined;
}

function requireValue(value: string | undefined, name: string): string {
    const normalized = optionalValue(value);
    if (!normalized) throw new Error(`${name} is required`);
    return normalized;
}

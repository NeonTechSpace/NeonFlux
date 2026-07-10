import { execFile } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

import { loadLocalEnv } from '../packages/config/src/env.js';
import { validateConvexAuthConfigEnv } from './convex-auth-config-validate.js';

const execFileAsync = promisify(execFile);
const providerKinds = ['bot', 'web', 'user'] as const;
const requiredNames = providerKinds.flatMap((kind) => [
    `NEONFLUX_${kind.toUpperCase()}_AUTH_JWT_ISSUER`,
    `NEONFLUX_${kind.toUpperCase()}_AUTH_JWT_AUDIENCE`,
    `NEONFLUX_${kind.toUpperCase()}_AUTH_JWT_JWKS`,
]);
const forbiddenNames = providerKinds.map((kind) => `NEONFLUX_${kind.toUpperCase()}_AUTH_JWT_PRIVATE_KEY`);

export type ConvexAuthEnvValues = Partial<Record<string, string>>;
export type ConvexAuthEnvReadiness = {
    forbiddenPresent: string[];
    missing: string[];
    names: string[];
    ok: boolean;
    valueErrors: string[];
};

export function compareConvexAuthEnvValues(target: ConvexAuthEnvValues, deploy: ConvexAuthEnvValues): string[] {
    return requiredNames.flatMap((name) => {
        const targetValue = optionalValue(target[name]);
        const deployValue = optionalValue(deploy[name]);
        return targetValue && deployValue && targetValue !== deployValue ? [`Deploy env mismatch: ${name}`] : [];
    });
}

export function evaluateDeployConvexAuthEnvValues(deploy: ConvexAuthEnvValues): string[] {
    const readiness = evaluateConvexAuthEnvValues(deploy);
    return [
        ...readiness.missing.map((name) => `Deploy env missing: ${name}`),
        ...readiness.valueErrors.map((error) => `Deploy env invalid: ${error}`),
    ];
}

export function evaluateConvexAuthEnvNames(names: Iterable<string>): ConvexAuthEnvReadiness {
    const nameSet = new Set(Array.from(names, (name) => name.trim()).filter(Boolean));
    const missing = requiredNames.filter((name) => !nameSet.has(name));
    const forbiddenPresent = forbiddenNames.filter((name) => nameSet.has(name));
    return {
        forbiddenPresent,
        missing,
        names: [...nameSet].sort(),
        ok: missing.length === 0 && forbiddenPresent.length === 0,
        valueErrors: [],
    };
}

export function evaluateConvexAuthEnvValues(values: ConvexAuthEnvValues): ConvexAuthEnvReadiness {
    const names = Object.keys(values).filter((name) => optionalValue(values[name]));
    const readiness = evaluateConvexAuthEnvNames(names);
    const valueErrors: string[] = [];

    if (readiness.missing.length === 0) {
        try {
            validateConvexAuthConfigEnv(values);
        } catch (error) {
            valueErrors.push(error instanceof Error ? error.message : String(error));
        }
    }

    return { ...readiness, ok: readiness.ok && valueErrors.length === 0, valueErrors };
}

export function createDeploymentArgs(deployment: string | undefined): string[] {
    const normalized = optionalValue(deployment);
    return normalized ? ['--deployment', /^(?:dev|prod):(.+)$/.exec(normalized)?.[1] ?? normalized] : [];
}

export function parseConvexAuthEnvReadinessArgs(args: string[]): { compareDeployEnv: boolean; deployment?: string } {
    const parsed: { compareDeployEnv: boolean; deployment?: string } = { compareDeployEnv: false };
    for (let index = 0; index < args.length; index += 1) {
        const arg = args[index];
        if (arg === '--compare-deploy-env') parsed.compareDeployEnv = true;
        else if (arg === '--deployment') {
            const value = args[index + 1];
            if (!value) throw new Error('--deployment requires a value');
            parsed.deployment = value;
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
    const args = parseConvexAuthEnvReadinessArgs(process.argv.slice(2));
    const deployment = optionalValue(args.deployment ?? process.env.CONVEX_DEPLOYMENT);
    const names = await listConvexEnvNames(deployment);
    const targetValues = await getValues(deployment, names);
    const readiness = evaluateConvexAuthEnvValues(targetValues);
    const deployValues = args.compareDeployEnv ? readPublicValues(process.env) : undefined;
    const deployErrors = deployValues
        ? [
              ...evaluateDeployConvexAuthEnvValues(deployValues),
              ...compareConvexAuthEnvValues(targetValues, deployValues),
          ]
        : [];

    if (!readiness.ok || deployErrors.length > 0) {
        throw new Error(
            [
                `Convex auth env is not ready for ${deployment ?? 'default dev deployment'}.`,
                readiness.missing.length ? `Missing: ${readiness.missing.join(', ')}` : undefined,
                readiness.forbiddenPresent.length ? `Forbidden: ${readiness.forbiddenPresent.join(', ')}` : undefined,
                ...readiness.valueErrors,
                ...deployErrors,
            ]
                .filter(Boolean)
                .join('\n')
        );
    }

    process.stdout.write(`Convex auth env is ready with isolated bot, web, and user providers.\n`);
}

async function listConvexEnvNames(deployment: string | undefined): Promise<string[]> {
    const result = await runConvex(['env', 'list', ...createDeploymentArgs(deployment), '--names-only']);
    return result
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith('◇'));
}

async function getValues(deployment: string | undefined, names: readonly string[]): Promise<ConvexAuthEnvValues> {
    const entries = await Promise.all(
        requiredNames
            .filter((name) => names.includes(name))
            .map(
                async (name) =>
                    [name, (await runConvex(['env', 'get', ...createDeploymentArgs(deployment), name])).trim()] as const
            )
    );
    return Object.fromEntries(entries);
}

async function runConvex(args: string[]): Promise<string> {
    const require = createRequire(import.meta.url);
    const convexBin = join(dirname(require.resolve('convex/package.json')), 'bin', 'main.js');
    const childEnv = { ...process.env };
    for (const name of forbiddenNames) Reflect.deleteProperty(childEnv, name);
    const result = await execFileAsync(process.execPath, [convexBin, ...args], {
        env: childEnv,
        maxBuffer: 1024 * 1024,
        shell: false,
    });
    return result.stdout;
}

function readPublicValues(env: NodeJS.ProcessEnv): ConvexAuthEnvValues {
    return Object.fromEntries(
        requiredNames.map((name) => [name, env[name]]).filter((entry) => entry[1])
    ) as ConvexAuthEnvValues;
}

function optionalValue(value: string | undefined): string | undefined {
    const trimmed = value?.trim();
    return trimmed && trimmed.length > 0 ? trimmed : undefined;
}

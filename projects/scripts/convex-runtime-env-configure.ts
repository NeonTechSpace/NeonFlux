import { execFile } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

import { loadLocalEnv } from '../packages/config/src/env.js';
import { DATA_RETENTION_DAYS_ENV, readDataRetentionDays } from '../convex/retention/retention_policy.js';
import { createConvexCliChildEnv } from './convex-cli.js';

const execFileAsync = promisify(execFile);

export type ConvexRuntimeEnvPlan = {
    deployment?: string;
    deploymentLabel: string;
    retentionDays: number;
};

export function createConvexRuntimeEnvPlan(
    env: NodeJS.ProcessEnv,
    options: { deployment?: string } = {}
): ConvexRuntimeEnvPlan {
    const deployment = optionalValue(options.deployment ?? env.CONVEX_DEPLOYMENT);

    return {
        ...(deployment ? { deployment } : {}),
        deploymentLabel: deployment ?? 'default dev deployment',
        retentionDays: readDataRetentionDays(env),
    };
}

export function parseConvexRuntimeEnvArgs(args: string[]): {
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

    if (!parsed.apply && optionalValue(parsed.confirmApplyTarget)) {
        throw new Error('--confirm-apply-target requires --apply');
    }
    if (parsed.apply && !optionalValue(parsed.deployment)) {
        throw new Error('--apply requires explicit --deployment <target>');
    }

    return parsed;
}

export function requireConvexRuntimeEnvApplyConfirmation(
    plan: Pick<ConvexRuntimeEnvPlan, 'deployment'>,
    confirmation: string | undefined
): asserts plan is ConvexRuntimeEnvPlan & { deployment: string } {
    if (!plan.deployment) throw new Error('--apply requires explicit --deployment <target>');
    if (optionalValue(confirmation) !== plan.deployment) {
        throw new Error(
            `Apply confirmation target ${confirmation ?? '(missing)'} does not match deployment ${plan.deployment}`
        );
    }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    await main().catch((error: unknown) => {
        process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
        process.exitCode = 1;
    });
}

async function main(): Promise<void> {
    loadLocalEnv();
    const args = parseConvexRuntimeEnvArgs(process.argv.slice(2));
    const plan = createConvexRuntimeEnvPlan(process.env, {
        ...(args.deployment ? { deployment: args.deployment } : {}),
    });

    if (args.apply) {
        requireConvexRuntimeEnvApplyConfirmation(plan, args.confirmApplyTarget);
        await setConvexEnv(plan.deployment, DATA_RETENTION_DAYS_ENV, String(plan.retentionDays));
    }

    process.stdout.write(
        `${args.apply ? 'Configured' : 'Would configure'} ${DATA_RETENTION_DAYS_ENV}=${String(plan.retentionDays)} for ${plan.deploymentLabel}.\n`
    );
}

async function setConvexEnv(deployment: string, name: string, value: string): Promise<void> {
    const require = createRequire(import.meta.url);
    const convexBin = join(dirname(require.resolve('convex/package.json')), 'bin', 'main.js');
    await execFileAsync(process.execPath, [convexBin, 'env', 'set', ...createDeploymentArgs(deployment), name, value], {
        env: createConvexCliChildEnv(process.env),
        maxBuffer: 1024 * 1024,
        shell: false,
    });
}

function createDeploymentArgs(deployment: string): string[] {
    return ['--deployment', /^(?:dev|prod):(.+)$/.exec(deployment)?.[1] ?? deployment];
}

function optionalValue(value: string | undefined): string | undefined {
    const trimmed = value?.trim();
    return trimmed && trimmed.length > 0 ? trimmed : undefined;
}

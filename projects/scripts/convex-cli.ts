import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { loadLocalEnv } from '../packages/config/src/env.js';
import { validateConvexAuthConfigEnv } from './convex-auth-config-validate.js';

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    await main().catch((error: unknown) => {
        process.stderr.write(`${formatErrorMessage(error)}\n`);
        process.exitCode = 1;
    });
}

async function main(): Promise<void> {
    loadLocalEnv();

    const args = normalizeConvexCliArgs(process.argv.slice(2));

    if (args.length === 0) {
        throw new Error('convex command arguments are required');
    }

    const require = createRequire(import.meta.url);
    const convexBin = join(dirname(require.resolve('convex/package.json')), 'bin', 'main.js');
    const childEnv = createConvexCliChildEnv(process.env);
    assertConvexCliAuthConfigReady(args, childEnv);

    const child = spawn(process.execPath, [convexBin, ...args], {
        env: childEnv,
        shell: false,
        stdio: 'inherit',
    });

    const forwardedSignals = ['SIGINT', 'SIGTERM'] as const;
    const forwardSignal = (signal: NodeJS.Signals): void => {
        if (!child.killed) {
            child.kill(signal);
        }
    };

    for (const signal of forwardedSignals) {
        process.once(signal, forwardSignal);
    }

    try {
        process.exitCode = await new Promise<number>((resolve, reject) => {
            child.on('error', reject);
            child.on('exit', (code) => resolve(code ?? 1));
        });
    } finally {
        for (const signal of forwardedSignals) {
            process.off(signal, forwardSignal);
        }
    }
}

export function normalizeConvexCliArgs(args: readonly string[]): string[] {
    const firstArg = args[0];

    if (firstArg === '--') {
        return [...args.slice(1)];
    }

    if (args[1] === '--') {
        return firstArg === undefined ? [...args.slice(2)] : [firstArg, ...args.slice(2)];
    }

    return [...args];
}

export function createConvexCliChildEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
    const childEnv = { ...env };

    delete childEnv.NEONFLUX_BOT_AUTH_JWT_PRIVATE_KEY;
    delete childEnv.NEONFLUX_WEB_AUTH_JWT_PRIVATE_KEY;
    delete childEnv.NEONFLUX_USER_AUTH_JWT_PRIVATE_KEY;

    return childEnv;
}

export function shouldValidateConvexCliAuthConfig(args: readonly string[]): boolean {
    return args[0] === 'codegen' || args[0] === 'deploy' || args[0] === 'dev';
}

export function assertConvexCliAuthConfigReady(args: readonly string[], env: NodeJS.ProcessEnv): void {
    const command = args[0];

    if (command !== 'codegen' && command !== 'deploy' && command !== 'dev') {
        return;
    }

    try {
        validateConvexAuthConfigEnv(env);
    } catch (error) {
        throw new Error(
            [
                `Convex ${command} requires deploy/codegen auth config before invoking the Convex CLI.`,
                formatErrorMessage(error),
                'Next: configure distinct bot, web, and user public JWT providers, run pnpm convex:validate-auth-config, then rerun this command.',
                'Use pnpm convex:check-auth-env -- --compare-deploy-env before deploy to verify the linked target env too.',
            ].join('\n'),
            { cause: error }
        );
    }
}

function formatErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

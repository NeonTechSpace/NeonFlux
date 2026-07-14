import { spawn } from 'node:child_process';
import { readFile, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { runAuthenticatedTests } from './authenticated-test-runner.js';
import {
    assertConvexCliEnvironmentContainsNoPrivateCredentials,
    e2eEphemeralSentinel,
    requireEphemeralSentinel,
    validateEphemeralConvexState,
} from './ephemeral-state.js';

const webDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const workspaceDirectory = resolve(webDirectory, '../..');
const statePath = resolve(webDirectory, '.e2e-runtime', 'convex', 'state.json');
const expectedRuntimeEnvPath = resolve(webDirectory, '.e2e-runtime', 'convex', 'runtime.env');
const providerStatePath = resolve(webDirectory, '.e2e-runtime', 'provider-state.json');
const pnpmEntrypoint = process.env.npm_execpath;

if (!pnpmEntrypoint) throw new Error('Signed-in tests must be started through a pnpm script.');

const testEnvironment = {
    ...withoutProjectCredentials(process.env),
    NEONFLUX_E2E_EPHEMERAL_SENTINEL: e2eEphemeralSentinel,
};
requireEphemeralSentinel(testEnvironment);

await runAuthenticatedTests({
    cleanup: async (started) => {
        const errors: unknown[] = [];
        try {
            await rm(providerStatePath, { force: true });
        } catch (error) {
            errors.push(error);
        }
        if (started) {
            try {
                await runPnpm(['--filter', 'neonflux-web', 'e2e:convex:stop'], testEnvironment);
            } catch (error) {
                errors.push(error);
            }
        }
        if (errors.length === 1) throw errors[0];
        if (errors.length > 1) throw new AggregateError(errors, 'Signed-in test cleanup failed.');
    },
    phases: [
        { name: 'Generate and verify Convex API files', run: runCodegenDriftCheck },
        {
            name: 'Run signed-in service tests',
            run: () => runPnpm(['--filter', 'neonflux-web', 'e2e:authenticated:services'], testEnvironment),
        },
        {
            name: 'Run signed-in browser tests',
            run: () => runPnpm(['--filter', 'neonflux-web', 'e2e:authenticated:browser'], testEnvironment),
        },
    ],
    start: () => runPnpm(['--filter', 'neonflux-web', 'e2e:convex:start'], testEnvironment),
});

async function runCodegenDriftCheck(): Promise<void> {
    const state = validateEphemeralConvexState(
        JSON.parse(await readFile(statePath, 'utf8')) as unknown,
        workspaceDirectory
    );
    if (resolve(state.runtimeEnvPath) !== expectedRuntimeEnvPath) {
        throw new Error('Ephemeral Convex state references an unowned runtime env file.');
    }
    const runtimeEnvironment = parseOwnedEnvironment(await readFile(state.runtimeEnvPath, 'utf8'));
    assertConvexCliEnvironmentContainsNoPrivateCredentials(runtimeEnvironment);
    await runPnpm(['exec', 'convex', 'codegen', '--typecheck', 'enable'], {
        ...testEnvironment,
        ...runtimeEnvironment,
    });
    await runCommand('git', ['diff', '--exit-code', '--', 'convex/_generated'], testEnvironment);
}

function parseOwnedEnvironment(source: string): NodeJS.ProcessEnv {
    const environment: NodeJS.ProcessEnv = {};
    for (const [lineIndex, line] of source.split(/\r?\n/u).entries()) {
        if (!line) continue;
        const separator = line.indexOf('=');
        if (separator <= 0) throw new Error(`Invalid owned runtime env line ${String(lineIndex + 1)}.`);
        const key = line.slice(0, separator);
        const value = JSON.parse(line.slice(separator + 1)) as unknown;
        if (typeof value !== 'string') throw new Error(`Owned runtime env value ${key} is not a string.`);
        environment[key] = value;
    }
    return environment;
}

function withoutProjectCredentials(environment: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
    const isolated = { ...environment };
    for (const key of Object.keys(isolated)) {
        const normalizedKey = key.toUpperCase();
        if (
            normalizedKey.startsWith('CONVEX_') ||
            normalizedKey.startsWith('NEONFLUX_') ||
            normalizedKey.startsWith('FLUXER_') ||
            normalizedKey === 'SESSION_SECRET'
        ) {
            Reflect.deleteProperty(isolated, key);
        }
    }
    return isolated;
}

function runPnpm(args: readonly string[], env: NodeJS.ProcessEnv): Promise<void> {
    return runCommand(process.execPath, [pnpmEntrypoint!, ...args], env, `pnpm ${args.join(' ')}`);
}

async function runCommand(
    commandName: string,
    args: readonly string[],
    env: NodeJS.ProcessEnv,
    label = commandName
): Promise<void> {
    const child = spawn(commandName, args, {
        cwd: workspaceDirectory,
        env,
        shell: false,
        stdio: 'inherit',
    });
    const exitCode = await new Promise<number>((resolveExit, reject) => {
        child.once('error', reject);
        child.once('exit', (code) => resolveExit(code ?? 1));
    });
    if (exitCode !== 0) throw new Error(`${label} exited with code ${String(exitCode)}.`);
}

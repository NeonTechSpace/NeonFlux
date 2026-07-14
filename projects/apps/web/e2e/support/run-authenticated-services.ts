import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { e2eEphemeralSentinel, requireEphemeralSentinel, validateEphemeralConvexState } from './ephemeral-state.js';

const webDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const workspaceDirectory = resolve(webDirectory, '../..');
const statePath = resolve(webDirectory, '.e2e-runtime', 'convex', 'state.json');
const expectedFixtureEnvPath = resolve(webDirectory, '.e2e-runtime', 'convex', 'fixture.env');
const pnpmEntrypoint = process.env.npm_execpath;

if (!pnpmEntrypoint) throw new Error('Signed-in service tests must be started through a pnpm script.');

const testEnvironment = {
    ...withoutProjectCredentials(process.env),
    NEONFLUX_E2E_EPHEMERAL_SENTINEL: e2eEphemeralSentinel,
};
requireEphemeralSentinel(testEnvironment);

const state = validateEphemeralConvexState(
    JSON.parse(await readFile(statePath, 'utf8')) as unknown,
    workspaceDirectory
);
if (resolve(state.fixtureEnvPath) !== expectedFixtureEnvPath) {
    throw new Error('Ephemeral Convex state references an unowned fixture env file.');
}
const runtimeEnvironment = parseOwnedRuntimeEnvironment(await readFile(state.fixtureEnvPath, 'utf8'));
await runPnpm(['exec', 'vitest', 'run', 'apps/web/e2e/support/authenticated-services.test.ts', '--maxWorkers=1'], {
    ...testEnvironment,
    ...runtimeEnvironment,
    NEONFLUX_E2E_AUTHENTICATED: e2eEphemeralSentinel,
});

function parseOwnedRuntimeEnvironment(source: string): NodeJS.ProcessEnv {
    const environment: NodeJS.ProcessEnv = {};
    for (const [lineIndex, line] of source.split(/\r?\n/u).entries()) {
        if (!line) continue;
        const separator = line.indexOf('=');
        if (separator <= 0) throw new Error(`Invalid owned runtime env line ${String(lineIndex + 1)}.`);
        const key = line.slice(0, separator);
        const encodedValue = line.slice(separator + 1);
        const value = JSON.parse(encodedValue) as unknown;
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

async function runPnpm(args: readonly string[], env: NodeJS.ProcessEnv): Promise<void> {
    const child = spawn(process.execPath, [pnpmEntrypoint!, ...args], {
        cwd: workspaceDirectory,
        env,
        shell: false,
        stdio: 'inherit',
    });
    const exitCode = await new Promise<number>((resolveExit, reject) => {
        child.once('error', reject);
        child.once('exit', (code) => resolveExit(code ?? 1));
    });
    if (exitCode !== 0) throw new Error(`pnpm ${args.join(' ')} exited with code ${String(exitCode)}.`);
}

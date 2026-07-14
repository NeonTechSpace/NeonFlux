import { spawn } from 'node:child_process';
import { readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { e2eEphemeralSentinel, requireEphemeralSentinel, validateEphemeralConvexState } from './ephemeral-state.js';

const webDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const workspaceDirectory = resolve(webDirectory, '../..');
const statePath = resolve(webDirectory, '.e2e-runtime', 'convex', 'state.json');
const expectedFixtureEnvPath = resolve(webDirectory, '.e2e-runtime', 'convex', 'fixture.env');
const providerStatePath = resolve(webDirectory, '.e2e-runtime', 'provider-state.json');
const pnpmEntrypoint = process.env.npm_execpath;

if (!pnpmEntrypoint) throw new Error('Signed-in browser tests must be started through a pnpm script.');

const testEnvironment = {
    ...withoutProjectCredentials(process.env),
    NEONFLUX_E2E_EPHEMERAL_SENTINEL: e2eEphemeralSentinel,
};
requireEphemeralSentinel(testEnvironment);

let primaryError: unknown;

try {
    const state = validateEphemeralConvexState(
        JSON.parse(await readFile(statePath, 'utf8')) as unknown,
        workspaceDirectory
    );
    if (resolve(state.fixtureEnvPath) !== expectedFixtureEnvPath) {
        throw new Error('Ephemeral Convex state references an unowned fixture env file.');
    }
    const fixtureEnvironment = parseOwnedEnvironment(await readFile(state.fixtureEnvPath, 'utf8'));
    await writeFile(providerStatePath, `${JSON.stringify(createInitialProviderState(), null, 2)}\n`, {
        encoding: 'utf8',
        flag: 'wx',
        mode: 0o600,
    });
    await runPnpm(
        ['--filter', 'neonflux-web', 'exec', 'playwright', 'test', '--config', 'playwright.authenticated.config.ts'],
        {
            ...testEnvironment,
            ...fixtureEnvironment,
            NEONFLUX_E2E_AUTHENTICATED: e2eEphemeralSentinel,
            NEONFLUX_E2E_PROVIDER_STATE_PATH: providerStatePath,
        }
    );
} catch (error) {
    primaryError = error;
} finally {
    try {
        await rm(providerStatePath, { force: true });
    } catch (cleanupError) {
        primaryError = combineCleanupError(primaryError, cleanupError);
    }
}

if (primaryError) throw primaryError;

function combineCleanupError(primary: unknown, cleanup: unknown): unknown {
    return primary
        ? new AggregateError([primary, cleanup], 'Authenticated Playwright and owned cleanup both failed.')
        : cleanup;
}

function createInitialProviderState() {
    return {
        guild: {
            id: 'e2e-browser-guild-bootstrap',
            name: 'E2E Browser Guild',
            owner_id: 'e2e-browser-user-1',
            permissions: '32',
        },
        sentinel: e2eEphemeralSentinel,
        structure: providerStructure('Original'),
    };
}

function providerStructure(roleName: string) {
    return {
        categories: [],
        channels: [
            {
                id: 'channel-1',
                name: 'general',
                parentId: null,
                permissionOverwrites: [],
                position: 0,
                type: 0,
            },
        ],
        guildId: 'e2e-browser-guild-bootstrap',
        guildName: 'E2E Browser Guild',
        roles: [
            {
                color: 0,
                hoist: false,
                id: 'role-1',
                mentionable: false,
                name: roleName,
                permissions: '0',
                position: 1,
            },
        ],
    };
}

function parseOwnedEnvironment(source: string): NodeJS.ProcessEnv {
    const environment: NodeJS.ProcessEnv = {};
    for (const [lineIndex, line] of source.split(/\r?\n/u).entries()) {
        if (!line) continue;
        const separator = line.indexOf('=');
        if (separator <= 0) throw new Error(`Invalid owned fixture env line ${String(lineIndex + 1)}.`);
        const key = line.slice(0, separator);
        const value = JSON.parse(line.slice(separator + 1)) as unknown;
        if (typeof value !== 'string') throw new Error(`Owned fixture env value ${key} is not a string.`);
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

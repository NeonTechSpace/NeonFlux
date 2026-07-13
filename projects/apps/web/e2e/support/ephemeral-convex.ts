import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
    e2eEphemeralSentinel,
    e2eProjectPrefix,
    requireEphemeralSentinel,
    validateEphemeralConvexState,
} from './ephemeral-state.js';
import type { EphemeralConvexState } from './ephemeral-state.js';

const webDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const workspaceDirectory = resolve(webDirectory, '../..');
const runtimeDirectory = resolve(webDirectory, '.e2e-runtime', 'convex');
const statePath = resolve(runtimeDirectory, 'state.json');
const envPath = resolve(runtimeDirectory, 'compose.env');
const composeFiles = [
    resolve(workspaceDirectory, 'docker-compose.convex.yml'),
    resolve(webDirectory, 'e2e', 'docker-compose.e2e.yml'),
];
const command = process.argv[2];

switch (command) {
    case 'start':
        await start();
        break;
    case 'stop':
        await stop();
        break;
    case 'status':
        await status();
        break;
    default:
        throw new Error('Expected one command: start, stop, or status.');
}

async function start(): Promise<void> {
    requireEphemeralSentinel(process.env);
    await assertDockerReady();
    await mkdir(runtimeDirectory, { recursive: true });

    const suffix = `${String(process.pid)}-${randomBytes(4).toString('hex')}`;
    const instanceName = `neonflux_e2e_${suffix.replaceAll('-', '_')}`;
    const backendPort = await findFreePort();
    let sitePort = await findFreePort();
    while (sitePort === backendPort) sitePort = await findFreePort();
    const state: EphemeralConvexState = {
        backendPort,
        composeFiles,
        envPath,
        projectName: `${e2eProjectPrefix}${suffix}`,
        sentinel: e2eEphemeralSentinel,
        sitePort,
        startedAt: new Date().toISOString(),
        workspaceDirectory,
    };

    await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
    try {
        await writeFile(envPath, createComposeEnvironment(state, instanceName), {
            encoding: 'utf8',
            flag: 'wx',
            mode: 0o600,
        });
    } catch (error) {
        await rm(statePath, { force: true });
        throw error;
    }

    try {
        await runCompose(state, ['up', '-d', 'convex-db', 'backend']);
        await waitForBackend(state.backendPort);
    } catch (error) {
        try {
            await stopRecordedState(state);
        } catch (cleanupError) {
            throw new AggregateError([error, cleanupError], 'Ephemeral Convex startup and owned cleanup both failed.');
        }
        throw error;
    }

    process.stdout.write(
        `Ephemeral Convex backend ${state.projectName} is ready at http://127.0.0.1:${String(state.backendPort)}.\n`
    );
    process.stdout.write(
        'Authenticated E2E still requires deterministic self-hosted function/auth deployment before fixture seeding.\n'
    );
}

async function stop(): Promise<void> {
    requireEphemeralSentinel(process.env);
    const state = await readState();
    await stopRecordedState(state);
}

async function stopRecordedState(state: EphemeralConvexState): Promise<void> {
    assertOwnedState(state);
    await runCompose(state, ['down', '--volumes', '--remove-orphans']);
    await rm(state.envPath, { force: true });
    await rm(statePath, { force: true });
}

async function status(): Promise<void> {
    const state = await readState();
    process.stdout.write(`${JSON.stringify(state, null, 2)}\n`);
    await runCompose(state, ['ps']);
}

async function readState(): Promise<EphemeralConvexState> {
    const value = JSON.parse(await readFile(statePath, 'utf8')) as unknown;
    const state = validateEphemeralConvexState(value, workspaceDirectory);
    assertOwnedState(state);
    return state;
}

function assertOwnedState(state: EphemeralConvexState): void {
    validateEphemeralConvexState(state, workspaceDirectory);
    if (resolve(state.envPath) !== envPath) throw new Error('Ephemeral Convex state references an unowned env file.');
    if (
        state.composeFiles.length !== composeFiles.length ||
        state.composeFiles.some((file, index) => resolve(file) !== composeFiles[index])
    ) {
        throw new Error('Ephemeral Convex state references unowned Compose files.');
    }
}

async function assertDockerReady(): Promise<void> {
    await run('docker', ['version', '--format', '{{.Server.Version}}'], workspaceDirectory, process.env);
}

async function runCompose(state: EphemeralConvexState, args: readonly string[]): Promise<void> {
    const composeArgs = ['compose'];
    for (const file of state.composeFiles) composeArgs.push('-f', file);
    composeArgs.push('--project-name', state.projectName, '--env-file', state.envPath, ...args);
    await run('docker', composeArgs, workspaceDirectory, createDockerEnvironment(process.env));
}

function createDockerEnvironment(environment: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
    const isolatedEnvironment = { ...environment };
    for (const key of Object.keys(isolatedEnvironment)) {
        if (
            key.startsWith('COMPOSE_') ||
            key.startsWith('CONVEX_') ||
            key === 'NEONFLUX_E2E_COMPOSE_PROJECT' ||
            key === 'NEXT_PUBLIC_DEPLOYMENT_URL'
        ) {
            Reflect.deleteProperty(isolatedEnvironment, key);
        }
    }
    return isolatedEnvironment;
}

async function run(commandName: string, args: readonly string[], cwd: string, env: NodeJS.ProcessEnv): Promise<void> {
    const child = spawn(commandName, args, { cwd, env, shell: false, stdio: 'inherit' });
    const exitCode = await new Promise<number>((resolveExit, reject) => {
        child.once('error', reject);
        child.once('exit', (code) => resolveExit(code ?? 1));
    });
    if (exitCode !== 0) throw new Error(`${commandName} exited with code ${String(exitCode)}.`);
}

function createComposeEnvironment(state: EphemeralConvexState, instanceName: string): string {
    const backendOrigin = `http://127.0.0.1:${String(state.backendPort)}`;
    const siteOrigin = `http://127.0.0.1:${String(state.sitePort)}`;
    return [
        `CONVEX_CLOUD_ORIGIN=${backendOrigin}`,
        'CONVEX_DO_NOT_REQUIRE_SSL=1',
        `CONVEX_INSTANCE_NAME=${instanceName}`,
        `CONVEX_INSTANCE_SECRET=${randomBytes(32).toString('hex')}`,
        `CONVEX_PORT=127.0.0.1:${String(state.backendPort)}`,
        `CONVEX_POSTGRES_DB=${instanceName}`,
        `CONVEX_POSTGRES_PASSWORD=${randomBytes(24).toString('base64url')}`,
        'CONVEX_POSTGRES_USER=convex',
        `CONVEX_SITE_ORIGIN=${siteOrigin}`,
        `CONVEX_SITE_PROXY_PORT=127.0.0.1:${String(state.sitePort)}`,
        'CONVEX_RUST_LOG=warn',
        `NEXT_PUBLIC_DEPLOYMENT_URL=${backendOrigin}`,
        `NEONFLUX_E2E_COMPOSE_PROJECT=${state.projectName}`,
        '',
    ].join('\n');
}

async function findFreePort(): Promise<number> {
    return await new Promise((resolvePort, reject) => {
        const probe = createServer();
        probe.once('error', reject);
        probe.listen(0, '127.0.0.1', () => {
            const address = probe.address();
            if (!address || typeof address === 'string') {
                probe.close();
                reject(new Error('Could not allocate an ephemeral TCP port.'));
                return;
            }
            probe.close(() => resolvePort(address.port));
        });
    });
}

async function waitForBackend(port: number): Promise<void> {
    const deadline = Date.now() + 60_000;
    const url = `http://127.0.0.1:${String(port)}/version`;
    while (Date.now() < deadline) {
        try {
            const response = await fetch(url);
            if (response.ok) return;
        } catch {
            // The owned container is still starting.
        }
        await new Promise((resolveWait) => setTimeout(resolveWait, 500));
    }
    throw new Error(`Ephemeral Convex backend did not become ready at ${url}.`);
}

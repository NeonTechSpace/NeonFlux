import { spawn } from 'node:child_process';
import { createPublicKey, generateKeyPairSync, randomBytes } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
    assertConvexCliEnvironmentContainsNoPrivateCredentials,
    createConvexPublicAuthEnvironment,
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
const runtimeEnvPath = resolve(runtimeDirectory, 'runtime.env');
const fixtureEnvPath = resolve(runtimeDirectory, 'fixture.env');
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
        fixtureEnvPath,
        projectName: `${e2eProjectPrefix}${suffix}`,
        runtimeEnvPath,
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
        const adminKey = await generateAdminKey(state);
        const credentials = createFixtureCredentials(state);
        await writeFile(runtimeEnvPath, createRuntimeEnvironment(state, adminKey, credentials), {
            encoding: 'utf8',
            flag: 'wx',
            mode: 0o600,
        });
        await writeFile(fixtureEnvPath, createFixtureEnvironment(state, credentials), {
            encoding: 'utf8',
            flag: 'wx',
            mode: 0o600,
        });
        await configureConvexAuthEnvironment(state, adminKey, credentials);
        await deployFunctions(state);
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
    process.stdout.write('Current Convex functions and isolated JWT providers are deployed for authenticated E2E.\n');
}

async function stop(): Promise<void> {
    requireEphemeralSentinel(process.env);
    const state = await readState();
    await stopRecordedState(state);
}

async function stopRecordedState(state: EphemeralConvexState): Promise<void> {
    assertOwnedState(state);
    let composeError: unknown;
    try {
        await runCompose(state, ['down', '--volumes', '--remove-orphans']);
    } catch (error) {
        composeError = error;
    }

    const cleanupResults = await Promise.allSettled([
        rm(state.envPath, { force: true }),
        rm(state.runtimeEnvPath, { force: true }),
        rm(state.fixtureEnvPath, { force: true }),
        rm(statePath, { force: true }),
    ]);
    const cleanupErrors = cleanupResults.flatMap((result) => (result.status === 'rejected' ? [result.reason] : []));
    if (composeError || cleanupErrors.length > 0) {
        throw new AggregateError(
            [...(composeError ? [composeError] : []), ...cleanupErrors],
            'Ephemeral Convex cleanup did not complete cleanly.'
        );
    }
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
    if (resolve(state.runtimeEnvPath) !== runtimeEnvPath) {
        throw new Error('Ephemeral Convex state references an unowned runtime env file.');
    }
    if (resolve(state.fixtureEnvPath) !== fixtureEnvPath) {
        throw new Error('Ephemeral Convex state references an unowned fixture env file.');
    }
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
    const composeArgs = createComposeArgs(state, args);
    await run('docker', composeArgs, workspaceDirectory, createDockerEnvironment(process.env));
}

function createComposeArgs(state: EphemeralConvexState, args: readonly string[]): string[] {
    const composeArgs = ['compose'];
    for (const file of state.composeFiles) composeArgs.push('-f', file);
    composeArgs.push('--project-name', state.projectName, '--env-file', state.envPath, ...args);
    return composeArgs;
}

async function generateAdminKey(state: EphemeralConvexState): Promise<string> {
    const output = await runCapture(
        'docker',
        createComposeArgs(state, ['exec', '-T', 'backend', './generate_admin_key.sh']),
        workspaceDirectory,
        createDockerEnvironment(process.env)
    );
    const key = output.trim().split(/\s+/u).at(-1);
    if (!key || key.length < 20) throw new Error('Self-hosted Convex did not return a usable admin key.');
    return key;
}

async function deployFunctions(state: EphemeralConvexState): Promise<void> {
    const pnpmEntrypoint = process.env.npm_execpath;
    if (!pnpmEntrypoint) throw new Error('The E2E Convex launcher must be started through a pnpm script.');
    await run(
        process.execPath,
        [
            pnpmEntrypoint,
            'exec',
            'convex',
            'dev',
            '--once',
            '--tail-logs',
            'disable',
            '--typecheck',
            'enable',
            '--codegen',
            'disable',
            '--env-file',
            state.runtimeEnvPath,
        ],
        workspaceDirectory,
        createIsolatedRuntimeEnvironment(process.env)
    );
}

async function configureConvexAuthEnvironment(
    state: EphemeralConvexState,
    adminKey: string,
    credentials: FixtureCredentials
): Promise<void> {
    assertOwnedState(state);
    const pnpmEntrypoint = process.env.npm_execpath;
    if (!pnpmEntrypoint) throw new Error('The E2E Convex launcher must be started through a pnpm script.');
    const environment = createSelfHostedConvexEnvironment(state, adminKey);
    const publicAuthEnvironment = createConvexPublicAuthEnvironment(credentials.providers);
    for (const [name, value] of Object.entries(publicAuthEnvironment)) {
        await run(
            process.execPath,
            [pnpmEntrypoint, 'exec', 'convex', 'env', 'set', name, value],
            workspaceDirectory,
            environment
        );
    }
}

function createDockerEnvironment(environment: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
    const isolatedEnvironment = { ...environment };
    for (const key of Object.keys(isolatedEnvironment)) {
        const normalizedKey = key.toUpperCase();
        if (
            normalizedKey.startsWith('COMPOSE_') ||
            normalizedKey.startsWith('CONVEX_') ||
            normalizedKey.startsWith('FLUXER_') ||
            normalizedKey.startsWith('NEONFLUX_') ||
            normalizedKey === 'NEXT_PUBLIC_DEPLOYMENT_URL' ||
            normalizedKey === 'SESSION_SECRET'
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

async function runCapture(
    commandName: string,
    args: readonly string[],
    cwd: string,
    env: NodeJS.ProcessEnv
): Promise<string> {
    const child = spawn(commandName, args, { cwd, env, shell: false, stdio: ['ignore', 'pipe', 'inherit'] });
    let stdout = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
        stdout += chunk;
    });
    const exitCode = await new Promise<number>((resolveExit, reject) => {
        child.once('error', reject);
        child.once('exit', (code) => resolveExit(code ?? 1));
    });
    if (exitCode !== 0) throw new Error(`${commandName} exited with code ${String(exitCode)}.`);
    return stdout;
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

type FixtureProvider = {
    audience: string;
    issuer: string;
    jwks: string;
    privateKey: string;
    provider: 'BOT' | 'USER' | 'WEB';
};

type FixtureCredentials = {
    providers: FixtureProvider[];
    sessionSecret: string;
    tokenEncryptionKey: string;
};

function createFixtureCredentials(state: EphemeralConvexState): FixtureCredentials {
    const suffix = state.projectName.slice(e2eProjectPrefix.length).replaceAll(/[^A-Za-z0-9]/gu, '-');
    const providers = (['BOT', 'WEB', 'USER'] as const).map((provider) => {
        const privateKey = createPrivateKeyPem();
        return {
            audience: `neonflux-e2e-${provider.toLowerCase()}`,
            issuer: `https://${provider.toLowerCase()}.${suffix}.neonflux-e2e.invalid/`,
            jwks: createJwksDataUri(privateKey),
            privateKey: privateKey.trim().replace(/\r?\n/gu, '\\n'),
            provider,
        };
    });
    return {
        providers,
        sessionSecret: randomBytes(48).toString('base64url'),
        tokenEncryptionKey: randomBytes(32).toString('base64url'),
    };
}

function createRuntimeEnvironment(
    state: EphemeralConvexState,
    adminKey: string,
    credentials: FixtureCredentials
): string {
    const backendOrigin = `http://127.0.0.1:${String(state.backendPort)}`;
    const values: Record<string, string> = {
        CONVEX_SELF_HOSTED_ADMIN_KEY: adminKey,
        CONVEX_SELF_HOSTED_URL: backendOrigin,
        ...createConvexPublicAuthEnvironment(credentials.providers),
    };
    assertConvexCliEnvironmentContainsNoPrivateCredentials(values);
    return serializeEnvironment(values);
}

function createFixtureEnvironment(state: EphemeralConvexState, credentials: FixtureCredentials): string {
    const backendOrigin = `http://127.0.0.1:${String(state.backendPort)}`;
    const values: Record<string, string> = {
        APP_ENV: 'development',
        CONVEX_DEPLOYMENT: state.projectName,
        CONVEX_URL: backendOrigin,
        FLUXER_TOKEN_ENCRYPTION_KEY: credentials.tokenEncryptionKey,
        GUILD_DEFCON_OVERRIDE: '3',
        INSTANCE_MODE: 'multi',
        LOG_LEVEL: 'warn',
        NODE_ENV: 'test',
        SESSION_SECRET: credentials.sessionSecret,
        VITE_CONVEX_URL: backendOrigin,
    };
    for (const provider of credentials.providers) {
        values[`NEONFLUX_${provider.provider}_AUTH_JWT_AUDIENCE`] = provider.audience;
        values[`NEONFLUX_${provider.provider}_AUTH_JWT_ISSUER`] = provider.issuer;
        values[`NEONFLUX_${provider.provider}_AUTH_JWT_JWKS`] = provider.jwks;
        values[`NEONFLUX_${provider.provider}_AUTH_JWT_PRIVATE_KEY`] = provider.privateKey;
    }
    return serializeEnvironment(values);
}

function serializeEnvironment(values: Record<string, string>): string {
    return `${Object.entries(values)
        .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
        .join('\n')}\n`;
}

function createPrivateKeyPem(): string {
    const exported = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({
        format: 'pem',
        type: 'pkcs8',
    });
    return typeof exported === 'string' ? exported : exported.toString('utf8');
}

function createJwksDataUri(privateKeyPem: string): string {
    const publicJwk = createPublicKey(privateKeyPem).export({ format: 'jwk' });
    const jwks = {
        keys: [{ ...publicJwk, alg: 'RS256', kid: 'neonflux-convex-auth', use: 'sig' }],
    };
    return `data:application/json,${encodeURIComponent(JSON.stringify(jwks))}`;
}

function createIsolatedRuntimeEnvironment(environment: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
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
    assertConvexCliEnvironmentContainsNoPrivateCredentials(isolated);
    return isolated;
}

function createSelfHostedConvexEnvironment(state: EphemeralConvexState, adminKey: string): NodeJS.ProcessEnv {
    const environment: NodeJS.ProcessEnv = {
        ...createIsolatedRuntimeEnvironment(process.env),
        CONVEX_SELF_HOSTED_ADMIN_KEY: adminKey,
        CONVEX_SELF_HOSTED_URL: `http://127.0.0.1:${String(state.backendPort)}`,
    };
    assertConvexCliEnvironmentContainsNoPrivateCredentials(environment);
    return environment;
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

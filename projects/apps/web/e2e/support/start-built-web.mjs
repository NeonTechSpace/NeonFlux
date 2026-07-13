import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const expectedSentinel = 'neonflux-e2e-ephemeral-v1';
const webDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const workspaceDirectory = resolve(webDirectory, '../..');
const port = readPort(process.env.NEONFLUX_E2E_WEB_PORT, 4173);

if (process.env.NEONFLUX_E2E_EPHEMERAL_SENTINEL !== expectedSentinel) {
    throw new Error('Refusing to start the E2E web server without the ephemeral-test sentinel.');
}

await assertPortAvailable(port);

const childEnv = createSafeWebEnvironment(process.env, port);
let server;
let serverExitPromise;
let cleaningUp = false;
async function cleanup(signal) {
    if (cleaningUp) return;
    cleaningUp = true;
    if (server && server.exitCode === null) {
        if (!server.kill(signal)) throw new Error('Could not signal the owned E2E web server to stop.');
        await Promise.race([
            serverExitPromise,
            new Promise((_, reject) => {
                setTimeout(() => reject(new Error('Owned E2E web server did not stop within five seconds.')), 5_000);
            }),
        ]);
    }
}

try {
    const pnpmEntrypoint = process.env.npm_execpath;
    if (!pnpmEntrypoint) throw new Error('The E2E web launcher must be started through a pnpm script.');
    await runCommand(process.execPath, [pnpmEntrypoint, 'build:runtime-packages'], workspaceDirectory, childEnv);
    await runCommand(
        process.execPath,
        [pnpmEntrypoint, '--filter', 'neonflux-web', 'build'],
        workspaceDirectory,
        childEnv
    );

    server = spawn(process.execPath, ['scripts/start-web.mjs'], {
        cwd: workspaceDirectory,
        env: childEnv,
        shell: false,
        stdio: 'inherit',
    });
    serverExitPromise = new Promise((resolveExit, reject) => {
        server.once('error', reject);
        server.once('exit', (code) => resolveExit(code ?? 1));
    });

    for (const signal of ['SIGINT', 'SIGTERM']) {
        process.once(signal, () => {
            void cleanup(signal).then(
                () => process.exit(0),
                (error) => {
                    console.error(error);
                    process.exit(1);
                }
            );
        });
    }

    process.exitCode = await serverExitPromise;
} finally {
    await cleanup('SIGTERM');
}

function createSafeWebEnvironment(environment, webPort) {
    return {
        ...environment,
        APP_ENV: 'development',
        CONVEX_DEPLOYMENT: '',
        CONVEX_DEPLOY_KEY: '',
        CONVEX_URL: 'http://127.0.0.1:9',
        FLUXER_APP_ID: 'neonflux-e2e-public',
        FLUXER_BOT_CUSTOM_STATUS: '',
        FLUXER_BOT_INVITE_URL: '',
        FLUXER_BOT_TOKEN: '',
        FLUXER_CLIENT_SECRET: '',
        FLUXER_OAUTH_REDIRECT_URL: `http://127.0.0.1:${String(webPort)}/auth/fluxer/callback`,
        FLUXER_TOKEN_ENCRYPTION_KEY: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
        GUILD_DEFCON_OVERRIDE: '3',
        HOST: '127.0.0.1',
        INSTANCE_MODE: 'multi',
        LOG_LEVEL: 'warn',
        NEONFLUX_BOT_AUTH_JWT_AUDIENCE: '',
        NEONFLUX_BOT_AUTH_JWT_ISSUER: '',
        NEONFLUX_BOT_AUTH_JWT_JWKS: '',
        NEONFLUX_BOT_AUTH_JWT_PRIVATE_KEY: '',
        NEONFLUX_USER_AUTH_JWT_AUDIENCE: '',
        NEONFLUX_USER_AUTH_JWT_ISSUER: '',
        NEONFLUX_USER_AUTH_JWT_JWKS: '',
        NEONFLUX_USER_AUTH_JWT_PRIVATE_KEY: '',
        NEONFLUX_WEB_AUTH_JWT_AUDIENCE: '',
        NEONFLUX_WEB_AUTH_JWT_ISSUER: '',
        NEONFLUX_WEB_AUTH_JWT_JWKS: '',
        NEONFLUX_WEB_AUTH_JWT_PRIVATE_KEY: '',
        NODE_ENV: 'production',
        OWNER_IDS: '',
        PORT: String(webPort),
        PUBLIC_WEB_URL: `http://127.0.0.1:${String(webPort)}`,
        SESSION_SECRET: 'neonflux-e2e-session-secret-never-use-outside-ephemeral-tests',
        SINGLE_GUILD_ID: '',
        VITE_CONVEX_URL: 'http://127.0.0.1:9',
    };
}

function readPort(value, fallback) {
    const parsed = Number(value ?? fallback);
    if (!Number.isInteger(parsed) || parsed < 1024 || parsed > 65_535) {
        throw new Error('NEONFLUX_E2E_WEB_PORT must be an unprivileged TCP port.');
    }
    return parsed;
}

async function assertPortAvailable(candidatePort) {
    await new Promise((resolveListen, reject) => {
        const probe = createServer();
        probe.once('error', reject);
        probe.listen(candidatePort, '127.0.0.1', () => probe.close(resolveListen));
    });
}

async function runCommand(command, args, cwd, env) {
    const child = spawn(command, args, { cwd, env, shell: false, stdio: 'inherit' });
    const exitCode = await new Promise((resolveExit, reject) => {
        child.once('error', reject);
        child.once('exit', (code) => resolveExit(code ?? 1));
    });
    if (exitCode !== 0) throw new Error(`${command} exited with code ${String(exitCode)}.`);
}

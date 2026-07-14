import { defineConfig, devices } from '@playwright/test';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const sentinel = 'neonflux-e2e-ephemeral-v1';
const webPort = readPort(process.env.NEONFLUX_E2E_WEB_PORT, 4174);
const baseURL = `http://127.0.0.1:${String(webPort)}`;
const webDirectory = dirname(fileURLToPath(import.meta.url));
const providerStatePath = resolve(webDirectory, '.e2e-runtime', 'provider-state.json');
const isCI = Boolean(process.env.CI);

if (process.env.NEONFLUX_E2E_AUTHENTICATED !== sentinel) {
    throw new Error('Refusing signed-in browser tests without the temporary-test sentinel.');
}

const requiredFixtureKeys = [
    'APP_ENV',
    'CONVEX_DEPLOYMENT',
    'CONVEX_URL',
    'FLUXER_TOKEN_ENCRYPTION_KEY',
    'INSTANCE_MODE',
    'NEONFLUX_BOT_AUTH_JWT_AUDIENCE',
    'NEONFLUX_BOT_AUTH_JWT_ISSUER',
    'NEONFLUX_BOT_AUTH_JWT_JWKS',
    'NEONFLUX_BOT_AUTH_JWT_PRIVATE_KEY',
    'NEONFLUX_USER_AUTH_JWT_AUDIENCE',
    'NEONFLUX_USER_AUTH_JWT_ISSUER',
    'NEONFLUX_USER_AUTH_JWT_JWKS',
    'NEONFLUX_USER_AUTH_JWT_PRIVATE_KEY',
    'NEONFLUX_WEB_AUTH_JWT_AUDIENCE',
    'NEONFLUX_WEB_AUTH_JWT_ISSUER',
    'NEONFLUX_WEB_AUTH_JWT_JWKS',
    'NEONFLUX_WEB_AUTH_JWT_PRIVATE_KEY',
    'SESSION_SECRET',
    'VITE_CONVEX_URL',
] as const;

export default defineConfig({
    testDir: './e2e/authenticated-specs',
    fullyParallel: false,
    forbidOnly: true,
    outputDir: '.e2e-runtime/authenticated-test-results',
    reporter: isCI ? [['line'], ['github']] : [['line']],
    retries: process.env.CI ? 1 : 0,
    timeout: 60_000,
    use: {
        ...devices['Desktop Chrome'],
        baseURL,
        screenshot: 'only-on-failure',
        trace: isCI ? 'off' : 'retain-on-failure',
    },
    webServer: {
        command: 'pnpm e2e:serve',
        env: authenticatedWebEnvironment(webPort, providerStatePath),
        gracefulShutdown: { signal: 'SIGTERM', timeout: 5_000 },
        reuseExistingServer: false,
        timeout: 240_000,
        url: baseURL,
    },
    workers: 1,
});

function authenticatedWebEnvironment(port: number, statePath: string): Record<string, string> {
    const environment: Record<string, string> = {
        NEONFLUX_E2E_AUTHENTICATED: sentinel,
        NEONFLUX_E2E_EPHEMERAL_SENTINEL: sentinel,
        NEONFLUX_E2E_PROVIDER_STATE_PATH: statePath,
        NEONFLUX_E2E_WEB_PORT: String(port),
    };
    for (const key of requiredFixtureKeys) {
        const value = process.env[key];
        if (!value) throw new Error(`Signed-in browser tests require ${key} from the owned fixture environment.`);
        environment[key] = value;
    }
    return environment;
}

function readPort(value: string | undefined, fallback: number): number {
    const parsed = Number(value ?? fallback);
    if (!Number.isInteger(parsed) || parsed < 1024 || parsed > 65_535) {
        throw new Error('NEONFLUX_E2E_WEB_PORT must be an unprivileged TCP port.');
    }
    return parsed;
}

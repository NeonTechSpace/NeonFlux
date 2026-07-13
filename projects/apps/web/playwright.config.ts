import { defineConfig, devices } from '@playwright/test';

const webPort = readPort(process.env.NEONFLUX_E2E_WEB_PORT, 4173);
const baseURL = `http://127.0.0.1:${String(webPort)}`;

export default defineConfig({
    testDir: './e2e/specs',
    fullyParallel: false,
    forbidOnly: true,
    outputDir: '.e2e-runtime/test-results',
    reporter: [['line']],
    retries: process.env.CI ? 1 : 0,
    timeout: 30_000,
    use: {
        ...devices['Desktop Chrome'],
        baseURL,
        trace: 'retain-on-failure',
    },
    webServer: {
        command: 'pnpm e2e:serve',
        env: {
            NEONFLUX_E2E_EPHEMERAL_SENTINEL: 'neonflux-e2e-ephemeral-v1',
            NEONFLUX_E2E_WEB_PORT: String(webPort),
        },
        gracefulShutdown: { signal: 'SIGTERM', timeout: 5_000 },
        reuseExistingServer: false,
        timeout: 180_000,
        url: baseURL,
    },
    workers: 1,
});

function readPort(value: string | undefined, fallback: number): number {
    const parsed = Number(value ?? fallback);
    if (!Number.isInteger(parsed) || parsed < 1024 || parsed > 65_535) {
        throw new Error('NEONFLUX_E2E_WEB_PORT must be an unprivileged TCP port.');
    }
    return parsed;
}

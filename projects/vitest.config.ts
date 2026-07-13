import { defineConfig } from 'vitest/config';

import { readMaxWorkers } from './vitest-worker-policy';

export default defineConfig({
    test: {
        include: [
            'apps/bot/**/*.{test,spec}.{ts,tsx}',
            'apps/web/src/**/*.{test,spec}.{ts,tsx}',
            'apps/web/e2e/support/**/*.{test,spec}.ts',
            'convex/**/*.{test,spec}.ts',
            'packages/**/*.{test,spec}.ts',
            'scripts/**/*.{test,spec}.ts',
        ],
        hookTimeout: 30_000,
        maxWorkers: readMaxWorkers(),
        restoreMocks: true,
        testTimeout: 30_000,
    },
});

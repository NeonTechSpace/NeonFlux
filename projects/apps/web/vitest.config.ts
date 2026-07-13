import { defineConfig } from 'vitest/config';

import { readMaxWorkers } from '../../vitest-worker-policy';

export default defineConfig({
    test: {
        include: ['src/**/*.{test,spec}.{ts,tsx}'],
        hookTimeout: 30_000,
        maxWorkers: readMaxWorkers(),
        restoreMocks: true,
        testTimeout: 30_000,
    },
});

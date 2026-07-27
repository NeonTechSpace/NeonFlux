import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        name: 'service-integration',
        include: ['apps/web/e2e/support/authenticated-services.test.ts'],
        hookTimeout: 30_000,
        maxWorkers: 1,
        restoreMocks: true,
        testTimeout: 30_000,
    },
});

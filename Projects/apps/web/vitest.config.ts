import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        include: ['src/**/*.{test,spec}.{ts,tsx}'],
        hookTimeout: 30_000,
        restoreMocks: true,
        testTimeout: 30_000,
    },
});

import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        include: ['apps/**/*.{test,spec}.ts', 'packages/**/*.{test,spec}.ts', 'scripts/**/*.{test,spec}.ts'],
        hookTimeout: 30_000,
        restoreMocks: true,
        testTimeout: 30_000,
    },
});

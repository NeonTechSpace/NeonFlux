import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        include: ['apps/**/*.{test,spec}.ts', 'packages/**/*.{test,spec}.ts', 'scripts/**/*.{test,spec}.ts'],
        restoreMocks: true,
    },
});

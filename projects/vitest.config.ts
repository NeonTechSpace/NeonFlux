import { defineConfig } from 'vitest/config';

function readMaxWorkers(): number {
    const rawValue = process.env.VITEST_MAX_WORKERS;

    if (!rawValue) {
        return 6;
    }

    const parsedValue = Number(rawValue);

    return Number.isInteger(parsedValue) && parsedValue > 0 ? parsedValue : 6;
}

export default defineConfig({
    test: {
        include: ['apps/**/*.{test,spec}.{ts,tsx}', 'packages/**/*.{test,spec}.ts', 'scripts/**/*.{test,spec}.ts'],
        hookTimeout: 30_000,
        maxWorkers: readMaxWorkers(),
        restoreMocks: true,
        testTimeout: 30_000,
    },
});

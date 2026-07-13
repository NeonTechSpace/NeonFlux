import { availableParallelism } from 'node:os';

const availableThreads = availableParallelism();
const defaultMaxWorkers = Math.max(
    1,
    availableThreads > 12 ? Math.floor(availableThreads * 0.75) : Math.floor((availableThreads - 1) / 2)
);

export function readMaxWorkers(): number {
    const rawValue = process.env.VITEST_MAX_WORKERS;

    if (!rawValue) {
        return defaultMaxWorkers;
    }

    const parsedValue = Number(rawValue);

    return Number.isInteger(parsedValue) && parsedValue > 0 ? parsedValue : defaultMaxWorkers;
}

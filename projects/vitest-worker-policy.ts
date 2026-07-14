import { availableParallelism } from 'node:os';

export type VitestWorkerPolicyInput = {
    availableThreads: number;
    ci: boolean;
    override?: string;
};

export function resolveMaxWorkers(input: VitestWorkerPolicyInput): number {
    const override = readPositiveInteger(input.override);
    if (override !== undefined) return override;

    const availableThreads = Math.max(1, Math.floor(input.availableThreads));
    if (input.ci) return availableThreads;

    return Math.max(
        1,
        availableThreads > 12 ? Math.floor(availableThreads * 0.75) : Math.floor((availableThreads - 1) / 2)
    );
}

export function readMaxWorkers(): number {
    return resolveMaxWorkers({
        availableThreads: availableParallelism(),
        ci: process.env.CI === 'true',
        ...(process.env.VITEST_MAX_WORKERS ? { override: process.env.VITEST_MAX_WORKERS } : {}),
    });
}

function readPositiveInteger(value: string | undefined): number | undefined {
    if (!value || !/^[1-9]\d*$/u.test(value)) return undefined;
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) ? parsed : undefined;
}

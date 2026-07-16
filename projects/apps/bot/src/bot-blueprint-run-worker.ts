import { randomUUID } from 'node:crypto';

import type { AppLogger } from '@neonflux/core/logging';
import type { RuntimeDbClient } from '@neonflux/db';

import { runNextBlueprintRun } from './bot-blueprint-run-executor.js';

const workerFailureBackoffMinMs = 2_000;
const workerFailureBackoffMaxMs = 60_000;

export function startBlueprintRunWorker(input: {
    botToken: string;
    database: RuntimeDbClient;
    logger: AppLogger;
    intervalMs?: number;
}) {
    const leaseOwner = `blueprint-run-worker:${randomUUID()}`;
    let running: Promise<void> | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let disabled = false;
    let failureCount = 0;
    let idleCount = 0;
    const baseIntervalMs = input.intervalMs ?? 2_000;
    const idleDelays = input.intervalMs === undefined ? [2_000, 5_000, 10_000, 20_000, 30_000] : [baseIntervalMs];
    const schedule = (delayMs: number) => {
        if (disabled) return;
        const jitteredDelay = input.intervalMs === undefined ? jitterWorkerDelay(delayMs) : delayMs;
        timer = setTimeout(tick, jitteredDelay);
    };
    const tick = () => {
        if (disabled || running) return;
        let nextDelayMs: number | undefined;
        running = runNextBlueprintRun({ ...input, leaseOwner })
            .then((result) => {
                failureCount = 0;
                if (result === 'idle') {
                    idleCount += 1;
                    nextDelayMs = idleDelays[Math.min(idleCount - 1, idleDelays.length - 1)];
                    return;
                }
                idleCount = 0;
                if (result === 'progressed') {
                    nextDelayMs = baseIntervalMs;
                    return;
                }
                if (result.kind === 'backend_incompatible') {
                    disabled = true;
                    input.logger.error('blueprint_run.backend_incompatible', {
                        action: 'worker_disabled',
                    });
                    return;
                }
                disabled = true;
                input.logger.error('blueprint_run.protocol_mismatch', {
                    action: 'worker_disabled',
                    runId: result.runId,
                    runProtocolVersion: result.runProtocolVersion,
                    guildId: result.guildId,
                    mayHaveExternalEffects: result.mayHaveExternalEffects,
                    requiredProtocolVersion: result.requiredProtocolVersion,
                    status: result.status,
                });
            })
            .catch((error: unknown) => {
                failureCount += 1;
                const retryAfterMs = Math.min(
                    workerFailureBackoffMaxMs,
                    workerFailureBackoffMinMs * 2 ** Math.min(failureCount - 1, 20)
                );
                nextDelayMs = retryAfterMs;
                input.logger.error('blueprint_run.worker_failed', {
                    error: error instanceof Error ? error.message : String(error),
                    retryAfterMs,
                });
            })
            .finally(() => {
                running = undefined;
                if (nextDelayMs !== undefined) schedule(nextDelayMs);
            });
    };
    tick();
    return {
        async stop() {
            disabled = true;
            if (timer) clearTimeout(timer);
            await running;
        },
    };
}

function jitterWorkerDelay(delayMs: number): number {
    return Math.max(1, Math.round(delayMs * (0.9 + Math.random() * 0.2)));
}

import { expirePendingVcGeneratorControlRequests } from '@neonflux/db';
import type { AppLogger } from '@neonflux/core/logging';
import { err, ok, type Result } from 'neverthrow';

import type { BotFeatureHandlerContext, BotFeatureRouteError } from './bot-feature-types.js';

export type VcGeneratorMaintenanceSummary = {
    expiredControlRequests: number;
};

export type VcGeneratorMaintenanceScheduler = {
    start(): void;
    stop(): void;
    runOnce(): Promise<VcGeneratorMaintenanceSummary | undefined>;
};

type CreateVcGeneratorMaintenanceSchedulerInput = {
    createContext: () => BotFeatureHandlerContext;
    logger: AppLogger;
    intervalMs?: number;
    now?: () => Date;
};

const defaultVcGeneratorMaintenanceIntervalMs = 60_000;

export async function runVcGeneratorMaintenance(
    context: BotFeatureHandlerContext,
    input: { now: Date }
): Promise<Result<VcGeneratorMaintenanceSummary, BotFeatureRouteError>> {
    const expiredResult = await expirePendingVcGeneratorControlRequests(context.db, {
        now: input.now,
    });

    if (expiredResult.isErr()) {
        return err('database-error');
    }

    return ok({
        expiredControlRequests: expiredResult.value.length,
    });
}

export function createVcGeneratorMaintenanceScheduler(
    input: CreateVcGeneratorMaintenanceSchedulerInput
): VcGeneratorMaintenanceScheduler {
    let interval: ReturnType<typeof setInterval> | undefined;
    let running = false;

    async function runOnce(): Promise<VcGeneratorMaintenanceSummary | undefined> {
        if (running) return undefined;

        running = true;

        try {
            const result = await runVcGeneratorMaintenance(input.createContext(), {
                now: input.now?.() ?? new Date(),
            });

            if (result.isErr()) {
                input.logger.error('vc_generator.maintenance_failed', { error: result.error });
                return undefined;
            }

            logMaintenanceSummary(input.logger, result.value);

            return result.value;
        } catch (error) {
            input.logger.error('vc_generator.maintenance_failed', { error });
            return undefined;
        } finally {
            running = false;
        }
    }

    return {
        start() {
            if (interval) return;

            void runOnce();
            interval = setInterval(() => {
                void runOnce();
            }, input.intervalMs ?? defaultVcGeneratorMaintenanceIntervalMs);
        },
        stop() {
            if (!interval) return;

            clearInterval(interval);
            interval = undefined;
        },
        runOnce,
    };
}

function logMaintenanceSummary(logger: AppLogger, summary: VcGeneratorMaintenanceSummary): void {
    if (summary.expiredControlRequests === 0) {
        return;
    }

    logger.info('vc_generator.maintenance_completed', summary);
}

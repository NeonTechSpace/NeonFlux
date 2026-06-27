import type { AppLogger } from '@neonflux/core/logging';

import type { BotFeatureHandlerContext } from './bot-feature-types.js';
import { runGiveawayMaintenance, type GiveawayMaintenanceSummary } from './bot-giveaways.js';

export type GiveawayMaintenanceScheduler = {
    start(): void;
    stop(): void;
    runOnce(): Promise<GiveawayMaintenanceSummary | undefined>;
};

type CreateGiveawayMaintenanceSchedulerInput = {
    createContext: () => BotFeatureHandlerContext;
    logger: AppLogger;
    intervalMs?: number;
    now?: () => Date;
};

const defaultGiveawayMaintenanceIntervalMs = 60_000;

export function createGiveawayMaintenanceScheduler(
    input: CreateGiveawayMaintenanceSchedulerInput
): GiveawayMaintenanceScheduler {
    let interval: ReturnType<typeof setInterval> | undefined;
    let running = false;

    async function runOnce(): Promise<GiveawayMaintenanceSummary | undefined> {
        if (running) return undefined;

        running = true;

        try {
            const result = await runGiveawayMaintenance(input.createContext(), {
                now: input.now?.() ?? new Date(),
            });

            if (result.isErr()) {
                input.logger.error('giveaways.maintenance_failed', { error: result.error });
                return undefined;
            }

            logMaintenanceSummary(input.logger, result.value);

            return result.value;
        } catch (error) {
            input.logger.error('giveaways.maintenance_failed', { error });
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
            }, input.intervalMs ?? defaultGiveawayMaintenanceIntervalMs);
        },
        stop() {
            if (!interval) return;

            clearInterval(interval);
            interval = undefined;
        },
        runOnce,
    };
}

function logMaintenanceSummary(logger: AppLogger, summary: GiveawayMaintenanceSummary): void {
    if (
        summary.closed === 0 &&
        summary.closeSkipped === 0 &&
        summary.closeAnnouncementFailed === 0 &&
        summary.repaired === 0 &&
        summary.repairFailed === 0 &&
        summary.reactionReconciled === 0 &&
        summary.reactionReconcileFailed === 0
    ) {
        return;
    }

    logger.info('giveaways.maintenance_completed', summary);
}

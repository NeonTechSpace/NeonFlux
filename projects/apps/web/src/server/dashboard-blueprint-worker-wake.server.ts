import type { AppLogger } from '@neonflux/core/logging';

import { wakeDashboardBotBlueprintWorker } from './bot-internal-api-client.server.js';
import { getWebLogger } from './web-logger.server.js';

type WakeLogger = Pick<AppLogger, 'warn'>;

export async function wakeDashboardBlueprintWorkerBestEffort(input?: { logger?: WakeLogger }): Promise<void> {
    let errorClass: string | undefined;
    try {
        const result = await wakeDashboardBotBlueprintWorker();
        if (result.isErr()) errorClass = result.error;
    } catch {
        errorClass = 'unexpected-failure';
    }
    if (!errorClass) return;

    try {
        (input?.logger ?? safelyGetWebLogger())?.warn('blueprint.worker_wake_failed', { errorClass });
    } catch {
        // A durable run remains recoverable through bounded worker polling.
    }
}

function safelyGetWebLogger(): WakeLogger | undefined {
    try {
        return getWebLogger();
    } catch {
        return undefined;
    }
}

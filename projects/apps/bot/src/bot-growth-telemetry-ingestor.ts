import type { AppLogger } from '@neonflux/core/logging';
import type { Result } from 'neverthrow';

import type {
    BotGrowthTelemetryAdmission,
    BotGrowthTelemetryEvent,
    BotGrowthTelemetryIngestor,
} from './bot-feature-types.js';
import type { BotGrowthTrackingResult } from './bot-growth-tracking.js';

const BOT_GROWTH_TELEMETRY_CONCURRENCY = 4;
const BOT_GROWTH_TELEMETRY_MAX_QUEUED = 1_000;
const BOT_GROWTH_TELEMETRY_PROCESSING_DEADLINE_MS = 20_000;
const BOT_GROWTH_TELEMETRY_STOP_DEADLINE_MS = 15_000;

type GrowthProcessor = (
    event: BotGrowthTelemetryEvent,
    signal: AbortSignal
) => Promise<Result<BotGrowthTrackingResult, 'database-error'>>;

type ActiveGrowthWork = {
    abortKind?: 'processing-timeout' | 'shutdown';
    controller: AbortController;
    event: BotGrowthTelemetryEvent;
};

export function createBotGrowthTelemetryIngestor(input: {
    concurrency?: number;
    logger: Pick<AppLogger, 'warn'>;
    maxQueued?: number;
    process: GrowthProcessor;
    processingDeadlineMs?: number;
    stopDeadlineMs?: number;
}): BotGrowthTelemetryIngestor {
    const concurrency = normalizePositiveInteger(input.concurrency, BOT_GROWTH_TELEMETRY_CONCURRENCY);
    const maxQueued = normalizeNonNegativeInteger(input.maxQueued, BOT_GROWTH_TELEMETRY_MAX_QUEUED);
    const processingDeadlineMs = normalizePositiveInteger(
        input.processingDeadlineMs,
        BOT_GROWTH_TELEMETRY_PROCESSING_DEADLINE_MS
    );
    const stopDeadlineMs = normalizePositiveInteger(input.stopDeadlineMs, BOT_GROWTH_TELEMETRY_STOP_DEADLINE_MS);
    const queue: BotGrowthTelemetryEvent[] = [];
    const activeJoinGuildIds = new Set<string>();
    const activeWork = new Set<ActiveGrowthWork>();
    let accepting = true;
    let drainPromise: Promise<void> | undefined;
    let resolveDrain: (() => void) | undefined;
    let stopTimer: ReturnType<typeof setTimeout> | undefined;

    const completeDrainIfIdle = () => {
        if (activeWork.size !== 0 || queue.length !== 0) return;
        if (stopTimer) clearTimeout(stopTimer);
        stopTimer = undefined;
        resolveDrain?.();
    };

    const isEligible = (event: BotGrowthTelemetryEvent): boolean =>
        event.type !== 'member.joined' || !activeJoinGuildIds.has(event.guildId);

    const pump = () => {
        while (activeWork.size < concurrency) {
            const index = queue.findIndex(isEligible);
            if (index < 0) break;
            const [event] = queue.splice(index, 1);
            if (event) start(event);
        }
        completeDrainIfIdle();
    };

    const start = (event: BotGrowthTelemetryEvent) => {
        const work: ActiveGrowthWork = { controller: new AbortController(), event };
        activeWork.add(work);
        if (event.type === 'member.joined') activeJoinGuildIds.add(event.guildId);

        const processingTimer = setTimeout(() => {
            work.abortKind = 'processing-timeout';
            work.controller.abort(new DOMException('Growth telemetry processing timed out.', 'TimeoutError'));
        }, processingDeadlineMs);
        const processing = Promise.resolve().then(() => input.process(event, work.controller.signal));

        void settleWithAbort(processing, work.controller.signal)
            .then(
                (result) => {
                    if (result.isErr()) warnFailure(input.logger, event, 'database-error');
                },
                () => {
                    if (work.abortKind === 'shutdown') return;
                    warnFailure(
                        input.logger,
                        event,
                        work.abortKind === 'processing-timeout' ? 'processing-timeout' : 'unexpected-error'
                    );
                }
            )
            .finally(() => {
                clearTimeout(processingTimer);
                activeWork.delete(work);
                if (event.type === 'member.joined') activeJoinGuildIds.delete(event.guildId);
                pump();
            });
    };

    const forceStop = () => {
        if (activeWork.size === 0 && queue.length === 0) {
            completeDrainIfIdle();
            return;
        }

        const queued = queue.splice(0);
        const active = [...activeWork];
        input.logger.warn('bot.growth_tracking_shutdown_forced', {
            activeCount: active.length,
            eventTypeCounts: countEventTypes([...queued, ...active.map((work) => work.event)]),
            queuedDropCount: queued.length,
        });

        for (const work of active) {
            work.abortKind = 'shutdown';
            work.controller.abort(new DOMException('Growth telemetry shutdown deadline reached.', 'AbortError'));
        }
        completeDrainIfIdle();
    };

    return {
        enqueue(event): BotGrowthTelemetryAdmission {
            if (!accepting) {
                warnDrop(input.logger, event, 'stopped');
                return 'stopped';
            }

            if (activeWork.size < concurrency && isEligible(event)) {
                start(event);
                return 'accepted';
            }

            if (queue.length >= maxQueued) {
                warnDrop(input.logger, event, 'overloaded');
                return 'overloaded';
            }

            queue.push(event);
            pump();
            return 'accepted';
        },
        stop(): Promise<void> {
            accepting = false;
            if (activeWork.size === 0 && queue.length === 0) return Promise.resolve();
            if (drainPromise) return drainPromise;

            drainPromise = new Promise<void>((resolve) => {
                resolveDrain = resolve;
            });
            stopTimer = setTimeout(forceStop, stopDeadlineMs);
            return drainPromise;
        },
    };
}

function settleWithAbort<T>(request: Promise<T>, signal: AbortSignal): Promise<T> {
    signal.throwIfAborted();

    return new Promise<T>((resolve, reject) => {
        let settled = false;
        const cleanup = () => signal.removeEventListener('abort', handleAbort);
        const settle = (callback: () => void) => {
            if (settled) return;
            settled = true;
            cleanup();
            callback();
        };
        const handleAbort = () =>
            settle(() => {
                const reason: unknown = signal.reason;
                reject(reason instanceof Error ? reason : new DOMException('Growth telemetry aborted.', 'AbortError'));
            });

        signal.addEventListener('abort', handleAbort, { once: true });
        void request.then(
            (value) => settle(() => resolve(value)),
            (error: unknown) =>
                settle(() => reject(error instanceof Error ? error : new Error('Growth telemetry processing failed.')))
        );
        if (signal.aborted) handleAbort();
    });
}

function countEventTypes(events: readonly BotGrowthTelemetryEvent[]): Record<BotGrowthTelemetryEvent['type'], number> {
    const counts: Record<BotGrowthTelemetryEvent['type'], number> = {
        'member.joined': 0,
        'member.left': 0,
        'message.created': 0,
    };
    for (const event of events) counts[event.type] += 1;
    return counts;
}

function warnFailure(
    logger: Pick<AppLogger, 'warn'>,
    event: BotGrowthTelemetryEvent,
    error: 'database-error' | 'processing-timeout' | 'unexpected-error'
): void {
    logger.warn('bot.growth_tracking_failed', {
        error,
        eventType: event.type,
        guildId: event.guildId,
    });
}

function warnDrop(
    logger: Pick<AppLogger, 'warn'>,
    event: BotGrowthTelemetryEvent,
    reason: Exclude<BotGrowthTelemetryAdmission, 'accepted'>
): void {
    logger.warn('bot.growth_tracking_dropped', {
        eventType: event.type,
        guildId: event.guildId,
        reason,
    });
}

function normalizePositiveInteger(value: number | undefined, fallback: number): number {
    return Number.isSafeInteger(value) && Number(value) > 0 ? Number(value) : fallback;
}

function normalizeNonNegativeInteger(value: number | undefined, fallback: number): number {
    return Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : fallback;
}

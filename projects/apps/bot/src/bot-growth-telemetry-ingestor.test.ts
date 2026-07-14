import { err, ok, type Result } from 'neverthrow';
import { describe, expect, it, vi } from 'vitest';

import type { BotGrowthTelemetryEvent } from './bot-feature-types.js';
import { createBotGrowthTelemetryIngestor } from './bot-growth-telemetry-ingestor.js';
import type { BotGrowthTrackingResult } from './bot-growth-tracking.js';

describe('bot growth telemetry ingestor', () => {
    it('bounds active and queued work, drops newest overload, and drains admitted work on stop', async () => {
        const pending: Array<ReturnType<typeof createDeferred>> = [];
        const process = vi.fn(() => {
            const deferred = createDeferred();
            pending.push(deferred);
            return deferred.promise;
        });
        const logger = { warn: vi.fn() };
        const ingestor = createBotGrowthTelemetryIngestor({ concurrency: 2, logger, maxQueued: 1, process });

        expect(ingestor.enqueue(createMessageEvent('message-1'))).toBe('accepted');
        expect(ingestor.enqueue(createMessageEvent('message-2'))).toBe('accepted');
        expect(ingestor.enqueue(createMessageEvent('message-3'))).toBe('accepted');
        expect(ingestor.enqueue(createMessageEvent('message-4'))).toBe('overloaded');
        await Promise.resolve();

        expect(process).toHaveBeenCalledTimes(2);
        expect(logger.warn).toHaveBeenCalledWith('bot.growth_tracking_dropped', {
            eventType: 'message.created',
            guildId: 'guild-1',
            reason: 'overloaded',
        });

        let drained = false;
        const stop = ingestor.stop().then(() => {
            drained = true;
        });
        expect(ingestor.enqueue(createMessageEvent('message-5'))).toBe('stopped');

        pending[0]?.resolve(ok({ status: 'tracked' }));
        await vi.waitFor(() => expect(process).toHaveBeenCalledTimes(3));
        expect(drained).toBe(false);

        pending[1]?.resolve(ok({ status: 'tracked' }));
        pending[2]?.resolve(ok({ status: 'tracked' }));
        await stop;
        expect(drained).toBe(true);
    });

    it('normalizes processor failures without logging event payload details', async () => {
        const logger = { warn: vi.fn() };
        const ingestor = createBotGrowthTelemetryIngestor({
            logger,
            process: () => Promise.resolve(err('database-error')),
        });

        ingestor.enqueue(createMessageEvent('private-message'));
        await ingestor.stop();

        expect(logger.warn).toHaveBeenCalledExactlyOnceWith('bot.growth_tracking_failed', {
            error: 'database-error',
            eventType: 'message.created',
            guildId: 'guild-1',
        });
        expect(JSON.stringify(logger.warn.mock.calls)).not.toContain('private-message');
    });

    it('keeps same-guild joins queued without consuming capacity needed by other events', async () => {
        const pending: Array<{ deferred: ReturnType<typeof createDeferred>; event: BotGrowthTelemetryEvent }> = [];
        const process = vi.fn((event: BotGrowthTelemetryEvent) => {
            const deferred = createDeferred();
            pending.push({ deferred, event });
            return deferred.promise;
        });
        const ingestor = createBotGrowthTelemetryIngestor({
            concurrency: 2,
            logger: { warn: vi.fn() },
            process,
        });

        ingestor.enqueue(createJoinEvent('guild-1', 'user-1'));
        ingestor.enqueue(createJoinEvent('guild-1', 'user-2'));
        ingestor.enqueue(createMessageEvent('message-1'));
        await Promise.resolve();

        expect(process.mock.calls.map(([event]) => event.type)).toStrictEqual(['member.joined', 'message.created']);

        pending.find(({ event }) => event.type === 'message.created')?.deferred.resolve(ok({ status: 'tracked' }));
        await Promise.resolve();
        expect(process).toHaveBeenCalledTimes(2);

        pending[0]?.deferred.resolve(ok({ status: 'tracked' }));
        await vi.waitFor(() => expect(process).toHaveBeenCalledTimes(3));
        expect(process.mock.calls[2]?.[0]).toMatchObject({ type: 'member.joined', userId: 'user-2' });

        const stop = ingestor.stop();
        pending[2]?.deferred.resolve(ok({ status: 'tracked' }));
        await stop;
    });

    it('aborts expired processing, releases capacity, and does not retry the event', async () => {
        vi.useFakeTimers();
        try {
            const first = new Promise<Result<BotGrowthTrackingResult, 'database-error'>>(() => undefined);
            const process = vi
                .fn<
                    (
                        event: BotGrowthTelemetryEvent,
                        signal: AbortSignal
                    ) => Promise<Result<BotGrowthTrackingResult, 'database-error'>>
                >()
                .mockReturnValueOnce(first)
                .mockResolvedValueOnce(ok({ status: 'tracked' }));
            const logger = { warn: vi.fn() };
            const ingestor = createBotGrowthTelemetryIngestor({
                concurrency: 1,
                logger,
                process,
                processingDeadlineMs: 10,
            });

            ingestor.enqueue(createMessageEvent('message-1'));
            ingestor.enqueue(createMessageEvent('message-2'));
            await Promise.resolve();
            const firstSignal = process.mock.calls[0]?.[1];

            await vi.advanceTimersByTimeAsync(10);
            expect(firstSignal?.aborted).toBe(true);
            expect(process).toHaveBeenCalledTimes(2);
            expect(process.mock.calls[0]?.[0]).toMatchObject({ messageId: 'message-1' });
            expect(process.mock.calls[1]?.[0]).toMatchObject({ messageId: 'message-2' });
            expect(logger.warn).toHaveBeenCalledWith('bot.growth_tracking_failed', {
                error: 'processing-timeout',
                eventType: 'message.created',
                guildId: 'guild-1',
            });

            await ingestor.stop();
            expect(process).toHaveBeenCalledTimes(2);
        } finally {
            vi.useRealTimers();
        }
    });

    it('forces a bounded stop by clearing queued work before aborting active work with one redacted warning', async () => {
        vi.useFakeTimers();
        try {
            const process = vi.fn<
                (
                    event: BotGrowthTelemetryEvent,
                    signal: AbortSignal
                ) => Promise<Result<BotGrowthTrackingResult, 'database-error'>>
            >(() => new Promise<Result<BotGrowthTrackingResult, 'database-error'>>(() => undefined));
            const logger = { warn: vi.fn() };
            const ingestor = createBotGrowthTelemetryIngestor({
                concurrency: 1,
                logger,
                maxQueued: 2,
                process,
                stopDeadlineMs: 10,
            });

            ingestor.enqueue(createJoinEvent('private-guild', 'private-user-1'));
            ingestor.enqueue(createJoinEvent('private-guild', 'private-user-2'));
            await Promise.resolve();
            const activeSignal = process.mock.calls[0]?.[1];
            const stop = ingestor.stop();

            await vi.advanceTimersByTimeAsync(10);
            await stop;

            expect(activeSignal?.aborted).toBe(true);
            expect(process).toHaveBeenCalledOnce();
            expect(logger.warn).toHaveBeenCalledExactlyOnceWith('bot.growth_tracking_shutdown_forced', {
                activeCount: 1,
                eventTypeCounts: {
                    'member.joined': 2,
                    'member.left': 0,
                    'message.created': 0,
                },
                queuedDropCount: 1,
            });
            expect(JSON.stringify(logger.warn.mock.calls)).not.toContain('private-guild');
            expect(JSON.stringify(logger.warn.mock.calls)).not.toContain('private-user');
        } finally {
            vi.useRealTimers();
        }
    });
});

function createMessageEvent(messageId: string): BotGrowthTelemetryEvent {
    return {
        authorIsBot: false,
        guildId: 'guild-1',
        messageId,
        occurredAt: new Date('2026-07-14T01:02:03.000Z'),
        type: 'message.created',
    };
}

function createJoinEvent(guildId: string, userId: string): BotGrowthTelemetryEvent {
    return {
        guildId,
        membershipStartedAt: new Date('2026-07-14T01:02:03.000Z'),
        type: 'member.joined',
        userId,
    };
}

function createDeferred() {
    let resolve!: (value: Result<BotGrowthTrackingResult, 'database-error'>) => void;
    const promise = new Promise<Result<BotGrowthTrackingResult, 'database-error'>>((resolvePromise) => {
        resolve = resolvePromise;
    });
    return { promise, resolve };
}

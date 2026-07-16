import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { BotFeatureHandlerContext } from './bot-feature-types.js';
import { startDashboardPostingScheduler } from './bot-posting-scheduler.js';
import { runNextDashboardPostingOperation } from './bot-posting-worker.js';

vi.mock('./bot-posting-worker.js', () => ({ runNextDashboardPostingOperation: vi.fn() }));

describe('dashboard posting scheduler', () => {
    beforeEach(() => vi.clearAllMocks());

    it('stops the current drain after a claim/database failure', async () => {
        vi.mocked(runNextDashboardPostingOperation).mockResolvedValue({
            errorCode: 'database_error',
            operationId: 'unknown',
            status: 'deferred',
        });
        const scheduler = startDashboardPostingScheduler({
            context: createContext(),
            intervalMs: 60_000,
            logger: createLogger(),
        });

        await vi.waitFor(() => expect(runNextDashboardPostingOperation).toHaveBeenCalledTimes(1));
        await scheduler.stop();
    });

    it('logs only the error class when an unexpected worker failure escapes', async () => {
        const error = vi.fn();
        let observedSignal: AbortSignal | undefined;
        vi.mocked(runNextDashboardPostingOperation).mockImplementation((_context, options) => {
            observedSignal = options.signal;
            return Promise.reject(new Error('secret provider response'));
        });
        const scheduler = startDashboardPostingScheduler({
            context: createContext(),
            intervalMs: 60_000,
            logger: createLogger({ error }),
        });

        await vi.waitFor(() => expect(error).toHaveBeenCalled());
        expect(error).toHaveBeenCalledWith('posting.worker_failed', { errorType: 'Error' });
        await scheduler.stop();
        expect(observedSignal?.aborted).toBe(false);
    });

    it('wakes an idle scheduler immediately without waiting for the fallback interval', async () => {
        vi.mocked(runNextDashboardPostingOperation).mockResolvedValue({ status: 'idle' });
        const scheduler = startDashboardPostingScheduler({
            context: createContext(),
            intervalMs: 60_000,
            logger: createLogger(),
        });
        await vi.waitFor(() => expect(runNextDashboardPostingOperation).toHaveBeenCalledTimes(1));

        scheduler.wake();

        await vi.waitFor(() => expect(runNextDashboardPostingOperation).toHaveBeenCalledTimes(2));
        await scheduler.stop();
    });

    it('logs only redacted stage timings for successful posting operations', async () => {
        const info = vi.fn();
        vi.mocked(runNextDashboardPostingOperation)
            .mockResolvedValueOnce({
                attemptCount: 1,
                operationId: 'operation-1',
                status: 'sent',
                timings: {
                    claimMs: 2,
                    completionPersistenceMs: 3,
                    deliveryTotalMs: 38,
                    operationAgeMs: 41,
                    preflightMs: 4,
                    providerAcceptedAtMs: 1_752_400_000_038,
                    providerSendMs: 25,
                    queueWaitMs: 7,
                    receiptPersistenceMs: 1,
                    sendStartPersistenceMs: 2,
                    workerTotalMs: 41,
                },
            })
            .mockResolvedValue({ status: 'idle' });
        const scheduler = startDashboardPostingScheduler({
            context: createContext(),
            intervalMs: 60_000,
            logger: createLogger({ info }),
        });

        await vi.waitFor(() =>
            expect(info).toHaveBeenCalledWith(
                'posting.operation_timing',
                expect.objectContaining({ operationId: 'operation-1' })
            )
        );

        expect(info).toHaveBeenCalledWith('posting.operation_timing', {
            attemptCount: 1,
            claimMs: 2,
            completionPersistenceMs: 3,
            deliveryTotalMs: 38,
            operationAgeMs: 41,
            operationId: 'operation-1',
            outcome: 'sent',
            preflightMs: 4,
            providerAcceptedAtMs: 1_752_400_000_038,
            providerSendMs: 25,
            queueWaitMs: 7,
            receiptPersistenceMs: 1,
            sendStartPersistenceMs: 2,
            workerTotalMs: 41,
        });
        expect(JSON.stringify(info.mock.calls)).not.toContain('content');
        await scheduler.stop();
    });

    it('replays a wake received while a drain is still running', async () => {
        const firstRun = Promise.withResolvers<{ status: 'idle' }>();
        vi.mocked(runNextDashboardPostingOperation)
            .mockReturnValueOnce(firstRun.promise)
            .mockResolvedValue({ status: 'idle' });
        const scheduler = startDashboardPostingScheduler({
            context: createContext(),
            intervalMs: 60_000,
            logger: createLogger(),
        });
        await vi.waitFor(() => expect(runNextDashboardPostingOperation).toHaveBeenCalledTimes(1));

        scheduler.wake();
        firstRun.resolve({ status: 'idle' });

        await vi.waitFor(() => expect(runNextDashboardPostingOperation).toHaveBeenCalledTimes(2));
        await scheduler.stop();
    });

    it('ignores wake requests after shutdown', async () => {
        vi.mocked(runNextDashboardPostingOperation).mockResolvedValue({ status: 'idle' });
        const scheduler = startDashboardPostingScheduler({
            context: createContext(),
            intervalMs: 60_000,
            logger: createLogger(),
        });
        await vi.waitFor(() => expect(runNextDashboardPostingOperation).toHaveBeenCalledTimes(1));
        await scheduler.stop();

        scheduler.wake();
        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(runNextDashboardPostingOperation).toHaveBeenCalledTimes(1);
    });

    it('aborts an overdue item and stops the current drain', async () => {
        const error = vi.fn();
        let observedSignal: AbortSignal | undefined;
        vi.mocked(runNextDashboardPostingOperation).mockImplementation((_context, options) => {
            observedSignal = options.signal;
            return new Promise((resolve) => {
                options.signal?.addEventListener(
                    'abort',
                    () => resolve({ errorCode: 'worker_aborted', operationId: 'unknown', status: 'deferred' }),
                    { once: true }
                );
            });
        });
        const scheduler = startDashboardPostingScheduler({
            context: createContext(),
            intervalMs: 60_000,
            itemDeadlineMs: 5,
            logger: createLogger({ error }),
        });

        await vi.waitFor(() =>
            expect(error).toHaveBeenCalledWith('posting.worker_deadline_exceeded', { stage: 'operation' })
        );
        expect(observedSignal?.aborted).toBe(true);
        expect(runNextDashboardPostingOperation).toHaveBeenCalledTimes(1);
        await scheduler.stop();
    });

    it('observes a late rejection after the deadline without an unhandled rejection', async () => {
        const unhandled = vi.fn();
        process.on('unhandledRejection', unhandled);
        let rejectLate: ((error: Error) => void) | undefined;
        vi.mocked(runNextDashboardPostingOperation).mockImplementation(
            () =>
                new Promise((_resolve, reject) => {
                    rejectLate = reject;
                })
        );
        const scheduler = startDashboardPostingScheduler({
            context: createContext(),
            intervalMs: 60_000,
            itemDeadlineMs: 5,
            logger: createLogger(),
        });

        await vi.waitFor(() => expect(rejectLate).toBeTypeOf('function'));
        await new Promise((resolve) => setTimeout(resolve, 10));
        rejectLate?.(new Error('late provider secret'));
        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(unhandled).not.toHaveBeenCalled();
        process.off('unhandledRejection', unhandled);
        await scheduler.stop();
    });

    it('aborts active work and returns from stop without waiting for an uncooperative continuation', async () => {
        let observedSignal: AbortSignal | undefined;
        vi.mocked(runNextDashboardPostingOperation).mockImplementation((_context, options) => {
            observedSignal = options.signal;
            return new Promise(() => undefined);
        });
        const scheduler = startDashboardPostingScheduler({
            context: createContext(),
            intervalMs: 60_000,
            itemDeadlineMs: 60_000,
            logger: createLogger(),
            shutdownGraceMs: 5,
        });
        await vi.waitFor(() => expect(observedSignal).toBeDefined());

        await expect(
            Promise.race([
                scheduler.stop().then(() => 'stopped'),
                new Promise<string>((resolve) => setTimeout(() => resolve('hung'), 100)),
            ])
        ).resolves.toBe('stopped');
        expect(observedSignal?.aborted).toBe(true);
    });

    it('continuously drains more than one slice while yielding to the event loop', async () => {
        const info = vi.fn();
        let completed = 0;
        vi.mocked(runNextDashboardPostingOperation).mockImplementation(() => {
            if (completed >= 45) return Promise.resolve({ status: 'idle' });
            completed += 1;
            return Promise.resolve(successfulResult(`operation-${String(completed)}`));
        });
        const scheduler = startDashboardPostingScheduler({
            context: createContext(),
            intervalMs: 60_000,
            logger: createLogger({ info }),
        });
        const callsAtFirstYield = await new Promise<number>((resolve) => {
            setImmediate(() => resolve(vi.mocked(runNextDashboardPostingOperation).mock.calls.length));
        });

        await vi.waitFor(() => expect(runNextDashboardPostingOperation).toHaveBeenCalledTimes(46));

        expect(callsAtFirstYield).toBe(20);
        expect(info).toHaveBeenCalledWith(
            'posting.drain_cycle',
            expect.objectContaining({ claimed: 45, sent: 45, slices: 3, stopReason: 'idle', trigger: 'startup' })
        );
        await scheduler.stop();
    });

    it('coalesces repeated wakes during one active drain into one race-closing replay', async () => {
        const firstRun = Promise.withResolvers<ReturnType<typeof successfulResult>>();
        vi.mocked(runNextDashboardPostingOperation)
            .mockReturnValueOnce(firstRun.promise)
            .mockResolvedValue({ status: 'idle' });
        const scheduler = startDashboardPostingScheduler({
            context: createContext(),
            intervalMs: 60_000,
            logger: createLogger(),
        });
        await vi.waitFor(() => expect(runNextDashboardPostingOperation).toHaveBeenCalledTimes(1));

        scheduler.wake();
        scheduler.wake();
        scheduler.wake();
        firstRun.resolve(successfulResult('operation-1'));

        await vi.waitFor(() => expect(runNextDashboardPostingOperation).toHaveBeenCalledTimes(3));
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(runNextDashboardPostingOperation).toHaveBeenCalledTimes(3);
        await scheduler.stop();
    });
});

function successfulResult(operationId: string) {
    return {
        attemptCount: 1,
        operationId,
        status: 'sent' as const,
        timings: {
            claimMs: 1,
            operationAgeMs: 3,
            queueWaitMs: 1,
            workerTotalMs: 2,
        },
    };
}

function createLogger(overrides: { error?: ReturnType<typeof vi.fn>; info?: ReturnType<typeof vi.fn> } = {}) {
    return {
        debug: vi.fn(),
        error: overrides.error ?? vi.fn(),
        info: overrides.info ?? vi.fn(),
        warn: vi.fn(),
    } as never;
}

function createContext(): BotFeatureHandlerContext {
    return {
        appEnv: 'production',
        client: {} as BotFeatureHandlerContext['client'],
        db: {} as BotFeatureHandlerContext['db'],
        guildDefconOverride: 'auto',
        logger: { warn: vi.fn() },
        mode: { instanceMode: 'multi' },
    };
}

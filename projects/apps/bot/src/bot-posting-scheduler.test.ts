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
            logger: { error: vi.fn() } as never,
        });

        await vi.waitFor(() => expect(runNextDashboardPostingOperation).toHaveBeenCalledTimes(1));
        await scheduler.stop();
    });

    it('logs only the error class when an unexpected worker failure escapes', async () => {
        const error = vi.fn();
        vi.mocked(runNextDashboardPostingOperation).mockRejectedValue(new Error('secret provider response'));
        const scheduler = startDashboardPostingScheduler({
            context: createContext(),
            intervalMs: 60_000,
            logger: { error } as never,
        });

        await vi.waitFor(() => expect(error).toHaveBeenCalled());
        expect(error).toHaveBeenCalledWith('posting.worker_failed', { errorType: 'Error' });
        await scheduler.stop();
    });

    it('wakes an idle scheduler immediately without waiting for the fallback interval', async () => {
        vi.mocked(runNextDashboardPostingOperation).mockResolvedValue({ status: 'idle' });
        const scheduler = startDashboardPostingScheduler({
            context: createContext(),
            intervalMs: 60_000,
            logger: { error: vi.fn() } as never,
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
                operationId: 'operation-1',
                status: 'sent',
                timings: { preflightMs: 4, providerSendMs: 25, queueWaitMs: 7, totalMs: 41 },
            })
            .mockResolvedValue({ status: 'idle' });
        const scheduler = startDashboardPostingScheduler({
            context: createContext(),
            intervalMs: 60_000,
            logger: { error: vi.fn(), info } as never,
        });

        await vi.waitFor(() => expect(info).toHaveBeenCalledTimes(1));

        expect(info).toHaveBeenCalledWith('posting.operation_timing', {
            operationId: 'operation-1',
            preflightMs: 4,
            providerSendMs: 25,
            queueWaitMs: 7,
            totalMs: 41,
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
            logger: { error: vi.fn() } as never,
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
            logger: { error: vi.fn() } as never,
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
            logger: { error } as never,
        });

        await vi.waitFor(() => expect(error).toHaveBeenCalledWith('posting.worker_deadline_exceeded', {}));
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
            logger: { error: vi.fn() } as never,
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
            logger: { error: vi.fn() } as never,
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
});

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

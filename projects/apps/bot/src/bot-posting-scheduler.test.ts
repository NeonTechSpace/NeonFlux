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

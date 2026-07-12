import { afterEach, describe, expect, it, vi } from 'vitest';

import { fetchDashboardConvexToken } from './dashboard-live-invalidation.js';

afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
});

describe('dashboard live invalidation', () => {
    it('aborts a token request that exceeds its browser deadline', async () => {
        vi.useFakeTimers();
        const fetch = vi.fn(
            (_input: URL | RequestInfo, init?: RequestInit) =>
                new Promise<Response>((_resolve, reject) => {
                    init?.signal?.addEventListener(
                        'abort',
                        () => {
                            const reason: unknown = init.signal?.reason;
                            reject(reason instanceof Error ? reason : new Error('Token request aborted.'));
                        },
                        { once: true }
                    );
                })
        );
        vi.stubGlobal('fetch', fetch);

        const request = fetchDashboardConvexToken().catch((error: unknown) => error);
        expect(fetch).toHaveBeenCalledOnce();

        await vi.advanceTimersByTimeAsync(60_000);
        const error = await request;

        expect(error).toMatchObject({ name: 'TimeoutError' });
        expect(fetch.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
    });
});

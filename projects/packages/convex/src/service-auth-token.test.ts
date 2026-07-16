import { signNeonFluxServiceJwt } from './jwt.js';
import {
    createNeonFluxServiceAuthTokenProvider,
    NeonFluxServiceAuthTokenRefreshError,
    type NeonFluxServiceAuthTokenProviderConfig,
} from './service-auth-token.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./jwt.js', () => ({ signNeonFluxServiceJwt: vi.fn() }));

describe('NeonFlux service authentication token provider', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-07-16T08:00:00.000Z'));
        vi.mocked(signNeonFluxServiceJwt).mockReset();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('reuses a token before the refresh threshold and refreshes at the threshold', async () => {
        vi.mocked(signNeonFluxServiceJwt).mockResolvedValueOnce('token-1').mockResolvedValueOnce('token-2');
        const provider = createNeonFluxServiceAuthTokenProvider(createConfig());

        await expect(provider()).resolves.toBe('token-1');
        vi.advanceTimersByTime(49_999);
        await expect(provider()).resolves.toBe('token-1');
        expect(signNeonFluxServiceJwt).toHaveBeenCalledOnce();

        vi.advanceTimersByTime(1);
        await expect(provider()).resolves.toBe('token-2');
        expect(signNeonFluxServiceJwt).toHaveBeenCalledTimes(2);
        expect(signNeonFluxServiceJwt).toHaveBeenLastCalledWith(
            {
                audience: 'neonflux-capability-v1',
                issuer: 'https://neonflux.example/web',
                privateKeyPem: 'PRIVATE-KEY',
            },
            {
                expiresInSeconds: 60,
                now: new Date('2026-07-16T08:00:50.000Z'),
                serviceName: 'web',
            }
        );
    });

    it('single-flights concurrent signing for one provider', async () => {
        const completion = Promise.withResolvers<string>();
        vi.mocked(signNeonFluxServiceJwt).mockReturnValueOnce(completion.promise);
        const provider = createNeonFluxServiceAuthTokenProvider(createConfig());

        const first = provider();
        const second = provider();
        const third = provider();

        expect(second).toBe(first);
        expect(third).toBe(first);
        expect(signNeonFluxServiceJwt).toHaveBeenCalledOnce();

        completion.resolve('shared-token');
        await expect(Promise.all([first, second, third])).resolves.toEqual([
            'shared-token',
            'shared-token',
            'shared-token',
        ]);
    });

    it('caches a sanitized signing failure until the retry delay and then recovers', async () => {
        const sensitiveError = new Error('failed to parse TOP-SECRET-PRIVATE-KEY');
        vi.mocked(signNeonFluxServiceJwt).mockRejectedValueOnce(sensitiveError).mockResolvedValueOnce('recovered');
        const provider = createNeonFluxServiceAuthTokenProvider(createConfig());

        const first = await provider().catch((error: unknown) => error);
        const suppressed = await provider().catch((error: unknown) => error);

        expect(first).toBeInstanceOf(NeonFluxServiceAuthTokenRefreshError);
        expect(suppressed).toBe(first);
        expect(String(first)).not.toContain('TOP-SECRET-PRIVATE-KEY');
        expect(signNeonFluxServiceJwt).toHaveBeenCalledOnce();

        vi.advanceTimersByTime(4_999);
        await expect(provider()).rejects.toBe(first);
        vi.advanceTimersByTime(1);
        await expect(provider()).resolves.toBe('recovered');
        expect(signNeonFluxServiceJwt).toHaveBeenCalledTimes(2);
    });

    it('rejects a signing result that settles after its refresh threshold', async () => {
        const completion = Promise.withResolvers<string>();
        vi.mocked(signNeonFluxServiceJwt).mockReturnValueOnce(completion.promise);
        const provider = createNeonFluxServiceAuthTokenProvider(createConfig());
        const token = provider();

        vi.advanceTimersByTime(50_000);
        completion.resolve('already-stale');

        await expect(token).rejects.toBeInstanceOf(NeonFluxServiceAuthTokenRefreshError);
        await expect(provider()).rejects.toBeInstanceOf(NeonFluxServiceAuthTokenRefreshError);
    });
});

function createConfig(
    overrides: Partial<NeonFluxServiceAuthTokenProviderConfig> = {}
): NeonFluxServiceAuthTokenProviderConfig {
    return {
        audience: 'neonflux-capability-v1',
        expiresInSeconds: 60,
        issuer: 'https://neonflux.example/web',
        privateKey: 'PRIVATE-KEY',
        refreshSkewSeconds: 10,
        serviceName: 'web',
        signingRetryDelayMs: 5_000,
        ...overrides,
    };
}

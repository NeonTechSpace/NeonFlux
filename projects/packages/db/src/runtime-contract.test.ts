import { createNeonFluxConvexHttpClient } from '@neonflux/convex/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ConvexServiceDbClient } from './convex.js';
import {
    assertConvexRuntimeContract,
    CONVEX_RUNTIME_CONTRACT_TIMEOUT_MS,
    ConvexRuntimeContractError,
    BLUEPRINT_RUN_PROTOCOL_VERSION,
} from './runtime-contract.js';

afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
});

describe('Convex runtime contract', () => {
    it('accepts the exact deployed run protocol', async () => {
        const client = createClient({
            blueprintRunProtocolVersion: BLUEPRINT_RUN_PROTOCOL_VERSION,
        });

        await expect(assertConvexRuntimeContract(client)).resolves.toBeUndefined();
    });

    it('fails closed when the deployed contract function is unavailable', async () => {
        const client = createClient(new Error('function not found'));

        const error = await assertConvexRuntimeContract(client).catch((cause: unknown) => cause);

        expect(error).toBeInstanceOf(ConvexRuntimeContractError);
        expect(error).toMatchObject({ reason: 'unavailable' });
    });

    it('fails closed when consumers and Convex use different run protocols', async () => {
        const client = createClient({ blueprintRunProtocolVersion: 999 });

        const error = await assertConvexRuntimeContract(client).catch((cause: unknown) => cause);

        expect(error).toBeInstanceOf(ConvexRuntimeContractError);
        expect(error).toMatchObject({ reason: 'version-mismatch' });
    });

    it('times out even when service-token acquisition never resolves', async () => {
        vi.useFakeTimers();
        const fetch = vi.fn();
        vi.stubGlobal('fetch', fetch);
        const client = {
            client: createNeonFluxConvexHttpClient({
                authTokenProvider: () => new Promise<string>(() => undefined),
                url: 'https://neonflux-test.convex.cloud',
            }),
        } as unknown as ConvexServiceDbClient;

        const check = assertConvexRuntimeContract(client).catch((error: unknown) => error);
        await vi.advanceTimersByTimeAsync(CONVEX_RUNTIME_CONTRACT_TIMEOUT_MS);
        const error = await check;

        expect(error).toBeInstanceOf(ConvexRuntimeContractError);
        expect(error).toMatchObject({ reason: 'unavailable' });
        expect(fetch).not.toHaveBeenCalled();
    });
});

function createClient(result: Error | { blueprintRunProtocolVersion: number }): ConvexServiceDbClient {
    return {
        client: {
            query: result instanceof Error ? vi.fn().mockRejectedValue(result) : vi.fn().mockResolvedValue(result),
        },
    } as unknown as ConvexServiceDbClient;
}

import { getFunctionName } from 'convex/server';
import { convexToJson } from 'convex/values';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { api } from './api.js';
import { createNeonFluxConvexHttpClient } from './client.js';

const convexApi = api as unknown as {
    core: {
        readDeploymentConfig: Parameters<ReturnType<typeof createNeonFluxConvexHttpClient>['query']>[0];
        upsertDeploymentConfig: Parameters<ReturnType<typeof createNeonFluxConvexHttpClient>['mutation']>[0];
    };
};

describe('createNeonFluxConvexHttpClient', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('queries Convex through the raw HTTP API with bearer auth and encoded args', async () => {
        const fetch = stubFetch(
            new Response(
                JSON.stringify({
                    status: 'success',
                    value: {
                        instanceMode: 'multi',
                        ownerIds: [],
                        publicWebUrl: null,
                    },
                })
            )
        );
        const client = createNeonFluxConvexHttpClient({
            authToken: 'service-jwt',
            url: 'https://neonflux-test.convex.cloud',
        });

        await expect(client.query(convexApi.core.readDeploymentConfig, {})).resolves.toStrictEqual({
            instanceMode: 'multi',
            ownerIds: [],
            publicWebUrl: null,
        });
        expect(fetch).toHaveBeenCalledWith(new URL('https://neonflux-test.convex.cloud/api/query'), {
            body: JSON.stringify({
                args: [convexToJson({})],
                format: 'convex_encoded_json',
                path: getFunctionName(convexApi.core.readDeploymentConfig),
            }),
            headers: {
                Authorization: 'Bearer service-jwt',
                'Content-Type': 'application/json',
                'Convex-Client': 'neonflux-runtime-server',
            },
            method: 'POST',
        });
    });

    it('surfaces Convex error payloads from mutations', async () => {
        stubFetch(
            new Response(
                JSON.stringify({
                    errorMessage: 'missing-guild-id',
                    status: 'error',
                }),
                { status: 560 }
            )
        );
        const client = createNeonFluxConvexHttpClient({
            authToken: 'service-jwt',
            url: 'https://neonflux-test.convex.cloud',
        });

        await expect(
            client.mutation(convexApi.core.upsertDeploymentConfig, {
                instanceMode: 'single',
                singleGuildId: '',
            })
        ).rejects.toThrow(
            `Convex mutation ${getFunctionName(convexApi.core.upsertDeploymentConfig)} failed: missing-guild-id`
        );
    });

    it('surfaces HTTP status and response body when the target rejects a request', async () => {
        stubFetch(new Response('NoAuthProvider', { status: 401 }));
        const client = createNeonFluxConvexHttpClient({
            authToken: 'service-jwt',
            url: 'https://neonflux-test.convex.cloud',
        });

        await expect(client.query(convexApi.core.readDeploymentConfig, {})).rejects.toThrow(
            `Convex query ${getFunctionName(convexApi.core.readDeploymentConfig)} returned HTTP 401: NoAuthProvider`
        );
    });
});

function stubFetch(response: Response) {
    const fetch = vi.fn(() => Promise.resolve(response));

    vi.stubGlobal('fetch', fetch);

    return fetch;
}

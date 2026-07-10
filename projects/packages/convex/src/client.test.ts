import { getFunctionName } from 'convex/server';
import { convexToJson } from 'convex/values';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { api } from '@neonflux/convex-api';
import { createNeonFluxConvexHttpClient } from './client.js';

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
            authTokenProvider: () => Promise.resolve('service-jwt'),
            url: 'https://neonflux-test.convex.cloud',
        });

        await expect(client.query(api.core.readDeploymentConfig, {})).resolves.toStrictEqual({
            instanceMode: 'multi',
            ownerIds: [],
            publicWebUrl: null,
        });
        expect(fetch).toHaveBeenCalledWith(new URL('https://neonflux-test.convex.cloud/api/query'), {
            body: JSON.stringify({
                args: [convexToJson({})],
                format: 'convex_encoded_json',
                path: getFunctionName(api.core.readDeploymentConfig),
            }),
            headers: {
                Authorization: 'Bearer service-jwt',
                'Content-Type': 'application/json',
                'Convex-Client': 'neonflux-runtime-server',
            },
            method: 'POST',
        });
    });

    it('resolves bearer authentication at request time', async () => {
        const authorizationHeaders: Array<string | null> = [];
        const fetch = vi.fn((_input: URL | RequestInfo, init?: RequestInit) => {
            authorizationHeaders.push(new Headers(init?.headers).get('Authorization'));

            return Promise.resolve(
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
        });
        let authToken = 'service-jwt-1';
        const authTokenProvider = vi.fn(() => Promise.resolve(authToken));
        const client = createNeonFluxConvexHttpClient({
            authTokenProvider,
            url: 'https://neonflux-test.convex.cloud',
        });

        vi.stubGlobal('fetch', fetch);

        await client.query(api.core.readDeploymentConfig, {});
        authToken = 'service-jwt-2';
        await client.query(api.core.readDeploymentConfig, {});

        expect(authTokenProvider).toHaveBeenCalledTimes(2);
        expect(authorizationHeaders).toStrictEqual(['Bearer service-jwt-1', 'Bearer service-jwt-2']);
    });

    it('does not send a Convex request when the token provider fails', async () => {
        const fetch = vi.fn();
        const authFailure = new Error('service authentication unavailable');
        const client = createNeonFluxConvexHttpClient({
            authTokenProvider: () => Promise.reject(authFailure),
            url: 'https://neonflux-test.convex.cloud',
        });

        vi.stubGlobal('fetch', fetch);

        await expect(client.query(api.core.readDeploymentConfig, {})).rejects.toBe(authFailure);
        expect(fetch).not.toHaveBeenCalled();
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
            authTokenProvider: () => Promise.resolve('service-jwt'),
            url: 'https://neonflux-test.convex.cloud',
        });

        await expect(
            client.mutation(api.core.upsertDeploymentConfig, {
                instanceMode: 'single',
                singleGuildId: '',
            })
        ).rejects.toThrow(
            `Convex mutation ${getFunctionName(api.core.upsertDeploymentConfig)} failed: missing-guild-id`
        );
    });

    it('surfaces HTTP status without exposing a rejected response body', async () => {
        stubFetch(new Response('private proxy response', { status: 401 }));
        const client = createNeonFluxConvexHttpClient({
            authTokenProvider: () => Promise.resolve('service-jwt'),
            url: 'https://neonflux-test.convex.cloud',
        });

        await expect(client.query(api.core.readDeploymentConfig, {})).rejects.toThrow(
            `Convex query ${getFunctionName(api.core.readDeploymentConfig)} returned HTTP 401.`
        );
    });

    it('does not expose arbitrary Convex error text', async () => {
        stubFetch(
            new Response(JSON.stringify({ errorMessage: 'private record contents: secret', status: 'error' }), {
                status: 560,
            })
        );
        const client = createNeonFluxConvexHttpClient({
            authTokenProvider: () => Promise.resolve('service-jwt'),
            url: 'https://neonflux-test.convex.cloud',
        });

        await expect(client.query(api.core.readDeploymentConfig, {})).rejects.toThrow(
            `Convex query ${getFunctionName(api.core.readDeploymentConfig)} failed: unknown-error.`
        );
    });
});

function stubFetch(response: Response) {
    const fetch = vi.fn(() => Promise.resolve(response));

    vi.stubGlobal('fetch', fetch);

    return fetch;
}

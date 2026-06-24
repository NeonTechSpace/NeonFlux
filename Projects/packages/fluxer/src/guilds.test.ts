import { describe, expect, it } from 'vitest';

import { listFluxerCurrentUserGuilds, type FluxerGuildsFetch } from './guilds.js';

describe('listFluxerCurrentUserGuilds', () => {
    it('fetches current user guilds with the access token as a bearer token', async () => {
        let capturedInput: string | URL | undefined;
        let capturedInit: RequestInit | undefined;
        const testFetch: FluxerGuildsFetch = (input, init) => {
            capturedInput = input;
            capturedInit = init;

            return Promise.resolve(createGuildsResponse());
        };

        const result = await listFluxerCurrentUserGuilds({
            accessToken: ' access-token ',
            fetch: testFetch,
        });

        expect(result.isOk()).toBe(true);
        expect(capturedInput).toBe('https://api.fluxer.app/v1/users/@me/guilds');
        expect(capturedInit?.method).toBe('GET');
        expect(capturedInit?.headers).toStrictEqual({
            Authorization: 'Bearer access-token',
        });
    });

    it('includes supported query parameters when provided', async () => {
        let capturedInput: string | URL | undefined;
        const testFetch: FluxerGuildsFetch = (input) => {
            capturedInput = input;

            return Promise.resolve(createGuildsResponse());
        };

        const result = await listFluxerCurrentUserGuilds({
            accessToken: 'access-token',
            before: ' before-guild ',
            after: ' after-guild ',
            limit: 200,
            withCounts: true,
            fetch: testFetch,
        });

        expect(result.isOk()).toBe(true);
        expect(capturedInput).toBe(
            'https://api.fluxer.app/v1/users/@me/guilds?before=before-guild&after=after-guild&limit=200&with_counts=true'
        );
    });

    it('normalizes the current user guild response', async () => {
        const result = await listFluxerCurrentUserGuilds({
            accessToken: 'access-token',
            fetch: () =>
                Promise.resolve(
                    createGuildsResponse([
                        {
                            id: 'guild-1',
                            name: 'NeonFlux Lab',
                            permissions: '32',
                            icon: ' guild-icon-hash ',
                        },
                        {
                            id: 'guild-2',
                            name: 'NeonFlux Production',
                            permissions: '8',
                            owner_id: ' owner-user ',
                        },
                    ])
                ),
        });

        expect(result.isOk()).toBe(true);
        expect(result._unsafeUnwrap()).toStrictEqual([
            {
                id: 'guild-1',
                name: 'NeonFlux Lab',
                permissions: '32',
                iconHash: 'guild-icon-hash',
            },
            {
                id: 'guild-2',
                name: 'NeonFlux Production',
                permissions: '8',
                ownerId: 'owner-user',
            },
        ]);
    });

    it('fails when access token is missing', async () => {
        const result = await listFluxerCurrentUserGuilds({
            accessToken: ' ',
            fetch: createUnusedFetch(),
        });

        expect(result.isErr()).toBe(true);
        expect(result._unsafeUnwrapErr()).toStrictEqual({ type: 'missing-input', field: 'accessToken' });
    });

    it('fails when before is empty', async () => {
        const result = await listFluxerCurrentUserGuilds({
            accessToken: 'access-token',
            before: ' ',
            fetch: createUnusedFetch(),
        });

        expect(result.isErr()).toBe(true);
        expect(result._unsafeUnwrapErr()).toStrictEqual({ type: 'invalid-input', field: 'before' });
    });

    it('fails when after is empty', async () => {
        const result = await listFluxerCurrentUserGuilds({
            accessToken: 'access-token',
            after: ' ',
            fetch: createUnusedFetch(),
        });

        expect(result.isErr()).toBe(true);
        expect(result._unsafeUnwrapErr()).toStrictEqual({ type: 'invalid-input', field: 'after' });
    });

    it('fails when limit is outside the Fluxer API range', async () => {
        const invalidLimits = [0, 201, 1.5];

        for (const limit of invalidLimits) {
            const result = await listFluxerCurrentUserGuilds({
                accessToken: 'access-token',
                limit,
                fetch: createUnusedFetch(),
            });

            expect(result.isErr()).toBe(true);
            expect(result._unsafeUnwrapErr()).toStrictEqual({ type: 'invalid-input', field: 'limit' });
        }
    });

    it('returns request-failed for non-2xx responses', async () => {
        const result = await listFluxerCurrentUserGuilds({
            accessToken: 'access-token',
            fetch: () =>
                Promise.resolve(
                    createJsonResponse({ error: 'unauthorized' }, { status: 401, statusText: 'Unauthorized' })
                ),
        });

        expect(result.isErr()).toBe(true);
        expect(result._unsafeUnwrapErr()).toStrictEqual({
            type: 'request-failed',
            status: 401,
            statusText: 'Unauthorized',
        });
    });

    it('returns network-error when the request fails before receiving a response', async () => {
        const networkError = new Error('network unavailable');
        const result = await listFluxerCurrentUserGuilds({
            accessToken: 'access-token',
            fetch: () => Promise.reject(networkError),
        });

        expect(result.isErr()).toBe(true);
        expect(result._unsafeUnwrapErr()).toStrictEqual({ type: 'network-error', error: networkError });
    });

    it('returns invalid-response for invalid JSON responses', async () => {
        const result = await listFluxerCurrentUserGuilds({
            accessToken: 'access-token',
            fetch: () => Promise.resolve(new Response('not-json')),
        });

        expect(result.isErr()).toBe(true);
        expect(result._unsafeUnwrapErr()).toStrictEqual({ type: 'invalid-response' });
    });

    it('returns invalid-response for non-array responses', async () => {
        const result = await listFluxerCurrentUserGuilds({
            accessToken: 'access-token',
            fetch: () => Promise.resolve(createJsonResponse({ id: 'guild-1' })),
        });

        expect(result.isErr()).toBe(true);
        expect(result._unsafeUnwrapErr()).toStrictEqual({ type: 'invalid-response' });
    });

    it('returns invalid-response for missing guild fields', async () => {
        const result = await listFluxerCurrentUserGuilds({
            accessToken: 'access-token',
            fetch: () =>
                Promise.resolve(
                    createGuildsResponse([
                        {
                            id: 'guild-1',
                            name: 'NeonFlux Lab',
                        },
                    ])
                ),
        });

        expect(result.isErr()).toBe(true);
        expect(result._unsafeUnwrapErr()).toStrictEqual({ type: 'invalid-response' });
    });
});

function createGuildsResponse(guilds: unknown = [createGuild()]): Response {
    return createJsonResponse(guilds);
}

function createGuild(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        id: 'guild-1',
        name: 'NeonFlux Lab',
        permissions: '32',
        ...overrides,
    };
}

function createJsonResponse(body: unknown, init?: ResponseInit): Response {
    return new Response(JSON.stringify(body), {
        headers: {
            'Content-Type': 'application/json',
        },
        ...init,
    });
}

function createUnusedFetch(): FluxerGuildsFetch {
    return () => Promise.reject(new Error('Fetch should not be called.'));
}

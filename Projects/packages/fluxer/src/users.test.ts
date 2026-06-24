import { describe, expect, it } from 'vitest';

import { getFluxerCurrentUser, type FluxerUsersFetch } from './users.js';

describe('getFluxerCurrentUser', () => {
    it('fetches the current user with the access token as a bearer token', async () => {
        let capturedInput: string | URL | undefined;
        let capturedInit: RequestInit | undefined;
        const testFetch: FluxerUsersFetch = (input, init) => {
            capturedInput = input;
            capturedInit = init;

            return Promise.resolve(createUserResponse());
        };

        const result = await getFluxerCurrentUser({
            accessToken: ' access-token ',
            fetch: testFetch,
        });

        expect(result.isOk()).toBe(true);
        expect(capturedInput).toBe('https://api.fluxer.app/v1/oauth2/userinfo');
        expect(capturedInit?.method).toBe('GET');
        expect(capturedInit?.headers).toStrictEqual({
            Authorization: 'Bearer access-token',
        });
    });

    it('normalizes the current user response', async () => {
        const result = await getFluxerCurrentUser({
            accessToken: 'access-token',
            fetch: () =>
                Promise.resolve(
                    createUserResponse({
                        id: '1517169145576165376',
                        sub: '1517169145576165376',
                        username: 'neonsy',
                        discriminator: '0001',
                        global_name: 'Neonsy',
                        avatar: 'avatar-hash',
                        bot: false,
                        system: false,
                    })
                ),
        });

        expect(result.isOk()).toBe(true);
        expect(result._unsafeUnwrap()).toStrictEqual({
            id: '1517169145576165376',
            subjectId: '1517169145576165376',
            username: 'neonsy',
            discriminator: '0001',
            globalName: 'Neonsy',
            avatar: 'avatar-hash',
            bot: false,
            system: false,
        });
    });

    it('accepts missing optional OAuth userinfo fields', async () => {
        const result = await getFluxerCurrentUser({
            accessToken: 'access-token',
            fetch: () =>
                Promise.resolve(
                    createUserResponse({
                        sub: undefined,
                        global_name: undefined,
                        avatar: undefined,
                        bot: undefined,
                        system: undefined,
                    })
                ),
        });

        expect(result.isOk()).toBe(true);
        expect(result._unsafeUnwrap()).toStrictEqual({
            id: '1517169145576165376',
            username: 'neonsy',
            discriminator: '0001',
            globalName: null,
            avatar: null,
        });
    });

    it('accepts nullable global name and avatar fields', async () => {
        const result = await getFluxerCurrentUser({
            accessToken: 'access-token',
            fetch: () =>
                Promise.resolve(
                    createUserResponse({
                        global_name: null,
                        avatar: null,
                    })
                ),
        });

        expect(result.isOk()).toBe(true);
        expect(result._unsafeUnwrap()).toMatchObject({
            globalName: null,
            avatar: null,
        });
    });

    it('fails when access token is missing', async () => {
        const result = await getFluxerCurrentUser({
            accessToken: ' ',
            fetch: createUnusedFetch(),
        });

        expect(result.isErr()).toBe(true);
        expect(result._unsafeUnwrapErr()).toStrictEqual({ type: 'missing-input', field: 'accessToken' });
    });

    it('returns request-failed for non-2xx responses', async () => {
        const result = await getFluxerCurrentUser({
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
        const result = await getFluxerCurrentUser({
            accessToken: 'access-token',
            fetch: () => Promise.reject(networkError),
        });

        expect(result.isErr()).toBe(true);
        expect(result._unsafeUnwrapErr()).toStrictEqual({ type: 'network-error', error: networkError });
    });

    it('returns invalid-response for invalid JSON responses', async () => {
        const result = await getFluxerCurrentUser({
            accessToken: 'access-token',
            fetch: () => Promise.resolve(new Response('not-json')),
        });

        expect(result.isErr()).toBe(true);
        expect(result._unsafeUnwrapErr()).toStrictEqual({ type: 'invalid-response' });
    });

    it('returns invalid-response for missing identity fields', async () => {
        const result = await getFluxerCurrentUser({
            accessToken: 'access-token',
            fetch: () =>
                Promise.resolve(
                    createUserResponse({
                        discriminator: undefined,
                    })
                ),
        });

        expect(result.isErr()).toBe(true);
        expect(result._unsafeUnwrapErr()).toStrictEqual({ type: 'invalid-response' });
    });

    it('returns invalid-response for malformed optional OAuth userinfo fields', async () => {
        const result = await getFluxerCurrentUser({
            accessToken: 'access-token',
            fetch: () =>
                Promise.resolve(
                    createUserResponse({
                        global_name: 123,
                    })
                ),
        });

        expect(result.isErr()).toBe(true);
        expect(result._unsafeUnwrapErr()).toStrictEqual({ type: 'invalid-response' });
    });
});

function createUserResponse(overrides: Record<string, unknown> = {}): Response {
    return createJsonResponse({
        id: '1517169145576165376',
        sub: '1517169145576165376',
        username: 'neonsy',
        discriminator: '0001',
        global_name: 'Neonsy',
        avatar: 'avatar-hash',
        bot: false,
        system: false,
        ...overrides,
    });
}

function createJsonResponse(body: unknown, init?: ResponseInit): Response {
    return new Response(JSON.stringify(body), {
        headers: {
            'Content-Type': 'application/json',
        },
        ...init,
    });
}

function createUnusedFetch(): FluxerUsersFetch {
    return () => Promise.reject(new Error('Fetch should not be called.'));
}

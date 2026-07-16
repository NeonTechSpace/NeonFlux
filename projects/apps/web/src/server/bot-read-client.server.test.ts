import { loadWebConfig } from '@neonflux/config';
import type { WebConfig } from '@neonflux/config';
import { signNeonFluxServiceJwt } from '@neonflux/convex/jwt';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { readDashboardBotGuildStructure, wakeDashboardBotPostingWorker } from './bot-read-client.server.js';

vi.mock('@neonflux/config', () => ({ loadWebConfig: vi.fn() }));
vi.mock('@neonflux/convex/jwt', () => ({ signNeonFluxServiceJwt: vi.fn() }));

describe('dashboard bot read client', () => {
    beforeEach(() => {
        vi.mocked(loadWebConfig).mockReturnValue(createConfig());
        vi.mocked(signNeonFluxServiceJwt).mockResolvedValue('short-lived-service-token');
        vi.stubGlobal('fetch', vi.fn());
    });

    it('authenticates the internal request and strictly returns the normalized structure', async () => {
        vi.mocked(fetch).mockResolvedValue(
            jsonResponse(200, {
                protocolVersion: 1,
                type: 'structure',
                structure: { guildId: 'guild-1', guildName: 'Guild', roles: [], channels: [], categories: [] },
            })
        );

        const result = await readDashboardBotGuildStructure('guild-1');

        expect(result.isOk()).toBe(true);
        expect(result._unsafeUnwrap()).toMatchObject({ guildId: 'guild-1' });
        expect(signNeonFluxServiceJwt).toHaveBeenCalledWith(
            expect.objectContaining({ audience: 'neonflux-bot-read-v1', issuer: 'https://neonflux.example/web' }),
            { expiresInSeconds: 60, serviceName: 'web' }
        );
        expect(fetch).toHaveBeenCalledWith(
            new URL('http://bot:3001/v1/guilds/guild-1/structure'),
            expect.objectContaining({
                headers: expect.objectContaining({ Authorization: 'Bearer short-lived-service-token' }),
                method: 'GET',
            })
        );
    });

    it('does not call the network without the internal URL or web signer config', async () => {
        const config = createConfig();
        delete config.botReadUrl;
        vi.mocked(loadWebConfig).mockReturnValueOnce(config);

        const result = await readDashboardBotGuildStructure('guild-1');

        expect(result).toEqual(expect.objectContaining({ error: 'not-configured' }));
        expect(fetch).not.toHaveBeenCalled();
    });

    it('posts an authenticated bodyless posting wake and validates the acknowledgement', async () => {
        vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(202, { protocolVersion: 1, type: 'accepted' }));

        const result = await wakeDashboardBotPostingWorker();

        expect(result.isOk()).toBe(true);
        expect(fetch).toHaveBeenCalledWith(
            new URL('http://bot:3001/v1/posting/wake'),
            expect.objectContaining({
                headers: expect.objectContaining({ Authorization: 'Bearer short-lived-service-token' }),
                method: 'POST',
            })
        );
        expect(vi.mocked(fetch).mock.calls[0]?.[1]).not.toHaveProperty('body');
    });

    it('maps posting wake transport, authorization, and response failures without retrying', async () => {
        vi.mocked(fetch)
            .mockRejectedValueOnce(new DOMException('timed out', 'AbortError'))
            .mockResolvedValueOnce(jsonResponse(401, { type: 'unauthorized' }))
            .mockResolvedValueOnce(jsonResponse(202, { protocolVersion: 2, type: 'accepted' }));

        await expect(wakeDashboardBotPostingWorker()).resolves.toEqual(
            expect.objectContaining({ error: 'transport-failed' })
        );
        await expect(wakeDashboardBotPostingWorker()).resolves.toEqual(
            expect.objectContaining({ error: 'auth-failed' })
        );
        await expect(wakeDashboardBotPostingWorker()).resolves.toEqual(
            expect.objectContaining({ error: 'invalid-response' })
        );
        expect(fetch).toHaveBeenCalledTimes(3);
    });

    it.each([
        ['wrong protocol version', 200, { protocolVersion: 2, type: 'structure' }],
        [
            'malformed nested data',
            200,
            {
                protocolVersion: 1,
                type: 'structure',
                structure: { guildId: 'guild-1', guildName: 'Guild', roles: [], channels: [{}], categories: [] },
            },
        ],
        ['status/body mismatch', 200, { protocolVersion: 1, type: 'read-failed' }],
    ])('rejects %s', async (_label, status, body) => {
        vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(status, body));

        const result = await readDashboardBotGuildStructure('guild-1');

        expect(result).toEqual(expect.objectContaining({ error: 'invalid-response' }));
    });

    it('maps authorization, overload, and provider failures without retrying', async () => {
        vi.mocked(fetch)
            .mockResolvedValueOnce(jsonResponse(401, { type: 'unauthorized' }))
            .mockResolvedValueOnce(jsonResponse(503, { protocolVersion: 1, type: 'overloaded' }))
            .mockResolvedValueOnce(jsonResponse(502, { protocolVersion: 1, type: 'read-failed' }));

        await expect(readDashboardBotGuildStructure('guild-1')).resolves.toEqual(
            expect.objectContaining({ error: 'auth-failed' })
        );
        await expect(readDashboardBotGuildStructure('guild-1')).resolves.toEqual(
            expect.objectContaining({ error: 'overloaded' })
        );
        await expect(readDashboardBotGuildStructure('guild-1')).resolves.toEqual(
            expect.objectContaining({ error: 'read-failed' })
        );
        expect(fetch).toHaveBeenCalledTimes(3);
    });

    it('maps a deadline/network rejection to one transport failure', async () => {
        vi.mocked(fetch).mockRejectedValueOnce(new DOMException('timed out', 'AbortError'));

        const result = await readDashboardBotGuildStructure('guild-1');

        expect(result).toEqual(expect.objectContaining({ error: 'transport-failed' }));
        expect(fetch).toHaveBeenCalledOnce();
    });

    it('stops reading an oversized response without relying on Content-Length', async () => {
        vi.mocked(fetch).mockResolvedValueOnce(
            new Response(
                new ReadableStream({
                    start(controller) {
                        const oneMiB = new Uint8Array(1024 * 1024);
                        for (let index = 0; index < 11; index += 1) controller.enqueue(oneMiB);
                        controller.close();
                    },
                }),
                { headers: { 'Content-Type': 'application/json' }, status: 200 }
            )
        );

        const result = await readDashboardBotGuildStructure('guild-1');

        expect(result).toEqual(expect.objectContaining({ error: 'invalid-response' }));
        expect(fetch).toHaveBeenCalledOnce();
    });
});

function createConfig(overrides: Partial<WebConfig> = {}): WebConfig {
    return {
        appEnv: 'production',
        botReadUrl: 'http://bot:3001',
        convex: {
            webAuthJwtIssuer: 'https://neonflux.example/web',
            webAuthJwtPrivateKey: 'private-key',
        },
        guildDefconOverride: 'auto',
        logLevel: 'info',
        nodeEnv: 'test',
        ...overrides,
    };
}

function jsonResponse(status: number, body: unknown): Response {
    return new Response(JSON.stringify(body), {
        headers: { 'Content-Type': 'application/json' },
        status,
    });
}

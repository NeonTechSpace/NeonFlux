import { generateKeyPairSync } from 'node:crypto';

import {
    blueprintWorkerControlJwtAudience,
    blueprintWorkerWakePath,
} from '@neonflux/blueprint/worker-control-contract';
import { createNeonFluxJwks, signNeonFluxServiceJwt } from '@neonflux/convex/jwt';
import type { AppLogger } from '@neonflux/core/logging';
import { botProviderReadJwtAudience } from '@neonflux/fluxer/bot-provider-read-contract';
import { readFluxerGuildStructure } from '@neonflux/fluxer/guild-structure';
import type * as FluxerGuildStructure from '@neonflux/fluxer/guild-structure';
import type { FluxerBot } from '@neonflux/fluxer';
import {
    postingWorkerControlJwtAudience,
    postingWorkerWakePath,
} from '@neonflux/messaging/posting-worker-control-contract';
import { err, ok } from 'neverthrow';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { startBotInternalApiServer, type BotInternalApiServer } from './bot-internal-api-server.js';

vi.mock('@neonflux/fluxer/guild-structure', async (importActual) => {
    const actual = await importActual<typeof FluxerGuildStructure>();
    return { ...actual, readFluxerGuildStructure: vi.fn() };
});

const issuer = 'https://neonflux.example/web';
const signer = createSigner();
const otherSigner = createSigner();
const jwks = `data:application/json,${encodeURIComponent(JSON.stringify(createNeonFluxJwks(signer)))}`;
const logger = { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() } as unknown as AppLogger;
const bot = { client: { user: { id: 'bot-user' } } } as unknown as FluxerBot;
let servers: BotInternalApiServer[] = [];
const wakeBlueprintWorker = vi.fn();
const wakePostingWorker = vi.fn();

describe('bot internal API server', () => {
    beforeEach(() => {
        vi.mocked(readFluxerGuildStructure).mockReset();
        vi.mocked(readFluxerGuildStructure).mockResolvedValue(ok(createStructure('guild-1')));
        wakeBlueprintWorker.mockReset();
        wakePostingWorker.mockReset();
    });

    afterEach(async () => {
        await Promise.all(servers.splice(0).map((server) => server.stop()));
    });

    it('serves normalized structure only to a correctly scoped web service token', async () => {
        const server = await startServer();
        const response = await request(server, 'guild-1', await createToken());

        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toMatchObject({
            protocolVersion: 1,
            type: 'structure',
            structure: { guildId: 'guild-1' },
        });
        expect(readFluxerGuildStructure).toHaveBeenCalledWith({
            botUserId: 'bot-user',
            client: bot.client,
            guildId: 'guild-1',
        });
    });

    it.each([
        ['missing', undefined],
        ['wrong audience', () => createToken({ audience: 'neonflux-convex-web' })],
        ['wrong service', () => createToken({ serviceName: 'bot' })],
        ['forged signature', () => createToken({ signer: otherSigner })],
    ])('rejects %s credentials', async (_label, provideToken) => {
        const server = await startServer();
        const token = provideToken ? await provideToken() : undefined;
        const response = await request(server, 'guild-1', token);

        expect(response.status).toBe(401);
        expect(readFluxerGuildStructure).not.toHaveBeenCalled();
    });

    it('does not expose provider failures in the response body', async () => {
        vi.mocked(readFluxerGuildStructure).mockResolvedValueOnce(
            err({ type: 'fetch-failed', error: { body: 'provider-secret-body', token: 'secret' } })
        );
        const server = await startServer();
        const response = await request(server, 'guild-1', await createToken());
        const body = await response.text();

        expect(response.status).toBe(502);
        expect(body).toBe('{"protocolVersion":1,"type":"read-failed"}');
        expect(body).not.toContain('provider-secret-body');
    });

    it('authenticates and accepts posting worker wake requests without a payload', async () => {
        const server = await startServer();
        const response = await wakeRequest(server, await createPostingControlToken());

        expect(response.status).toBe(202);
        await expect(response.json()).resolves.toEqual({ protocolVersion: 1, type: 'accepted' });
        expect(wakePostingWorker).toHaveBeenCalledTimes(1);
    });

    it('authenticates Blueprint wakes with a dedicated audience and exact response', async () => {
        const server = await startServer();
        const response = await blueprintWakeRequest(server, await createBlueprintControlToken());

        expect(response.status).toBe(202);
        await expect(response.json()).resolves.toEqual({ protocolVersion: 1, type: 'accepted' });
        expect(wakeBlueprintWorker).toHaveBeenCalledTimes(1);
        expect(wakePostingWorker).not.toHaveBeenCalled();
    });

    it('rejects invalid Blueprint wake methods, bodies, and capability tokens', async () => {
        const server = await startServer();

        expect(
            (await blueprintWakeRequest(server, await createBlueprintControlToken(), { method: 'GET' })).status
        ).toBe(405);
        expect((await blueprintWakeRequest(server, await createBlueprintControlToken(), { body: '{}' })).status).toBe(
            413
        );
        expect((await blueprintWakeRequest(server, await createPostingControlToken())).status).toBe(401);
        expect(wakeBlueprintWorker).not.toHaveBeenCalled();
    });

    it('rejects unauthorized, incorrectly shaped, and payload-bearing wake requests', async () => {
        const server = await startServer();

        expect((await wakeRequest(server)).status).toBe(401);
        expect((await wakeRequest(server, await createPostingControlToken(), { method: 'GET' })).status).toBe(405);
        expect((await wakeRequest(server, await createPostingControlToken(), { body: '{}' })).status).toBe(413);
        expect(wakePostingWorker).not.toHaveBeenCalled();
    });

    it('rejects tokens issued for the other internal API capability', async () => {
        const server = await startServer();
        const [readWithControlToken, wakeWithReadToken] = await Promise.all([
            request(server, 'guild-1', await createPostingControlToken()),
            wakeRequest(server, await createToken()),
        ]);

        expect(readWithControlToken.status).toBe(401);
        expect(wakeWithReadToken.status).toBe(401);
        expect(readFluxerGuildStructure).not.toHaveBeenCalled();
        expect(wakePostingWorker).not.toHaveBeenCalled();
    });

    it('shares one in-flight read per guild and rejects new guilds when globally saturated', async () => {
        const completions = Array.from({ length: 8 }, () =>
            Promise.withResolvers<Awaited<ReturnType<typeof readFluxerGuildStructure>>>()
        );
        let readIndex = 0;
        vi.mocked(readFluxerGuildStructure).mockImplementation(() => {
            const completion = completions[readIndex++];
            if (!completion) throw new Error('unexpected provider read');
            return completion.promise;
        });
        const server = await startServer();
        const token = await createToken();
        const first = request(server, 'guild-0', token);
        const duplicate = request(server, 'guild-0', token);
        const otherReads = Array.from({ length: 7 }, (_, index) =>
            request(server, `guild-${String(index + 1)}`, token)
        );

        await vi.waitFor(() => expect(readFluxerGuildStructure).toHaveBeenCalledTimes(8));
        const overloaded = await request(server, 'guild-9', token);
        expect(overloaded.status).toBe(503);

        // Resolve all provider reads after proving the admission boundary.
        for (const completion of completions) completion.resolve(ok(createStructure('guild')));
        await Promise.all([first, duplicate, ...otherReads]);
        expect(readFluxerGuildStructure).toHaveBeenCalledTimes(8);
    });

    it('stops accepting requests before shutdown completes', async () => {
        const server = await startServer();
        await server.stop();
        servers = servers.filter((candidate) => candidate !== server);

        await expect(request(server, 'guild-1', await createToken())).rejects.toThrow();
    });
});

async function startServer(): Promise<BotInternalApiServer> {
    const server = await startBotInternalApiServer({
        bot,
        host: '127.0.0.1',
        logger,
        port: 0,
        wakeBlueprintWorker,
        wakePostingWorker,
        webAuthJwtIssuer: issuer,
        webAuthJwtJwks: jwks,
    });
    servers.push(server);
    return server;
}

async function wakeRequest(
    server: BotInternalApiServer,
    token?: string,
    init: { body?: string; method?: string } = {}
): Promise<Response> {
    return fetch(`http://127.0.0.1:${String(server.port)}${postingWorkerWakePath}`, {
        ...(init.body ? { body: init.body } : {}),
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        method: init.method ?? 'POST',
    });
}

async function blueprintWakeRequest(
    server: BotInternalApiServer,
    token?: string,
    init: { body?: string; method?: string } = {}
): Promise<Response> {
    return fetch(`http://127.0.0.1:${String(server.port)}${blueprintWorkerWakePath}`, {
        ...(init.body ? { body: init.body } : {}),
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        method: init.method ?? 'POST',
    });
}

async function request(server: BotInternalApiServer, guildId: string, token?: string): Promise<Response> {
    return fetch(
        `http://127.0.0.1:${String(server.port)}/v1/provider/guilds/${encodeURIComponent(guildId)}/structure`,
        {
            headers: token ? { Authorization: `Bearer ${token}` } : {},
        }
    );
}

function createToken(
    overrides: {
        audience?: string;
        serviceName?: 'bot' | 'web';
        signer?: ReturnType<typeof createSigner>;
    } = {}
): Promise<string> {
    const tokenSigner = overrides.signer ?? signer;
    return signNeonFluxServiceJwt(
        { ...tokenSigner, audience: overrides.audience ?? botProviderReadJwtAudience, issuer },
        { serviceName: overrides.serviceName ?? 'web' }
    );
}

function createPostingControlToken(): Promise<string> {
    return createToken({ audience: postingWorkerControlJwtAudience });
}

function createBlueprintControlToken(): Promise<string> {
    return createToken({ audience: blueprintWorkerControlJwtAudience });
}

function createSigner() {
    const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    return {
        audience: botProviderReadJwtAudience,
        issuer,
        privateKeyPem: privateKey.export({ format: 'pem', type: 'pkcs8' }),
    };
}

function createStructure(guildId: string) {
    return { guildId, guildName: 'Guild', roles: [], channels: [], categories: [] };
}

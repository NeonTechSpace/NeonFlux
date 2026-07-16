import '@tanstack/react-start/server-only';

import { Buffer } from 'node:buffer';

import { loadWebConfig } from '@neonflux/config';
import type { WebConfig } from '@neonflux/config';
import { createNeonFluxServiceAuthTokenProvider } from '@neonflux/convex/service-auth-token';
import type { NeonFluxServiceAuthTokenProvider } from '@neonflux/convex/service-auth-token';
import {
    botProviderReadJwtAudience,
    createBotProviderReadGuildStructurePath,
    parseBotProviderReadGuildStructureResponse,
} from '@neonflux/fluxer/bot-provider-read-contract';
import type { FluxerGuildStructure } from '@neonflux/fluxer/guild-structure';
import {
    parsePostingWorkerWakeResponse,
    postingWorkerControlJwtAudience,
    postingWorkerWakePath,
} from '@neonflux/messaging/posting-worker-control-contract';
import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';

const providerReadTimeoutMs = 13_000;
const botWakeTimeoutMs = 500;
const botInternalApiTokenLifetimeSeconds = 60;
const botInternalApiTokenRefreshSkewSeconds = 10;
const botInternalApiTokenSigningRetryDelayMs = 5_000;
const maxProviderReadResponseBytes = 10 * 1024 * 1024;
const maxBotWakeResponseBytes = 1024;

type BotInternalApiClientConfig = {
    jwtIssuer: string;
    jwtPrivateKey: string;
    url: string;
};

type BotInternalApiClient = BotInternalApiClientConfig & {
    postingControlToken: NeonFluxServiceAuthTokenProvider;
    providerReadToken: NeonFluxServiceAuthTokenProvider;
};

let cachedClient: BotInternalApiClient | undefined;

export type DashboardBotGuildStructureReadError =
    | 'not-configured'
    | 'auth-failed'
    | 'transport-failed'
    | 'invalid-response'
    | 'unavailable-or-not-found'
    | 'read-failed'
    | 'overloaded';

export async function readDashboardBotGuildStructure(
    guildId: string
): Promise<Result<FluxerGuildStructure, DashboardBotGuildStructureReadError>> {
    const config = loadWebConfig();
    const client = readClient(config);
    if (!client) return err('not-configured');

    let token: string;

    try {
        token = await client.providerReadToken();
    } catch {
        return err('auth-failed');
    }

    let response: Response;

    try {
        response = await fetch(new URL(createBotProviderReadGuildStructurePath(guildId), `${client.url}/`), {
            headers: {
                Accept: 'application/json',
                Authorization: `Bearer ${token}`,
            },
            method: 'GET',
            signal: AbortSignal.timeout(providerReadTimeoutMs),
        });
    } catch {
        return err('transport-failed');
    }

    if (response.status === 401 || response.status === 403) return err('auth-failed');

    let body: unknown;

    try {
        const text = await readBoundedResponseText(response, maxProviderReadResponseBytes);
        if (text === undefined) return err('invalid-response');
        body = JSON.parse(text);
    } catch {
        return err('invalid-response');
    }

    const parsed = parseBotProviderReadGuildStructureResponse(body);
    if (parsed.isErr()) return err('invalid-response');

    switch (parsed.value.type) {
        case 'structure':
            return response.status === 200 ? ok(parsed.value.structure) : err('invalid-response');
        case 'unavailable-or-not-found':
            return response.status === 404 ? err('unavailable-or-not-found') : err('invalid-response');
        case 'read-failed':
            return response.status === 502 ? err('read-failed') : err('invalid-response');
        case 'overloaded':
            return response.status === 503 ? err('overloaded') : err('invalid-response');
    }
}

export type DashboardBotPostingWakeError = 'not-configured' | 'auth-failed' | 'transport-failed' | 'invalid-response';

export async function wakeDashboardBotPostingWorker(): Promise<Result<void, DashboardBotPostingWakeError>> {
    let config: WebConfig;
    try {
        config = loadWebConfig();
    } catch {
        return err('not-configured');
    }
    const client = readClient(config);
    if (!client) return err('not-configured');

    let token: string;
    try {
        token = await client.postingControlToken();
    } catch {
        return err('auth-failed');
    }

    let response: Response;
    try {
        response = await fetch(new URL(postingWorkerWakePath, `${client.url}/`), {
            headers: {
                Accept: 'application/json',
                Authorization: `Bearer ${token}`,
            },
            method: 'POST',
            signal: AbortSignal.timeout(botWakeTimeoutMs),
        });
    } catch {
        return err('transport-failed');
    }

    if (response.status === 401 || response.status === 403) return err('auth-failed');

    try {
        const text = await readBoundedResponseText(response, maxBotWakeResponseBytes);
        if (text === undefined) return err('invalid-response');
        const parsed = parsePostingWorkerWakeResponse(JSON.parse(text));
        return parsed.isOk() && response.status === 202 ? ok(undefined) : err('invalid-response');
    } catch {
        return err('invalid-response');
    }
}

async function readBoundedResponseText(response: Response, maxBytes: number): Promise<string | undefined> {
    const declaredLength = Number(response.headers.get('content-length'));
    if (Number.isFinite(declaredLength) && declaredLength > maxBytes) return undefined;

    if (!response.body) return '';

    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let totalBytes = 0;

    for (;;) {
        const chunk = await reader.read();
        if (chunk.done) break;

        totalBytes += chunk.value.byteLength;
        if (totalBytes > maxBytes) {
            await reader.cancel();
            return undefined;
        }
        chunks.push(chunk.value);
    }

    return Buffer.concat(chunks, totalBytes).toString('utf8');
}

function readClient(config: WebConfig): BotInternalApiClient | undefined {
    const jwtIssuer = config.convex?.webAuthJwtIssuer;
    const jwtPrivateKey = config.convex?.webAuthJwtPrivateKey;

    if (!config.botInternalApiUrl || !jwtIssuer || !jwtPrivateKey) return undefined;

    const clientConfig = { jwtIssuer, jwtPrivateKey, url: config.botInternalApiUrl };

    if (cachedClient && sameClientConfig(cachedClient, clientConfig)) {
        return cachedClient;
    }

    cachedClient = {
        ...clientConfig,
        postingControlToken: createTokenProvider(clientConfig, postingWorkerControlJwtAudience),
        providerReadToken: createTokenProvider(clientConfig, botProviderReadJwtAudience),
    };

    return cachedClient;
}

function createTokenProvider(
    clientConfig: BotInternalApiClientConfig,
    audience: string
): NeonFluxServiceAuthTokenProvider {
    return createNeonFluxServiceAuthTokenProvider({
        audience,
        expiresInSeconds: botInternalApiTokenLifetimeSeconds,
        issuer: clientConfig.jwtIssuer,
        privateKey: clientConfig.jwtPrivateKey,
        refreshSkewSeconds: botInternalApiTokenRefreshSkewSeconds,
        serviceName: 'web',
        signingRetryDelayMs: botInternalApiTokenSigningRetryDelayMs,
    });
}

function sameClientConfig(existing: BotInternalApiClient, candidate: BotInternalApiClientConfig): boolean {
    return (
        existing.jwtIssuer === candidate.jwtIssuer &&
        existing.jwtPrivateKey === candidate.jwtPrivateKey &&
        existing.url === candidate.url
    );
}

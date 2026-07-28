import '@tanstack/react-start/server-only';

import { Buffer } from 'node:buffer';

import { loadWebConfig } from '@neonflux/config';
import type { WebConfig } from '@neonflux/config';
import { createNeonFluxServiceAuthTokenProvider } from '@neonflux/convex/service-auth-token';
import type { NeonFluxServiceAuthTokenProvider } from '@neonflux/convex/service-auth-token';
import {
    blueprintWorkerControlJwtAudience,
    blueprintWorkerWakePath,
    parseBlueprintWorkerWakeResponse,
} from '@neonflux/blueprint/worker-control-contract';
import {
    botProviderReadJwtAudience,
    createBotProviderReadGuildStructurePath,
    parseBotProviderReadGuildStructureResponse,
} from '@neonflux/fluxer/bot-provider-read-contract';
import type { FluxerGuildStructure } from '@neonflux/fluxer/guild-structure';
import {
    createReactionRoleCatalogPath,
    parseReactionRoleCatalogResponse,
    reactionRoleCatalogJwtAudience,
} from '@neonflux/fluxer/reaction-role-catalog-contract';
import type { FluxerReactionRoleCatalog } from '@neonflux/fluxer/reaction-roles';
import {
    parsePostingWorkerWakeResponse,
    postingWorkerControlJwtAudience,
    postingWorkerWakePath,
} from '@neonflux/messaging/posting-worker-control-contract';
import {
    parseReactionRoleWorkerWakeResponse,
    reactionRoleWorkerControlJwtAudience,
    reactionRoleWorkerWakePath,
} from '@neonflux/reaction-roles/worker-control-contract';
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
    blueprintControlToken: NeonFluxServiceAuthTokenProvider;
    postingControlToken: NeonFluxServiceAuthTokenProvider;
    providerReadToken: NeonFluxServiceAuthTokenProvider;
    reactionRoleCatalogToken: NeonFluxServiceAuthTokenProvider;
    reactionRoleControlToken: NeonFluxServiceAuthTokenProvider;
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

type DashboardBotWorkerWakeError = 'not-configured' | 'auth-failed' | 'transport-failed' | 'invalid-response';
export type DashboardBotPostingWakeError = DashboardBotWorkerWakeError;
export type DashboardBotBlueprintWakeError = DashboardBotWorkerWakeError;
export type DashboardBotReactionRoleWakeError = DashboardBotWorkerWakeError;

export async function wakeDashboardBotPostingWorker(): Promise<Result<void, DashboardBotPostingWakeError>> {
    return wakeDashboardBotWorker({
        parseResponse: (value) => parsePostingWorkerWakeResponse(value).isOk(),
        path: postingWorkerWakePath,
        token: (client) => client.postingControlToken,
    });
}

export async function wakeDashboardBotBlueprintWorker(): Promise<Result<void, DashboardBotBlueprintWakeError>> {
    return wakeDashboardBotWorker({
        parseResponse: (value) => parseBlueprintWorkerWakeResponse(value).type === 'valid',
        path: blueprintWorkerWakePath,
        token: (client) => client.blueprintControlToken,
    });
}

export async function wakeDashboardBotReactionRoleWorker(): Promise<Result<void, DashboardBotReactionRoleWakeError>> {
    return wakeDashboardBotWorker({
        parseResponse: (value) => parseReactionRoleWorkerWakeResponse(value).isOk(),
        path: reactionRoleWorkerWakePath,
        token: (client) => client.reactionRoleControlToken,
    });
}

export async function readDashboardBotReactionRoleCatalog(
    guildId: string
): Promise<Result<FluxerReactionRoleCatalog, DashboardBotGuildStructureReadError>> {
    const config = loadWebConfig();
    const client = readClient(config);
    if (!client) return err('not-configured');

    let token: string;
    try {
        token = await client.reactionRoleCatalogToken();
    } catch {
        return err('auth-failed');
    }

    let response: Response;
    try {
        response = await fetch(new URL(createReactionRoleCatalogPath(guildId), `${client.url}/`), {
            headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
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

    const parsed = parseReactionRoleCatalogResponse(body);
    if (parsed.isErr()) return err('invalid-response');
    switch (parsed.value.type) {
        case 'catalog':
            return response.status === 200 ? ok(parsed.value.catalog) : err('invalid-response');
        case 'unavailable-or-not-found':
            return response.status === 404 ? err('unavailable-or-not-found') : err('invalid-response');
        case 'read-failed':
            return response.status === 502 ? err('read-failed') : err('invalid-response');
        case 'overloaded':
            return response.status === 503 ? err('overloaded') : err('invalid-response');
    }
}

async function wakeDashboardBotWorker(input: {
    parseResponse: (value: unknown) => boolean;
    path: string;
    token: (client: BotInternalApiClient) => NeonFluxServiceAuthTokenProvider;
}): Promise<Result<void, DashboardBotWorkerWakeError>> {
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
        token = await input.token(client)();
    } catch {
        return err('auth-failed');
    }

    let response: Response;
    try {
        response = await fetch(new URL(input.path, `${client.url}/`), {
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
        return input.parseResponse(JSON.parse(text)) && response.status === 202
            ? ok(undefined)
            : err('invalid-response');
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
        blueprintControlToken: createTokenProvider(clientConfig, blueprintWorkerControlJwtAudience),
        postingControlToken: createTokenProvider(clientConfig, postingWorkerControlJwtAudience),
        providerReadToken: createTokenProvider(clientConfig, botProviderReadJwtAudience),
        reactionRoleCatalogToken: createTokenProvider(clientConfig, reactionRoleCatalogJwtAudience),
        reactionRoleControlToken: createTokenProvider(clientConfig, reactionRoleWorkerControlJwtAudience),
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

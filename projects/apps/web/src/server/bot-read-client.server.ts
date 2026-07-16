import '@tanstack/react-start/server-only';

import { Buffer } from 'node:buffer';

import { loadWebConfig } from '@neonflux/config';
import type { WebConfig } from '@neonflux/config';
import { signNeonFluxServiceJwt } from '@neonflux/convex/jwt';
import {
    botReadJwtAudience,
    botReadPostingWakePath,
    createBotReadGuildStructurePath,
    parseBotReadGuildStructureResponse,
    parseBotReadPostingWakeResponse,
} from '@neonflux/fluxer/bot-read-contract';
import type { FluxerGuildStructure } from '@neonflux/fluxer/guild-structure';
import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';

const botReadTimeoutMs = 13_000;
const botWakeTimeoutMs = 500;
const botReadTokenLifetimeSeconds = 60;
const maxBotReadResponseBytes = 10 * 1024 * 1024;
const maxBotWakeResponseBytes = 1024;

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
    const clientConfig = readClientConfig(config);
    if (!clientConfig) return err('not-configured');

    let token: string;

    try {
        token = await signNeonFluxServiceJwt(
            {
                audience: botReadJwtAudience,
                issuer: clientConfig.jwtIssuer,
                privateKeyPem: clientConfig.jwtPrivateKey,
            },
            { expiresInSeconds: botReadTokenLifetimeSeconds, serviceName: 'web' }
        );
    } catch {
        return err('auth-failed');
    }

    let response: Response;

    try {
        response = await fetch(new URL(createBotReadGuildStructurePath(guildId), `${clientConfig.url}/`), {
            headers: {
                Accept: 'application/json',
                Authorization: `Bearer ${token}`,
            },
            method: 'GET',
            signal: AbortSignal.timeout(botReadTimeoutMs),
        });
    } catch {
        return err('transport-failed');
    }

    if (response.status === 401 || response.status === 403) return err('auth-failed');

    let body: unknown;

    try {
        const text = await readBoundedResponseText(response, maxBotReadResponseBytes);
        if (text === undefined) return err('invalid-response');
        body = JSON.parse(text);
    } catch {
        return err('invalid-response');
    }

    const parsed = parseBotReadGuildStructureResponse(body);
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
    const clientConfig = readClientConfig(config);
    if (!clientConfig) return err('not-configured');

    let token: string;
    try {
        token = await createBotReadToken(clientConfig);
    } catch {
        return err('auth-failed');
    }

    let response: Response;
    try {
        response = await fetch(new URL(botReadPostingWakePath, `${clientConfig.url}/`), {
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
        const parsed = parseBotReadPostingWakeResponse(JSON.parse(text));
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

function readClientConfig(config: WebConfig): { jwtIssuer: string; jwtPrivateKey: string; url: string } | undefined {
    const jwtIssuer = config.convex?.webAuthJwtIssuer;
    const jwtPrivateKey = config.convex?.webAuthJwtPrivateKey;

    return config.botReadUrl && jwtIssuer && jwtPrivateKey
        ? { jwtIssuer, jwtPrivateKey, url: config.botReadUrl }
        : undefined;
}

function createBotReadToken(clientConfig: { jwtIssuer: string; jwtPrivateKey: string }): Promise<string> {
    return signNeonFluxServiceJwt(
        {
            audience: botReadJwtAudience,
            issuer: clientConfig.jwtIssuer,
            privateKeyPem: clientConfig.jwtPrivateKey,
        },
        { expiresInSeconds: botReadTokenLifetimeSeconds, serviceName: 'web' }
    );
}

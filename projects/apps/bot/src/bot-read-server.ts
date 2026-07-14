import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';

import {
    createNeonFluxJwkSetFromJwksConfig,
    verifyNeonFluxJwtWithJwkSet,
    type NeonFluxJwtVerifierConfig,
} from '@neonflux/convex/jwt';
import type { AppLogger } from '@neonflux/core/logging';
import {
    botReadGuildStructurePathPrefix,
    botReadJwtAudience,
    botReadProtocolVersion,
    type BotReadGuildStructureResponse,
} from '@neonflux/fluxer/bot-read-contract';
import { readFluxerGuildStructure } from '@neonflux/fluxer/guild-structure';
import type { FluxerBot } from '@neonflux/fluxer';

const maxConcurrentGuildReads = 8;
const providerReadDeadlineMs = 12_000;

export type BotReadServer = {
    host: string;
    port: number;
    stop(): Promise<void>;
};

export type StartBotReadServerInput = {
    bot: FluxerBot;
    host: string;
    logger: AppLogger;
    port: number;
    webAuthJwtIssuer: string;
    webAuthJwtJwks: string;
};

export async function startBotReadServer(input: StartBotReadServerInput): Promise<BotReadServer> {
    const jwtConfig: NeonFluxJwtVerifierConfig = {
        audience: botReadJwtAudience,
        issuer: input.webAuthJwtIssuer,
    };
    const jwks = createNeonFluxJwkSetFromJwksConfig(input.webAuthJwtJwks);
    const reads = createGuildStructureReads(input);
    const server = createServer((request, response) => {
        void handleRequest({ jwtConfig, jwks, reads, request, response }).catch(() => {
            if (!response.headersSent) writeJson(response, 500, { type: 'internal-error' });
            else response.destroy();
        });
    });
    const port = await listen(server, input.host, input.port);

    input.logger.info('bot.read_server_started', { host: input.host, port });

    let stopPromise: Promise<void> | undefined;

    return {
        host: input.host,
        port,
        stop() {
            if (stopPromise) return stopPromise;

            stopPromise = closeServer(server).finally(() => {
                input.logger.info('bot.read_server_stopped');
            });
            return stopPromise;
        },
    };
}

type GuildStructureReads = {
    read(guildId: string): Promise<BotReadGuildStructureResponse> | undefined;
};

function createGuildStructureReads(input: StartBotReadServerInput): GuildStructureReads {
    const inFlight = new Map<string, Promise<BotReadGuildStructureResponse>>();

    return {
        read(guildId) {
            const existing = inFlight.get(guildId);
            if (existing) return existing;
            if (inFlight.size >= maxConcurrentGuildReads) return undefined;

            const read = readGuildStructure(input, guildId).finally(() => {
                if (inFlight.get(guildId) === read) inFlight.delete(guildId);
            });
            inFlight.set(guildId, read);
            return read;
        },
    };
}

async function readGuildStructure(
    input: StartBotReadServerInput,
    guildId: string
): Promise<BotReadGuildStructureResponse> {
    try {
        const result = await readFluxerGuildStructure({
            client: input.bot.client,
            guildId,
            ...(input.bot.client.user?.id ? { botUserId: input.bot.client.user.id } : {}),
        });

        if (result.isOk()) {
            return { protocolVersion: botReadProtocolVersion, type: 'structure', structure: result.value };
        }

        return result.error.type === 'unavailable-or-not-found'
            ? { protocolVersion: botReadProtocolVersion, type: 'unavailable-or-not-found' }
            : { protocolVersion: botReadProtocolVersion, type: 'read-failed' };
    } catch {
        return { protocolVersion: botReadProtocolVersion, type: 'read-failed' };
    }
}

type RequestContext = {
    jwtConfig: NeonFluxJwtVerifierConfig;
    jwks: ReturnType<typeof createNeonFluxJwkSetFromJwksConfig>;
    reads: GuildStructureReads;
    request: IncomingMessage;
    response: ServerResponse;
};

async function handleRequest(context: RequestContext): Promise<void> {
    const guildId = readGuildId(context.request.url);

    if (!guildId) {
        writeJson(context.response, 404, { type: 'not-found' });
        return;
    }

    if (context.request.method !== 'GET') {
        context.response.setHeader('Allow', 'GET');
        writeJson(context.response, 405, { type: 'method-not-allowed' });
        return;
    }

    if (!(await isAuthorized(context))) {
        writeJson(context.response, 401, { type: 'unauthorized' });
        return;
    }

    const read = context.reads.read(guildId);
    if (!read) {
        writeJson(context.response, 503, { protocolVersion: botReadProtocolVersion, type: 'overloaded' });
        return;
    }

    const result = await withDeadline(read, providerReadDeadlineMs);
    if (!result) {
        writeJson(context.response, 502, { protocolVersion: botReadProtocolVersion, type: 'read-failed' });
        return;
    }

    const status = result.type === 'structure' ? 200 : result.type === 'unavailable-or-not-found' ? 404 : 502;
    writeJson(context.response, status, result);
}

async function isAuthorized(context: RequestContext): Promise<boolean> {
    const authorization = context.request.headers.authorization;
    if (!authorization?.startsWith('Bearer ')) return false;

    const token = authorization.slice('Bearer '.length).trim();
    if (!token) return false;

    try {
        const payload = await verifyNeonFluxJwtWithJwkSet(context.jwtConfig, token, context.jwks);
        return (
            payload.sub === 'service:web' &&
            payload.neonflux.kind === 'service' &&
            payload.neonflux.serviceName === 'web'
        );
    } catch {
        return false;
    }
}

function readGuildId(requestUrl: string | undefined): string | undefined {
    if (!requestUrl) return undefined;

    const pathname = new URL(requestUrl, 'http://bot.internal').pathname;
    const suffix = '/structure';
    if (!pathname.startsWith(botReadGuildStructurePathPrefix) || !pathname.endsWith(suffix)) return undefined;

    const encodedGuildId = pathname.slice(botReadGuildStructurePathPrefix.length, -suffix.length);
    if (!encodedGuildId || encodedGuildId.includes('/')) return undefined;

    try {
        const guildId = decodeURIComponent(encodedGuildId).trim();
        return guildId && guildId.length <= 128 ? guildId : undefined;
    } catch {
        return undefined;
    }
}

function writeJson(response: ServerResponse, status: number, body: unknown): void {
    response.statusCode = status;
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Content-Type', 'application/json; charset=utf-8');
    response.end(JSON.stringify(body));
}

function withDeadline<T>(promise: Promise<T>, timeoutMs: number): Promise<T | undefined> {
    return new Promise((resolve) => {
        const timeout = setTimeout(() => resolve(undefined), timeoutMs);
        void promise.then(
            (value) => {
                clearTimeout(timeout);
                resolve(value);
            },
            () => {
                clearTimeout(timeout);
                resolve(undefined);
            }
        );
    });
}

function listen(server: Server, host: string, port: number): Promise<number> {
    return new Promise((resolve, reject) => {
        const onError = (error: Error) => reject(error);
        server.once('error', onError);
        server.listen(port, host, () => {
            server.off('error', onError);
            const address = server.address();
            if (!address || typeof address === 'string') {
                reject(new Error('Bot read server did not expose a TCP address.'));
                return;
            }
            resolve(address.port);
        });
    });
}

function closeServer(server: Server): Promise<void> {
    return new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
        server.closeIdleConnections();
    });
}

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';

import {
    createNeonFluxJwkSetFromJwksConfig,
    verifyNeonFluxJwtWithJwkSet,
    type NeonFluxJwtVerifierConfig,
} from '@neonflux/convex/jwt';
import type { AppLogger } from '@neonflux/core/logging';
import {
    botProviderReadGuildStructurePathPrefix,
    botProviderReadJwtAudience,
    botProviderReadProtocolVersion,
    type BotProviderReadGuildStructureResponse,
} from '@neonflux/fluxer/bot-provider-read-contract';
import { readFluxerGuildStructure } from '@neonflux/fluxer/guild-structure';
import type { FluxerBot } from '@neonflux/fluxer';
import {
    postingWorkerControlJwtAudience,
    postingWorkerControlProtocolVersion,
    postingWorkerWakePath,
} from '@neonflux/messaging/posting-worker-control-contract';

const maxConcurrentGuildReads = 8;
const providerReadDeadlineMs = 12_000;

export type BotInternalApiServer = {
    host: string;
    port: number;
    stop(): Promise<void>;
};

export type StartBotInternalApiServerInput = {
    bot: FluxerBot;
    host: string;
    logger: AppLogger;
    port: number;
    wakePostingWorker(): void;
    webAuthJwtIssuer: string;
    webAuthJwtJwks: string;
};

export async function startBotInternalApiServer(input: StartBotInternalApiServerInput): Promise<BotInternalApiServer> {
    const providerReadJwtConfig: NeonFluxJwtVerifierConfig = {
        audience: botProviderReadJwtAudience,
        issuer: input.webAuthJwtIssuer,
    };
    const postingControlJwtConfig: NeonFluxJwtVerifierConfig = {
        audience: postingWorkerControlJwtAudience,
        issuer: input.webAuthJwtIssuer,
    };
    const jwks = createNeonFluxJwkSetFromJwksConfig(input.webAuthJwtJwks);
    const reads = createGuildStructureReads(input);
    const server = createServer((request, response) => {
        void handleRequest({
            jwks,
            postingControlJwtConfig,
            providerReadJwtConfig,
            reads,
            request,
            response,
            wakePostingWorker: () => input.wakePostingWorker(),
        }).catch(() => {
            if (!response.headersSent) writeJson(response, 500, { type: 'internal-error' });
            else response.destroy();
        });
    });
    const port = await listen(server, input.host, input.port);

    input.logger.info('bot.internal_api_started', { host: input.host, port });

    let stopPromise: Promise<void> | undefined;

    return {
        host: input.host,
        port,
        stop() {
            if (stopPromise) return stopPromise;

            stopPromise = closeServer(server).finally(() => {
                input.logger.info('bot.internal_api_stopped');
            });
            return stopPromise;
        },
    };
}

type GuildStructureReads = {
    read(guildId: string): Promise<BotProviderReadGuildStructureResponse> | undefined;
};

function createGuildStructureReads(input: StartBotInternalApiServerInput): GuildStructureReads {
    const inFlight = new Map<string, Promise<BotProviderReadGuildStructureResponse>>();

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
    input: StartBotInternalApiServerInput,
    guildId: string
): Promise<BotProviderReadGuildStructureResponse> {
    try {
        const result = await readFluxerGuildStructure({
            client: input.bot.client,
            guildId,
            ...(input.bot.client.user?.id ? { botUserId: input.bot.client.user.id } : {}),
        });

        if (result.isOk()) {
            return { protocolVersion: botProviderReadProtocolVersion, type: 'structure', structure: result.value };
        }

        return result.error.type === 'unavailable-or-not-found'
            ? { protocolVersion: botProviderReadProtocolVersion, type: 'unavailable-or-not-found' }
            : { protocolVersion: botProviderReadProtocolVersion, type: 'read-failed' };
    } catch {
        return { protocolVersion: botProviderReadProtocolVersion, type: 'read-failed' };
    }
}

type RequestContext = {
    jwks: ReturnType<typeof createNeonFluxJwkSetFromJwksConfig>;
    postingControlJwtConfig: NeonFluxJwtVerifierConfig;
    providerReadJwtConfig: NeonFluxJwtVerifierConfig;
    reads: GuildStructureReads;
    request: IncomingMessage;
    response: ServerResponse;
    wakePostingWorker(): void;
};

async function handleRequest(context: RequestContext): Promise<void> {
    const pathname = readPathname(context.request.url);

    if (pathname === postingWorkerWakePath) {
        await handlePostingWake(context);
        return;
    }

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

    if (!(await isAuthorized(context, context.providerReadJwtConfig))) {
        writeJson(context.response, 401, { type: 'unauthorized' });
        return;
    }

    const read = context.reads.read(guildId);
    if (!read) {
        writeJson(context.response, 503, { protocolVersion: botProviderReadProtocolVersion, type: 'overloaded' });
        return;
    }

    const result = await withDeadline(read, providerReadDeadlineMs);
    if (!result) {
        writeJson(context.response, 502, { protocolVersion: botProviderReadProtocolVersion, type: 'read-failed' });
        return;
    }

    const status = result.type === 'structure' ? 200 : result.type === 'unavailable-or-not-found' ? 404 : 502;
    writeJson(context.response, status, result);
}

async function handlePostingWake(context: RequestContext): Promise<void> {
    if (context.request.method !== 'POST') {
        context.response.setHeader('Allow', 'POST');
        writeJson(context.response, 405, { type: 'method-not-allowed' });
        return;
    }

    if (requestHasBody(context.request)) {
        context.request.resume();
        writeJson(context.response, 413, { type: 'payload-not-allowed' });
        return;
    }

    if (!(await isAuthorized(context, context.postingControlJwtConfig))) {
        writeJson(context.response, 401, { type: 'unauthorized' });
        return;
    }

    context.wakePostingWorker();
    writeJson(context.response, 202, { protocolVersion: postingWorkerControlProtocolVersion, type: 'accepted' });
}

async function isAuthorized(context: RequestContext, jwtConfig: NeonFluxJwtVerifierConfig): Promise<boolean> {
    const authorization = context.request.headers.authorization;
    if (!authorization?.startsWith('Bearer ')) return false;

    const token = authorization.slice('Bearer '.length).trim();
    if (!token) return false;

    try {
        const payload = await verifyNeonFluxJwtWithJwkSet(jwtConfig, token, context.jwks);
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
    const pathname = readPathname(requestUrl);
    if (!pathname) return undefined;
    const suffix = '/structure';
    if (!pathname.startsWith(botProviderReadGuildStructurePathPrefix) || !pathname.endsWith(suffix)) return undefined;

    const encodedGuildId = pathname.slice(botProviderReadGuildStructurePathPrefix.length, -suffix.length);
    if (!encodedGuildId || encodedGuildId.includes('/')) return undefined;

    try {
        const guildId = decodeURIComponent(encodedGuildId).trim();
        return guildId && guildId.length <= 128 ? guildId : undefined;
    } catch {
        return undefined;
    }
}

function readPathname(requestUrl: string | undefined): string | undefined {
    if (!requestUrl) return undefined;

    try {
        return new URL(requestUrl, 'http://bot.internal').pathname;
    } catch {
        return undefined;
    }
}

function requestHasBody(request: IncomingMessage): boolean {
    const transferEncoding = request.headers['transfer-encoding'];
    if (transferEncoding) return true;

    const contentLength = request.headers['content-length'];
    if (!contentLength) return false;
    const parsed = Number(contentLength);
    return !Number.isFinite(parsed) || parsed !== 0;
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
                reject(new Error('Bot internal API server did not expose a TCP address.'));
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

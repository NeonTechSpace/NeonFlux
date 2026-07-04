import '@tanstack/react-start/server-only';

import { loadWebConfig } from '@neonflux/config';
import type { WebConfig } from '@neonflux/config';
import { createNeonFluxJwks, signNeonFluxUserJwt } from '@neonflux/convex';
import type { NeonFluxJwtSignerConfig } from '@neonflux/convex';

import { loadDashboardGuildAccess } from './dashboard-guild-access.server.js';
import type { DashboardGuildAccess } from './dashboard-guild-access.server.js';
import { readAuthenticatedWebSession } from './web-session.server.js';
import type { WebSessionValidationError } from './web-session.server.js';

const convexUserTokenLifetimeSeconds = 5 * 60;

type ConvexTokenBody = {
    expiresAt: string;
    token: string;
};

export async function handleConvexJwksRequest(): Promise<Response> {
    try {
        const jwks = createNeonFluxJwks(loadWebConvexJwtSignerConfig());

        return jsonResponse(jwks, {
            headers: {
                'Cache-Control': 'public, max-age=300',
            },
        });
    } catch {
        return new Response('Convex auth unavailable.', {
            headers: {
                'Cache-Control': 'no-store',
            },
            status: 503,
        });
    }
}

export async function handleConvexTokenRequest(
    request: Request,
    options: {
        now?: Date;
    } = {}
): Promise<Response> {
    const sessionResult = await readAuthenticatedWebSession(request);

    if (sessionResult.isErr()) {
        return authErrorResponse(sessionResult.error);
    }

    const guildAccessResult = await loadDashboardGuildAccess(request);

    if (guildAccessResult.isErr()) {
        return dashboardAccessErrorResponse(guildAccessResult.error);
    }

    const signerConfig = loadWebConvexJwtSignerConfig();
    const now = options.now ?? new Date();
    const expiresAt = new Date(now.getTime() + convexUserTokenLifetimeSeconds * 1000);
    const token = await signNeonFluxUserJwt(signerConfig, {
        expiresInSeconds: convexUserTokenLifetimeSeconds,
        fluxerUserId: sessionResult.value.fluxerUserId,
        manageableGuildIds: readManageableGuildIds(guildAccessResult.value),
        now,
        sessionId: sessionResult.value.id,
    });

    return jsonResponse(
        {
            expiresAt: expiresAt.toISOString(),
            token,
        } satisfies ConvexTokenBody,
        {
            headers: {
                'Cache-Control': 'no-store',
            },
        }
    );
}

export function loadWebConvexJwtSignerConfig(config: WebConfig = loadWebConfig()): NeonFluxJwtSignerConfig {
    const convex = config.convex;

    return {
        audience: requireConfigValue(convex?.authJwtAudience, 'NEONFLUX_AUTH_JWT_AUDIENCE'),
        issuer: requireConfigValue(convex?.authJwtIssuer, 'NEONFLUX_AUTH_JWT_ISSUER'),
        privateKeyPem: requireConfigValue(convex?.authJwtPrivateKey, 'NEONFLUX_AUTH_JWT_PRIVATE_KEY'),
    };
}

function readManageableGuildIds(guildAccess: DashboardGuildAccess): string[] {
    switch (guildAccess.type) {
        case 'authorized':
            return guildAccess.guilds.map((guild) => guild.id);

        case 'no-manageable-guilds':
        case 'unauthorized':
            return [];
    }
}

function authErrorResponse(errorValue: WebSessionValidationError): Response {
    switch (errorValue) {
        case 'missing-cookie':
        case 'invalid-cookie':
        case 'invalid-signature':
        case 'not-found':
            return new Response('Authentication required.', { status: 401 });

        case 'database-error':
            return new Response('Convex auth unavailable.', { status: 500 });
    }
}

function dashboardAccessErrorResponse(errorValue: string): Response {
    switch (errorValue) {
        case 'missing-cookie':
        case 'invalid-cookie':
        case 'invalid-signature':
        case 'not-found':
        case 'missing-token-set':
        case 'token-expired':
        case 'missing-refresh-token':
        case 'token-refresh-failed':
        case 'invalid-token-payload':
        case 'decrypt-failed':
            return new Response('Authentication required.', { status: 401 });

        case 'deployment-config-not-found':
            return new Response('Convex auth unavailable.', { status: 503 });

        case 'guild-lookup-failed':
            return new Response('Convex auth unavailable.', { status: 502 });

        case 'database-error':
        default:
            return new Response('Convex auth unavailable.', { status: 500 });
    }
}

function jsonResponse(body: unknown, init?: ResponseInit): Response {
    const headers = new Headers(init?.headers);
    headers.set('Content-Type', 'application/json; charset=utf-8');

    return new Response(JSON.stringify(body), {
        ...init,
        headers,
    });
}

function requireConfigValue(value: string | undefined, name: string): string {
    if (!value) {
        throw new Error(`${name} is required`);
    }

    return value;
}

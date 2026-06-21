import '@tanstack/react-start/server-only';

import { loadDashboardGuildAccess } from './dashboard-guild-access.server.js';
import type { DashboardGuildAccess, DashboardGuildAccessError } from './dashboard-guild-access.server.js';

const fluxerLoginPath = '/auth/fluxer/login';

export async function handleDashboardRequest(request: Request): Promise<Response> {
    const guildAccessResult = await loadDashboardGuildAccess(request);

    if (guildAccessResult.isErr()) {
        return createDashboardFailureResponse(guildAccessResult.error);
    }

    return createDashboardSuccessResponse(guildAccessResult.value);
}

function createDashboardSuccessResponse(guildAccess: DashboardGuildAccess): Response {
    switch (guildAccess.type) {
        case 'authorized':
            return createTextResponse('NeonFlux dashboard guild access validated.', 200);

        case 'unauthorized':
            return createTextResponse('You are not authorized to modify the configured community.', 403);

        case 'no-manageable-guilds':
            return createTextResponse('No manageable communities found.', 200);
    }
}

function createDashboardFailureResponse(error: DashboardGuildAccessError): Response {
    switch (error) {
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
            return new Response(null, {
                status: 302,
                headers: {
                    Location: fluxerLoginPath,
                },
            });

        case 'database-error':
            return createTextResponse('NeonFlux dashboard unavailable.', 500);

        case 'guild-lookup-failed':
            return createTextResponse('NeonFlux dashboard unavailable.', 502);
    }
}

function createTextResponse(body: string, status: number): Response {
    return new Response(body, {
        status,
        headers: {
            'Content-Type': 'text/plain; charset=utf-8',
        },
    });
}

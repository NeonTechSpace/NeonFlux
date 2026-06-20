import '@tanstack/react-start/server-only';

import { readAuthenticatedWebSession } from './web-session.server.js';
import type { WebSessionValidationError } from './web-session.server.js';

const fluxerLoginPath = '/auth/fluxer/login';

export async function handleDashboardRequest(request: Request): Promise<Response> {
    const sessionResult = await readAuthenticatedWebSession(request);

    if (sessionResult.isErr()) {
        return createDashboardFailureResponse(sessionResult.error);
    }

    return createTextResponse('NeonFlux dashboard session validated.', 200);
}

function createDashboardFailureResponse(error: WebSessionValidationError): Response {
    switch (error) {
        case 'missing-cookie':
        case 'invalid-cookie':
        case 'invalid-signature':
        case 'not-found':
            return new Response(null, {
                status: 302,
                headers: {
                    Location: fluxerLoginPath,
                },
            });

        case 'database-error':
            return createTextResponse('NeonFlux dashboard unavailable.', 500);
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

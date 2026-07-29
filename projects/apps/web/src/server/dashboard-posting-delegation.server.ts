import '@tanstack/react-start/server-only';

import { loadWebConfig } from '@neonflux/config';
import { createNeonFluxConvexHttpClient, signNeonFluxPostingDelegationJwt } from '@neonflux/convex';
import { enqueueDashboardPostingOperation } from '@neonflux/db';
import type { OutgoingEmbed } from '@neonflux/messaging';

import { loadWebConvexJwtSignerConfig } from './convex-auth.server.js';

export async function enqueueAuthorizedDashboardPostingOperation(input: {
    actorUserId: string;
    content?: string;
    embeds: OutgoingEmbed[];
    guildId: string;
    payloadHash: string;
    requestKey: string;
    requestedChannelId: string;
    retryOfOperationId?: string;
}) {
    const config = loadWebConfig();
    const token = await signNeonFluxPostingDelegationJwt(loadWebConvexJwtSignerConfig(config), input);
    const client = createNeonFluxConvexHttpClient({
        authTokenProvider: () => Promise.resolve(token),
        url: requireConfigValue(config.convex?.url, 'CONVEX_URL'),
    });

    return enqueueDashboardPostingOperation(
        { client },
        {
            ...(input.content ? { content: input.content } : {}),
            embeds: input.embeds,
            guildId: input.guildId,
            payloadHash: input.payloadHash,
            requestKey: input.requestKey,
            requestedChannelId: input.requestedChannelId,
            ...(input.retryOfOperationId ? { retryOfOperationId: input.retryOfOperationId } : {}),
        }
    );
}

function requireConfigValue(value: string | undefined, name: string): string {
    if (!value) throw new Error(`${name} is required`);
    return value;
}

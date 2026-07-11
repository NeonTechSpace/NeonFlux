import { Client } from '@fluxerjs/core';

export const GUILD_STRUCTURE_REST_TIMEOUT_MS = 15_000;

export function createFluxerGuildStructureRestClient(botToken: string): Client {
    const client = new Client({
        gatewayDebug: false,
        rest: {
            retries: 0,
            timeout: GUILD_STRUCTURE_REST_TIMEOUT_MS,
        },
    });
    client.rest.setToken(botToken);
    return client;
}

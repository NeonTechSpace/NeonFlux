import { Client, type ClientOptions } from '@fluxerjs/core';

import { fluxerReadOnlyRetryPolicy, fluxerSafeRestOptions } from './rest-retry-policy.js';

export const FLUXER_REST_TIMEOUT_MS = 15_000;
export const fluxerBoundedNoRetryRestOptions = {
    retries: 0,
    retryPolicy: fluxerReadOnlyRetryPolicy,
    timeout: FLUXER_REST_TIMEOUT_MS,
} satisfies NonNullable<ClientOptions['rest']>;

export function createFluxerAuthenticatedRestClient(
    botToken: string,
    restOptions: NonNullable<ClientOptions['rest']> = fluxerSafeRestOptions
): Client {
    const client = new Client({
        gatewayDebug: false,
        rest: restOptions,
    });
    client.rest.setToken(botToken);
    return client;
}

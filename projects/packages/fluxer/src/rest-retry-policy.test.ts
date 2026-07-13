import { describe, expect, it } from 'vitest';

import { fluxerReadOnlyRetryPolicy } from './rest-retry-policy.js';

describe('fluxerReadOnlyRetryPolicy', () => {
    it.each(['GET', 'HEAD', ' get '])('keeps the configured retry budget for read-only %s requests', (method) => {
        expect(
            fluxerReadOnlyRetryPolicy({
                method,
                routeKey: '/guilds/:id',
                defaultRetries: 3,
            })
        ).toBe(3);
    });

    it.each(['POST', 'PUT', 'PATCH', 'DELETE'])('disables automatic retries for mutating %s requests', (method) => {
        expect(
            fluxerReadOnlyRetryPolicy({
                method,
                routeKey: '/guilds/:id',
                defaultRetries: 3,
            })
        ).toBe(0);
    });
});

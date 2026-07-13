import type { ClientOptions } from '@fluxerjs/core';

export type FluxerRetryPolicyContext = {
    method: string;
    routeKey: string;
    defaultRetries: number;
};

export const fluxerReadOnlyRetryPolicy = ({ method, defaultRetries }: FluxerRetryPolicyContext): number => {
    switch (method.trim().toUpperCase()) {
        case 'GET':
        case 'HEAD':
            return defaultRetries;
        default:
            return 0;
    }
};

export const fluxerSafeRestOptions = {
    retryPolicy: fluxerReadOnlyRetryPolicy,
} satisfies NonNullable<ClientOptions['rest']>;

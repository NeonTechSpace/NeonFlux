const fluxerReadRequestTimeoutMs = 10_000;

export function createFluxerReadRequestSignal(): AbortSignal {
    return AbortSignal.timeout(fluxerReadRequestTimeoutMs);
}

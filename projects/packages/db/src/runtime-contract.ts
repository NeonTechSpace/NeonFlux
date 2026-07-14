import { api } from '@neonflux/convex-api';
import { BLUEPRINT_RUN_PROTOCOL_VERSION } from '@neonflux/blueprint/protocol';
export { BLUEPRINT_RUN_PROTOCOL_VERSION } from '@neonflux/blueprint/protocol';

import type { ConvexServiceDbClient } from './convex.js';

export const CONVEX_RUNTIME_CONTRACT_TIMEOUT_MS = 10_000;

type ConvexRuntimeContractErrorOptions = {
    timeoutMs?: number;
};

export class ConvexRuntimeContractError extends Error {
    readonly reason: 'unavailable' | 'version-mismatch';

    constructor(reason: 'unavailable' | 'version-mismatch', options: ConvexRuntimeContractErrorOptions = {}) {
        const timeoutSeconds = options.timeoutMs === undefined ? undefined : options.timeoutMs / 1_000;
        super(
            reason === 'unavailable'
                ? timeoutSeconds === undefined
                    ? 'The deployed Convex runtime contract could not be verified. Deploy matching functions and verify service authentication before starting NeonFlux services.'
                    : `The deployed Convex runtime contract did not respond within ${String(timeoutSeconds)} seconds. Verify Convex availability, service authentication, and matching deployed functions before starting NeonFlux services.`
                : 'The deployed Convex runtime contract is incompatible with this NeonFlux build. Deploy matching Convex functions before starting services.'
        );
        this.name = 'ConvexRuntimeContractError';
        this.reason = reason;
    }
}

export async function assertConvexRuntimeContract(client: Pick<ConvexServiceDbClient, 'client'>): Promise<void> {
    let contract: { blueprintRunProtocolVersion: number };
    const controller = new AbortController();
    const timeout = setTimeout(() => {
        controller.abort();
    }, CONVEX_RUNTIME_CONTRACT_TIMEOUT_MS);

    try {
        contract = await client.client.query(api.runtime.readRuntimeContract, {}, { signal: controller.signal });
    } catch {
        throw controller.signal.aborted
            ? new ConvexRuntimeContractError('unavailable', { timeoutMs: CONVEX_RUNTIME_CONTRACT_TIMEOUT_MS })
            : new ConvexRuntimeContractError('unavailable');
    } finally {
        clearTimeout(timeout);
    }

    if (contract.blueprintRunProtocolVersion !== BLUEPRINT_RUN_PROTOCOL_VERSION) {
        throw new ConvexRuntimeContractError('version-mismatch');
    }
}

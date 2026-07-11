import { v } from 'convex/values';

import { query } from './_generated/server.js';
import { requireNeonFluxService } from './auth.js';
import { STRUCTURE_EXECUTION_PROTOCOL_VERSION } from './runtime_contract_model.js';

export const readRuntimeContract = query({
    args: {},
    returns: v.object({
        structureExecutionProtocolVersion: v.literal(STRUCTURE_EXECUTION_PROTOCOL_VERSION),
    }),
    handler: async (ctx) => {
        await requireNeonFluxService(ctx, ['bot', 'web']);

        return {
            structureExecutionProtocolVersion: STRUCTURE_EXECUTION_PROTOCOL_VERSION,
        };
    },
});

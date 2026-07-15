import { v } from 'convex/values';

import { internalQuery, query } from './_generated/server.js';
import { requireNeonFluxService } from './auth.js';
import { BLUEPRINT_RUN_PROTOCOL_VERSION } from './runtime_contract_model.js';

export const readRuntimeContract = query({
    args: {},
    returns: v.object({
        blueprintRunProtocolVersion: v.literal(BLUEPRINT_RUN_PROTOCOL_VERSION),
    }),
    handler: async (ctx) => {
        await requireNeonFluxService(ctx, ['bot', 'web']);

        return {
            blueprintRunProtocolVersion: BLUEPRINT_RUN_PROTOCOL_VERSION,
        };
    },
});

export const blueprintIoAcceptanceMarker = internalQuery({
    args: {
        marker: v.string(),
    },
    returns: v.string(),
    handler: (_ctx, args) => {
        console.warn(`NEONFLUX_BLUEPRINT_IO_MARKER ${args.marker}`);
        return args.marker;
    },
});

import { describe, expect, it } from 'vitest';

import { BLUEPRINT_RUN_PROTOCOL_VERSION as browserProtocolVersion } from '../apps/web/src/dashboard-blueprint-run-protocol.js';
import { BLUEPRINT_RUN_PROTOCOL_VERSION as deployedProtocolVersion } from '../convex/runtime_contract_model.js';
import { BLUEPRINT_RUN_PROTOCOL_VERSION as consumerProtocolVersion } from '../packages/db/src/runtime-contract.js';

describe('runtime contract release fence', () => {
    it('keeps deployed Convex, service consumers, and the browser progress reader on the same run protocol', () => {
        expect(consumerProtocolVersion).toBe(deployedProtocolVersion);
        expect(browserProtocolVersion).toBe(deployedProtocolVersion);
    });
});

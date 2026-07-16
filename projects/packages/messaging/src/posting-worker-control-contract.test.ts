import { describe, expect, it } from 'vitest';

import {
    parsePostingWorkerWakeResponse,
    postingWorkerControlProtocolVersion,
    postingWorkerWakePath,
} from './posting-worker-control-contract.js';

describe('posting worker control contract', () => {
    it('strictly parses the accepted wake acknowledgement', () => {
        expect(
            parsePostingWorkerWakeResponse({
                protocolVersion: postingWorkerControlProtocolVersion,
                type: 'accepted',
            }).isOk()
        ).toBe(true);
        expect(postingWorkerWakePath).toBe('/v1/posting/worker/wake');
    });

    it.each([
        { protocolVersion: 2, type: 'accepted' },
        { protocolVersion: 1, type: 'overloaded' },
        { protocolVersion: 1, type: 'accepted', extra: true },
    ])('rejects malformed acknowledgements', (value) => {
        expect(parsePostingWorkerWakeResponse(value)).toEqual(expect.objectContaining({ error: 'invalid-response' }));
    });
});

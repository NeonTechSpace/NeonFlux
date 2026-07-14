import { describe, expect, it } from 'vitest';

import {
    createConvexRuntimeEnvPlan,
    parseConvexRuntimeEnvArgs,
    requireConvexRuntimeEnvApplyConfirmation,
} from './convex-runtime-env-configure.js';

describe('Convex runtime env configuration', () => {
    it('uses the retention default and accepts a bounded override', () => {
        expect(createConvexRuntimeEnvPlan({}, { deployment: 'dev:target' })).toMatchObject({
            deployment: 'dev:target',
            retentionDays: 90,
        });
        expect(
            createConvexRuntimeEnvPlan({ NEONFLUX_DATA_RETENTION_DAYS: '730' }, { deployment: 'prod:target' })
        ).toMatchObject({ deployment: 'prod:target', retentionDays: 730 });
    });

    it('rejects invalid or excessive retention before planning a write', () => {
        expect(() => createConvexRuntimeEnvPlan({ NEONFLUX_DATA_RETENTION_DAYS: '0' })).toThrow(
            'data-retention-days-out-of-range'
        );
        expect(() => createConvexRuntimeEnvPlan({ NEONFLUX_DATA_RETENTION_DAYS: '731' })).toThrow(
            'data-retention-days-out-of-range'
        );
        expect(() => createConvexRuntimeEnvPlan({ NEONFLUX_DATA_RETENTION_DAYS: '90.5' })).toThrow(
            'data-retention-days-invalid'
        );
    });

    it('requires an explicit deployment and exact confirmation for apply', () => {
        expect(() => parseConvexRuntimeEnvArgs(['--apply'])).toThrow('--deployment');
        expect(() => requireConvexRuntimeEnvApplyConfirmation({ deployment: 'dev:target' }, 'prod:target')).toThrow(
            'does not match deployment'
        );
    });

    it('parses an explicitly confirmed apply', () => {
        expect(
            parseConvexRuntimeEnvArgs(['--deployment', 'dev:target', '--apply', '--confirm-apply-target', 'dev:target'])
        ).toEqual({ apply: true, confirmApplyTarget: 'dev:target', deployment: 'dev:target' });
    });
});

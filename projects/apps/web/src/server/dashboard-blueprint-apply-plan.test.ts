import { describe, expect, it } from 'vitest';

import { blueprintPlanDigest } from './dashboard-blueprint-apply-plan.js';

describe('blueprintPlanDigest', () => {
    it('is independent of object key insertion order while preserving array order', () => {
        expect(blueprintPlanDigest({ nested: { b: 2, a: 1 }, steps: ['first', 'second'] })).toBe(
            blueprintPlanDigest({ steps: ['first', 'second'], nested: { a: 1, b: 2 } })
        );
        expect(blueprintPlanDigest({ steps: ['first', 'second'] })).not.toBe(
            blueprintPlanDigest({ steps: ['second', 'first'] })
        );
    });
});

import { describe, expect, it } from 'vitest';

import { resolveMaxWorkers } from '../vitest-worker-policy.js';

describe('Vitest worker policy', () => {
    it.each([
        [4, 4],
        [16, 16],
    ])('uses all %i available threads in CI', (availableThreads, expected) => {
        expect(resolveMaxWorkers({ availableThreads, ci: true })).toBe(expected);
    });

    it.each([
        [4, 1],
        [16, 12],
    ])('retains the local worker formula for %i available threads', (availableThreads, expected) => {
        expect(resolveMaxWorkers({ availableThreads, ci: false })).toBe(expected);
    });

    it('lets a positive integer override win in every environment', () => {
        expect(resolveMaxWorkers({ availableThreads: 16, ci: true, override: '3' })).toBe(3);
        expect(resolveMaxWorkers({ availableThreads: 4, ci: false, override: '8' })).toBe(8);
    });

    it.each(['0', '-1', '1.5', '4.0', ' 4 ', 'workers', '9007199254740992'])(
        'ignores invalid override %j',
        (override) => {
            expect(resolveMaxWorkers({ availableThreads: 16, ci: true, override })).toBe(16);
            expect(resolveMaxWorkers({ availableThreads: 4, ci: false, override })).toBe(1);
        }
    );
});

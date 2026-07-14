import { describe, expect, it } from 'vitest';

import { createCiTypecheckCommands, readCiMaxWorkers } from './run-ci-typecheck.js';

describe('CI typecheck runner', () => {
    it('accepts only explicit positive safe integers', () => {
        expect(readCiMaxWorkers('8')).toBe(8);
        for (const invalid of [undefined, '', '0', '-1', '1.5', ' 4 ', 'workers', '9007199254740992']) {
            expect(() => readCiMaxWorkers(invalid)).toThrow('CI_MAX_WORKERS must be a positive integer.');
        }
    });

    it('applies the chosen workspace concurrency only to recursive package commands', () => {
        expect(createCiTypecheckCommands(6)).toEqual([
            ['--workspace-concurrency=6', '-r', '--filter', './packages/*', 'build'],
            ['convex:typecheck'],
            ['--workspace-concurrency=6', '-r', 'typecheck'],
            ['typecheck:configs'],
        ]);
    });
});

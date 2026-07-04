import { describe, expect, it } from 'vitest';

import { assertNoArgs } from './script-args.js';

describe('assertNoArgs', () => {
    it('accepts no arguments and pnpm delimiters', () => {
        expect(() => assertNoArgs([])).not.toThrow();
        expect(() => assertNoArgs(['--'])).not.toThrow();
    });

    it('rejects unexpected options and positional arguments', () => {
        expect(() => assertNoArgs(['--unexpected'])).toThrow('Unexpected argument: --unexpected');
        expect(() => assertNoArgs(['stray-value'])).toThrow('Unexpected argument: stray-value');
    });
});

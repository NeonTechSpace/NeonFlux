import { describe, expect, it } from 'vitest';

import { isValidCommandPrefix, normalizeCommandPrefix } from './command-prefix.js';

describe('command prefix validation', () => {
    it.each(['!', '🔥a1'])('accepts boundary-length Unicode command prefix %j', (prefix) => {
        expect(normalizeCommandPrefix(` ${prefix} `)._unsafeUnwrap()).toBe(prefix);
        expect(isValidCommandPrefix(prefix)).toBe(true);
    });

    it.each(['', '!!!!', 'a', '? a', '\u200b'])('rejects a distinct malformed command prefix boundary %j', (prefix) => {
        expect(normalizeCommandPrefix(prefix).isErr()).toBe(true);
        expect(isValidCommandPrefix(prefix)).toBe(false);
    });

    it('rejects Fluxer-reserved command prefix characters', () => {
        expect(normalizeCommandPrefix('/').isErr()).toBe(true);
    });
});

import { describe, expect, it } from 'vitest';

import { COMMAND_PREFIX_INVALID_MESSAGE, isValidCommandPrefix, normalizeCommandPrefix } from './command-prefix.js';

describe('command prefix validation', () => {
    it.each(['!', '?', '$2', '!go', '++a', '🔥1'])('accepts valid command prefix %j', (prefix) => {
        expect(normalizeCommandPrefix(` ${prefix} `)._unsafeUnwrap()).toBe(prefix);
        expect(isValidCommandPrefix(prefix)).toBe(true);
    });

    it.each(['', '    ', '....', 'a', '1', '? a', '\u200b', '👩‍💻'])('rejects malformed command prefix %j', (prefix) => {
        expect(normalizeCommandPrefix(prefix).isErr()).toBe(true);
        expect(isValidCommandPrefix(prefix)).toBe(false);
    });

    it.each(['/', '@', '#', '<', '>', ':', '?/', '!@', '$#', '+<', '~>', '?:'])(
        'rejects Fluxer-reserved command prefix characters in %j',
        (prefix) => {
            expect(normalizeCommandPrefix(prefix).isErr()).toBe(true);
        }
    );

    it('exports the user-facing invalid prefix message', () => {
        expect(COMMAND_PREFIX_INVALID_MESSAGE).toContain('start with an allowed symbol');
        expect(COMMAND_PREFIX_INVALID_MESSAGE).toContain('/, @, #, <, >, or :');
    });
});

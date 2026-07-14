import { describe, expect, it } from 'vitest';

import { canonicalJsonStringify } from './canonical-json.js';

describe('canonicalJsonStringify', () => {
    it('sorts object keys recursively while preserving array order', () => {
        expect(
            canonicalJsonStringify({
                z: [{ second: 2, first: 1 }, 'after'],
                a: { z: true, a: null },
            })
        ).toBe('{"a":{"a":null,"z":true},"z":[{"first":1,"second":2},"after"]}');

        expect(canonicalJsonStringify(['second', 'first'])).not.toBe(canonicalJsonStringify(['first', 'second']));
    });

    it('produces the same output for equivalent objects created in different key orders', () => {
        expect(canonicalJsonStringify({ nested: { b: 2, a: 1 }, value: true })).toBe(
            canonicalJsonStringify({ value: true, nested: { a: 1, b: 2 } })
        );
    });

    it.each([
        undefined,
        Number.NaN,
        Number.POSITIVE_INFINITY,
        1n,
        () => undefined,
        new Date('2026-07-14T00:00:00.000Z'),
        { value: undefined },
        [undefined],
    ])('rejects unsupported JSON input %#', (value) => {
        expect(() => canonicalJsonStringify(value)).toThrow(TypeError);
    });

    it('rejects circular input', () => {
        const value: Record<string, unknown> = {};
        value.self = value;

        expect(() => canonicalJsonStringify(value)).toThrow(/circular reference/);
    });
});

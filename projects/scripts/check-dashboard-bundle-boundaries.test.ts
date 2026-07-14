import { describe, expect, it } from 'vitest';

// The production guard is intentionally plain Node.js so it can run after Vite without a transpiler.
import {
    assertBundleBoundary,
    assertProductionClientArtifacts,
    collectStaticClosure,
} from './check-dashboard-bundle-boundaries.mjs';

describe('dashboard bundle boundary guard', () => {
    it('follows static imports but leaves optional dynamic tools outside the cold graph', () => {
        const chunks = new Map([
            ['entry.js', 'import"./shared.js";const load=()=>import("./optional.js")'],
            ['shared.js', 'export const shell="stable"'],
            ['optional.js', 'export const tool="forbidden-heavy-tool"'],
        ]);

        expect([...collectStaticClosure(chunks, 'entry.js')]).toStrictEqual(['entry.js', 'shared.js']);
        expect(() =>
            assertBundleBoundary({
                chunks,
                entry: 'entry.js',
                label: 'Fixture shell',
                maxEntryBytes: 1_000,
                forbidden: ['forbidden-heavy-tool'],
            })
        ).not.toThrow();
    });

    it('rejects a forbidden feature pulled through a shared static chunk', () => {
        const chunks = new Map([
            ['entry.js', 'import"./shared.js"'],
            ['shared.js', 'export const feature="forbidden-leaf"'],
        ]);

        expect(() =>
            assertBundleBoundary({
                chunks,
                entry: 'entry.js',
                label: 'Fixture shell',
                maxEntryBytes: 1_000,
                forbidden: ['forbidden-leaf'],
            })
        ).toThrow(/statically reaches forbidden leaf marker/u);
    });

    it('rejects an optional tool pulled into a leaf through a shared chunk', () => {
        const chunks = new Map([
            ['entry.js', 'import"./dashboard-structure-explorer-fixture.js"'],
            ['dashboard-structure-explorer-fixture.js', 'export const tool="explorer"'],
        ]);

        expect(() =>
            assertBundleBoundary({
                chunks,
                entry: 'entry.js',
                label: 'Fixture leaf',
                maxEntryBytes: 1_000,
                forbidden: [],
                forbiddenChunkPatterns: [/^dashboard-structure-explorer-[\w-]+\.js$/u],
            })
        ).toThrow(/statically reaches forbidden chunk/u);
    });

    it.each([
        ['a React development runtime chunk', new Map([['jsx-dev-runtime-fixture.js', 'export const jsx = true']])],
        ['compiled jsxDEV calls', new Map([['route.js', 'jsxDEV("main", {})']])],
        [
            'absolute workspace source paths',
            new Map([['route.js', 'const fileName = "M:/workspace/apps/web/src/routes/dashboard.tsx"']]),
        ],
    ])('rejects production output containing %s', (_case, chunks) => {
        expect(() => assertProductionClientArtifacts(chunks)).toThrow(/Production client artifact/u);
    });
});

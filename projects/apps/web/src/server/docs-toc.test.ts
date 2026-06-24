import { describe, expect, it } from 'vitest';

import { serializeTableOfContents } from './docs-toc.js';

describe('serializeTableOfContents', () => {
    it('serializes Fumadocs React-element title shapes into plain route data', () => {
        const toc = serializeTableOfContents([
            {
                title: { props: { children: 'Prefix' } },
                url: '#prefix',
                depth: 2,
            },
            {
                title: { props: { children: ['Nested ', { props: { children: 'Title' } }] } },
                url: '#nested-title',
                depth: 3,
                _step: 1,
            },
        ]);

        expect(toc).toStrictEqual([
            { title: 'Prefix', url: '#prefix', depth: 2 },
            { title: 'Nested Title', url: '#nested-title', depth: 3, _step: 1 },
        ]);
    });

    it('drops table-of-contents entries that cannot be serialized safely', () => {
        expect(
            serializeTableOfContents([
                { title: { props: {} }, url: '#missing-title', depth: 2 },
                { title: { props: { children: 'Missing URL' } }, depth: 2 },
                { title: { props: { children: 'Missing depth' } }, url: '#missing-depth' },
            ])
        ).toStrictEqual([]);
    });
});

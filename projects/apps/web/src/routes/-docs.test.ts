import { describe, expect, it } from 'vitest';

import { toDocsRouteResult } from '../server/docs-route-data.js';
import type { PublicDocsRouteData } from '../server/docs.server.js';

describe('/docs routing', () => {
    it('maps available and missing docs data into route results', () => {
        const docsData = {
            pageTree: {
                name: 'Docs',
                children: [],
            },
            page: {
                path: 'index',
                title: 'Docs',
                toc: [],
            },
        } as unknown as PublicDocsRouteData;

        expect(toDocsRouteResult(docsData)).toStrictEqual({ type: 'page', data: docsData });
        expect(toDocsRouteResult(undefined)).toStrictEqual({ type: 'not-found' });
    });
});

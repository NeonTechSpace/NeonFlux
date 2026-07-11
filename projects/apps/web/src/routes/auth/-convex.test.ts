import { describe, expect, it, vi } from 'vitest';

import { getRouter } from '../../router.js';

vi.mock('../../components/docs-page.js', () => ({
    PublicDocsPage: () => null,
}));

describe('Convex auth endpoint routing', () => {
    it.each(['/.well-known/jwks.json', '/auth/convex/token'] as const)(
        'registers %s as a GET endpoint in the application router',
        (path) => {
            const router = getRouter();
            const route = router.routesByPath[path];
            const handlers = route.options.server?.handlers;

            expect(route.fullPath).toBe(path);
            expect(route.id).toBe(path);
            expect(handlers).toBeTypeOf('object');

            if (!handlers || typeof handlers === 'function') {
                throw new Error(`Expected ${path} to expose static server handlers.`);
            }

            expect(handlers.GET).toEqual(expect.any(Function));
        }
    );
});

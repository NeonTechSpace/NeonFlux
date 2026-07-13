import { isRedirect } from '@tanstack/react-router';
import { describe, expect, it } from 'vitest';

import { Route as StructureIndexRoute } from './routes/dashboard/$guildId/structure/index.js';

describe('dashboard structure navigation', () => {
    it('redirects the Blueprint root to the safe read-only Overview surface', () => {
        const beforeLoad = StructureIndexRoute.options.beforeLoad;
        let thrown: unknown;

        if (!beforeLoad) throw new Error('Expected the Blueprint index route to define beforeLoad.');

        try {
            beforeLoad({ params: { guildId: 'guild-1' } } as Parameters<typeof beforeLoad>[0]);
        } catch (error) {
            thrown = error;
        }

        expect(isRedirect(thrown)).toBe(true);
        expect(readRedirectOptions(thrown)).toMatchObject({
            to: '/dashboard/$guildId/structure/current',
            params: { guildId: 'guild-1' },
        });
    });
});

function readRedirectOptions(error: unknown): Record<string, unknown> {
    if (!error || typeof error !== 'object' || !('options' in error)) {
        throw new Error('Expected TanStack Router redirect options.');
    }

    return (error as { options: Record<string, unknown> }).options;
}

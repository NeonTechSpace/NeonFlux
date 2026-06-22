import { createFileRoute } from '@tanstack/react-router';
import { createServerOnlyFn } from '@tanstack/react-start';
import { createFromSource } from 'fumadocs-core/search/server';

import { source } from '../../../lib/source.js';

const createRoute = createFileRoute('/docs/api/search');
const search = createFromSource(source);

const handleDocsSearch = createServerOnlyFn(
    async ({ request }: { request: Request }): Promise<Response> => search.GET(request)
);

export const docsSearchRouteOptions = {
    server: {
        handlers: {
            GET: handleDocsSearch,
        },
    },
} satisfies NonNullable<Parameters<typeof createRoute>[0]>;

export const Route = createRoute(docsSearchRouteOptions);

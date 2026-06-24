import { createFileRoute } from '@tanstack/react-router';
import { createServerOnlyFn } from '@tanstack/react-start';

const createRoute = createFileRoute('/docs/api/search');

const handleDocsSearch = createServerOnlyFn(async ({ request }: { request: Request }): Promise<Response> => {
    const { handlePublicDocsSearchRequest } = await import('../../../server/docs-search.server.js');

    return handlePublicDocsSearchRequest(request);
});

const docsSearchRouteOptions = {
    server: {
        handlers: {
            GET: handleDocsSearch,
        },
    },
} satisfies NonNullable<Parameters<typeof createRoute>[0]>;

export const Route = createRoute(docsSearchRouteOptions);

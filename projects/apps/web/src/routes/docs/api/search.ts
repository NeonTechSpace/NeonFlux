import { createFileRoute } from '@tanstack/react-router';
import { createServerOnlyFn } from '@tanstack/react-start';

const handleDocsSearch = createServerOnlyFn(async ({ request }: { request: Request }): Promise<Response> => {
    const { handlePublicDocsSearchRequest } = await import('../../../server/docs-search.server.js');

    return handlePublicDocsSearchRequest(request);
});

export const Route = createFileRoute('/docs/api/search')({
    server: {
        handlers: {
            GET: handleDocsSearch,
        },
    },
});

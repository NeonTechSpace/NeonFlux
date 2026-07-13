import { createFileRoute } from '@tanstack/react-router';

import { PublicDocsPage } from '../../../components/docs-page.js';
import { loadDocsRouteData, resolveDocsRouteResult } from '../../../server/docs-route-data.js';

export const Route = createFileRoute('/docs/topic/')({
    loader: async () => resolveDocsRouteResult(await loadDocsRouteData({ data: { slugs: [] } })),
    component: DocsTopicIndexPageRoute,
});

function DocsTopicIndexPageRoute() {
    const data = Route.useLoaderData();

    return <PublicDocsPage data={data} />;
}

import { createFileRoute } from '@tanstack/react-router';

import { PublicDocsPage } from '../../../components/docs-page.js';
import { loadDocsRouteData, resolveDocsRouteResult } from '../../docs.js';

const createRoute = createFileRoute('/docs/topic/');

export const docsTopicIndexRouteOptions = {
    loader: async () => resolveDocsRouteResult(await loadDocsRouteData({ data: { slugs: [] } })),
    component: DocsTopicIndexPageRoute,
} satisfies NonNullable<Parameters<typeof createRoute>[0]>;

export const Route = createRoute(docsTopicIndexRouteOptions);

function DocsTopicIndexPageRoute() {
    const data = Route.useLoaderData();

    return <PublicDocsPage data={data} />;
}

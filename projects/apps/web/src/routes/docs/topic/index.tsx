import { createFileRoute } from '@tanstack/react-router';
import { Suspense, lazy } from 'react';

import { DocsRouteLoading } from '../../../components/docs-loading.js';
import { loadDocsRouteData, resolveDocsRouteResult } from '../../../server/docs-route-data.js';

const createRoute = createFileRoute('/docs/topic/');
const PublicDocsPage = lazy(async () => {
    const module = await import('../../../components/docs-page.js');

    return { default: module.PublicDocsPage };
});

const docsTopicIndexRouteOptions = {
    loader: async () => resolveDocsRouteResult(await loadDocsRouteData({ data: { slugs: [] } })),
    pendingComponent: DocsRouteLoading,
    component: DocsTopicIndexPageRoute,
} satisfies NonNullable<Parameters<typeof createRoute>[0]>;

export const Route = createRoute(docsTopicIndexRouteOptions);

function DocsTopicIndexPageRoute() {
    const data = Route.useLoaderData();

    return (
        <Suspense fallback={<DocsRouteLoading />}>
            <PublicDocsPage data={data} />
        </Suspense>
    );
}

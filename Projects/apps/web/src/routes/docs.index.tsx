import { createFileRoute } from '@tanstack/react-router';
import { Suspense, lazy } from 'react';

import { DocsRouteLoading } from '../components/docs-loading.js';
import { loadDocsRouteData, resolveDocsRouteResult } from '../server/docs-route-data.js';

const createRoute = createFileRoute('/docs/');
const PublicDocsPage = lazy(async () => {
    const module = await import('../components/docs-page.js');

    return { default: module.PublicDocsPage };
});

const docsIndexRouteOptions = {
    loader: async () => resolveDocsRouteResult(await loadDocsRouteData({ data: { slugs: [] } })),
    pendingComponent: DocsRouteLoading,
    component: DocsIndexPageRoute,
} satisfies NonNullable<Parameters<typeof createRoute>[0]>;

export const Route = createRoute(docsIndexRouteOptions);

function DocsIndexPageRoute() {
    const data = Route.useLoaderData();

    return (
        <Suspense fallback={<DocsRouteLoading />}>
            <PublicDocsPage data={data} />
        </Suspense>
    );
}

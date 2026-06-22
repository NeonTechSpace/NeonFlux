import { createFileRoute } from '@tanstack/react-router';

import { PublicDocsPage } from '../components/docs-page.js';
import { loadDocsRouteData, resolveDocsRouteResult } from './docs.js';

const createRoute = createFileRoute('/docs/');

export const docsIndexRouteOptions = {
    loader: async () => resolveDocsRouteResult(await loadDocsRouteData({ data: { slugs: [] } })),
    component: DocsIndexPageRoute,
} satisfies NonNullable<Parameters<typeof createRoute>[0]>;

export const Route = createRoute(docsIndexRouteOptions);

function DocsIndexPageRoute() {
    const data = Route.useLoaderData();

    return <PublicDocsPage data={data} />;
}

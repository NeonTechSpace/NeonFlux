import { createFileRoute } from '@tanstack/react-router';

import { PublicDocsPage } from '../../../components/docs-page.js';
import { getDocsSlugs, loadDocsRouteData, resolveDocsRouteResult } from '../../../server/docs-route-data.js';

const createRoute = createFileRoute('/docs/topic/$');

const docsRouteOptions = {
    loader: async ({ params }) =>
        resolveDocsRouteResult(await loadDocsRouteData({ data: { slugs: getDocsSlugs(params) } })),
    component: DocsPageRoute,
} satisfies NonNullable<Parameters<typeof createRoute>[0]>;

export const Route = createRoute(docsRouteOptions);

function DocsPageRoute() {
    const data = Route.useLoaderData();

    return <PublicDocsPage data={data} />;
}

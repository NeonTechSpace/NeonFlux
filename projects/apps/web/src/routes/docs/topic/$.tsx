import { createFileRoute } from '@tanstack/react-router';

import { PublicDocsPage } from '../../../components/docs-page.js';
import { getDocsSlugs, loadDocsRouteData, resolveDocsRouteResult } from '../../../server/docs-route-data.js';

export const Route = createFileRoute('/docs/topic/$')({
    loader: async ({ params }) =>
        resolveDocsRouteResult(await loadDocsRouteData({ data: { slugs: getDocsSlugs(params) } })),
    component: DocsPageRoute,
});

function DocsPageRoute() {
    const data = Route.useLoaderData();

    return <PublicDocsPage data={data} />;
}

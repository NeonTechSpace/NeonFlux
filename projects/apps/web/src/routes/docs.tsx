import { createFileRoute } from '@tanstack/react-router';

import { DocsRouteLayoutContent } from '../components/docs-route-layout.js';
import { loadDocsShellRouteData } from '../server/docs-route-data.js';

export const Route = createFileRoute('/docs')({
    loader: () => loadDocsShellRouteData(),
    component: DocsRouteLayout,
});

function DocsRouteLayout() {
    const data = Route.useLoaderData();

    return <DocsRouteLayoutContent data={data} />;
}

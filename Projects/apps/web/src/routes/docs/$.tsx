import { createFileRoute } from '@tanstack/react-router';

import { PublicDocsPage } from '../../components/docs-page.js';
import { loadDocsRouteData, resolveDocsRouteResult } from '../docs.js';

const createRoute = createFileRoute('/docs/$');

export const docsRouteOptions = {
    loader: async ({ params }) =>
        resolveDocsRouteResult(await loadDocsRouteData({ data: { slugs: getDocsSlugs(params) } })),
    component: DocsPageRoute,
} satisfies NonNullable<Parameters<typeof createRoute>[0]>;

export const Route = createRoute(docsRouteOptions);

function DocsPageRoute() {
    const data = Route.useLoaderData();

    return <PublicDocsPage data={data} />;
}

function getDocsSlugs(params: unknown): string[] {
    if (!params || typeof params !== 'object') {
        return [];
    }

    const splat = (params as Record<string, unknown>)._splat;

    return typeof splat === 'string' ? splat.split('/').filter(Boolean) : [];
}

import { createFileRoute, notFound, Outlet } from '@tanstack/react-router';
import { createServerFn } from '@tanstack/react-start';

import type { PublicDocsRouteData } from '../server/docs.server.js';

const createRoute = createFileRoute('/docs');

export type DocsRouteResult =
    | {
          type: 'page';
          data: PublicDocsRouteData;
      }
    | {
          type: 'not-found';
      };

type DocsRouteInput = {
    slugs: string[];
};

export function toDocsRouteResult(data: PublicDocsRouteData | undefined): DocsRouteResult {
    return data ? { type: 'page', data } : { type: 'not-found' };
}

export function resolveDocsRouteResult(routeResult: DocsRouteResult): PublicDocsRouteData {
    switch (routeResult.type) {
        case 'page':
            return routeResult.data;

        case 'not-found':
            throw notFound();
    }
}

export const loadDocsRouteData = createServerFn({ method: 'GET' })
    .validator(validateDocsRouteInput)
    .handler(async ({ data }) => {
        const { loadPublicDocsRouteData } = await import('../server/docs.server.js');

        return toDocsRouteResult(await loadPublicDocsRouteData(data.slugs));
    });

export const docsIndexRouteOptions = {
    component: DocsRouteLayout,
} satisfies NonNullable<Parameters<typeof createRoute>[0]>;

export const Route = createRoute(docsIndexRouteOptions);

function DocsRouteLayout() {
    return <Outlet />;
}

function validateDocsRouteInput(input: unknown): DocsRouteInput {
    if (!input || typeof input !== 'object') {
        return { slugs: [] };
    }

    const slugs = (input as Record<string, unknown>).slugs;

    if (!Array.isArray(slugs)) {
        return { slugs: [] };
    }

    return {
        slugs: slugs.filter((slug): slug is string => typeof slug === 'string' && slug.length > 0),
    };
}

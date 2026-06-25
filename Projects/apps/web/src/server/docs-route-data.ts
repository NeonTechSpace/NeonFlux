import { notFound } from '@tanstack/react-router';
import { createServerFn } from '@tanstack/react-start';

import type { PublicDocsRouteData, PublicDocsShellData } from './docs.server.js';

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

export const loadDocsShellRouteData = createServerFn({ method: 'GET' }).handler(
    async (): Promise<PublicDocsShellData> => {
        const { loadPublicDocsShellData } = await import('./docs.server.js');

        return loadPublicDocsShellData();
    }
);

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
        const { loadPublicDocsRouteData } = await import('./docs.server.js');

        return toDocsRouteResult(await loadPublicDocsRouteData(data.slugs));
    });

export function getDocsSlugs(params: unknown): string[] {
    if (!params || typeof params !== 'object') {
        return [];
    }

    const splat = (params as Record<string, unknown>)._splat;

    return typeof splat === 'string' ? splat.split('/').filter(Boolean) : [];
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

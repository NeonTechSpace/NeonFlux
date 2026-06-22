import '@tanstack/react-start/server-only';

import type { SerializedPageTree } from 'fumadocs-core/source/client';
import { source } from '../lib/source.js';

export type PublicDocsTocItem = {
    title: string;
    url: string;
    depth: number;
    _step?: number;
};

export type PublicDocsRouteData = {
    pageTree: SerializedPageTree;
    page: {
        path: string;
        title: string;
        description?: string;
        toc: PublicDocsTocItem[];
    };
};

export async function loadPublicDocsRouteData(slugs: string[]): Promise<PublicDocsRouteData | undefined> {
    const page = source.getPage(slugs);

    if (!page) {
        return undefined;
    }

    return {
        pageTree: await source.serializePageTree(source.pageTree),
        page: {
            path: page.path,
            title: page.data.title,
            description: page.data.description,
            toc: serializeTableOfContents(page.data.toc),
        },
    };
}

function serializeTableOfContents(toc: unknown): PublicDocsTocItem[] {
    if (!Array.isArray(toc)) {
        return [];
    }

    return toc.flatMap((item): PublicDocsTocItem[] => {
        if (!item || typeof item !== 'object') {
            return [];
        }

        const record = item as Record<string, unknown>;
        const title = serializeTocTitle(record.title);

        if (!title || typeof record.url !== 'string' || typeof record.depth !== 'number') {
            return [];
        }

        return [
            {
                title,
                url: record.url,
                depth: record.depth,
                ...(typeof record._step === 'number' ? { _step: record._step } : {}),
            },
        ];
    });
}

function serializeTocTitle(title: unknown): string | undefined {
    switch (typeof title) {
        case 'string':
            return title;

        case 'number':
        case 'bigint':
            return String(title);

        default:
            return undefined;
    }
}

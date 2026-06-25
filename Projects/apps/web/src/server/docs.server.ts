import '@tanstack/react-start/server-only';

import type { SerializedPageTree } from 'fumadocs-core/source/client';
import type { PublicDocsTocItem } from './docs-toc.js';
import { source } from '../lib/source.js';
import { serializeTableOfContents } from './docs-toc.js';

export type PublicDocsRouteData = {
    pageTree: SerializedPageTree;
    page: {
        path: string;
        title: string;
        description?: string;
        toc: PublicDocsTocItem[];
    };
};

export type PublicDocsShellData = {
    pageTree: SerializedPageTree;
};

export async function loadPublicDocsShellData(): Promise<PublicDocsShellData> {
    return {
        pageTree: await source.serializePageTree(source.pageTree),
    };
}

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

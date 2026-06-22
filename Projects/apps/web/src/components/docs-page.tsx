import browserCollections from 'collections/browser';
import { useFumadocsLoader } from 'fumadocs-core/source/client';
import { DocsLayout } from 'fumadocs-ui/layouts/docs';
import { DocsBody, DocsDescription, DocsPage, DocsTitle } from 'fumadocs-ui/layouts/docs/page';
import { Suspense } from 'react';
import type { ComponentType } from 'react';
import type { MDXComponents } from 'mdx/types';

import { docsLayoutOptions } from '../lib/docs-layout.js';
import type { PublicDocsRouteData } from '../server/docs.server.js';
import { getMDXComponents } from './mdx.js';

type DocsContentProps = {
    components: MDXComponents;
};

const docsContent = browserCollections.docs.createClientLoader<DocsContentProps>({
    id: 'neonflux-docs',
    component: (loaded, props) => {
        const Content = loaded.default as ComponentType<DocsContentProps>;

        return <Content components={props.components} />;
    },
});

export function PublicDocsPage({ data }: { data: PublicDocsRouteData }) {
    const { pageTree } = useFumadocsLoader({ pageTree: data.pageTree });

    return (
        <DocsLayout tree={pageTree} {...docsLayoutOptions}>
            <DocsPage toc={data.page.toc}>
                <DocsTitle>{data.page.title}</DocsTitle>
                <DocsDescription>{data.page.description}</DocsDescription>
                <DocsBody>
                    <Suspense fallback={<p>Loading documentation...</p>}>
                        {docsContent.useContent(data.page.path, { components: getMDXComponents() })}
                    </Suspense>
                </DocsBody>
            </DocsPage>
        </DocsLayout>
    );
}

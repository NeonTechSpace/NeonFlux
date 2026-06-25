import browserCollections from 'collections/browser';
import { DocsBody, DocsDescription, DocsPage, DocsTitle } from 'fumadocs-ui/layouts/docs/page';
import { Suspense } from 'react';
import type { ComponentType } from 'react';
import type { MDXComponents } from 'mdx/types';

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
    return (
        <DocsPage toc={data.page.toc}>
            <DocsTitle className='mt-0'>{data.page.title}</DocsTitle>
            <DocsDescription>{data.page.description}</DocsDescription>
            <DocsBody>
                <Suspense fallback={<DocsContentSkeleton />}>
                    {docsContent.useContent(data.page.path, { components: getMDXComponents() })}
                </Suspense>
            </DocsBody>
        </DocsPage>
    );
}

function DocsContentSkeleton() {
    return (
        <div className='mt-6 space-y-5' role='status' aria-label='Loading documentation content'>
            <span className='sr-only'>Loading documentation content</span>
            <div className='h-4 w-full max-w-2xl animate-pulse rounded bg-neutral-900' />
            <div className='h-4 w-11/12 max-w-2xl animate-pulse rounded bg-neutral-900' />
            <div className='h-4 w-3/4 max-w-xl animate-pulse rounded bg-neutral-900' />
            <div className='pt-4'>
                <div className='h-9 w-full max-w-lg animate-pulse rounded-md bg-neutral-950 ring-1 ring-neutral-900' />
            </div>
        </div>
    );
}

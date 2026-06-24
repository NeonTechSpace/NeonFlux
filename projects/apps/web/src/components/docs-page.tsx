import browserCollections from 'collections/browser';
import { useFumadocsLoader } from 'fumadocs-core/source/client';
import { DocsLayout } from 'fumadocs-ui/layouts/docs';
import { DocsBody, DocsDescription, DocsPage, DocsTitle } from 'fumadocs-ui/layouts/docs/page';
import { Container as DocsLayoutContainer } from 'fumadocs-ui/layouts/docs/slots/container';
import { Suspense } from 'react';
import type { ComponentProps, ComponentType } from 'react';
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
        <DocsLayout tree={pageTree} {...docsLayoutOptions} slots={{ container: DocsShellContainer }}>
            <DocsPage toc={data.page.toc}>
                <DocsTitle className='mt-0'>{data.page.title}</DocsTitle>
                <DocsDescription>{data.page.description}</DocsDescription>
                <DocsBody>
                    <Suspense fallback={<DocsContentSkeleton />}>
                        {docsContent.useContent(data.page.path, { components: getMDXComponents() })}
                    </Suspense>
                </DocsBody>
            </DocsPage>
        </DocsLayout>
    );
}

function DocsShellContainer({ children, className, ...props }: ComponentProps<'div'>) {
    return (
        <DocsLayoutContainer
            {...props}
            style={{
                backgroundAttachment: 'fixed',
                backgroundImage: [
                    'linear-gradient(90deg, var(--color-fd-background) 0 var(--fd-sidebar-col, 0px), transparent var(--fd-sidebar-col, 0px))',
                    'linear-gradient(180deg, rgba(0, 0, 0, 0.58), rgba(0, 0, 0, 0.62) 45%, rgba(0, 0, 0, 0.78) 100%)',
                    'radial-gradient(ellipse at 48% -12%, rgba(56, 189, 248, 0.24), transparent 42%)',
                    'radial-gradient(ellipse at 82% 8%, rgba(217, 70, 239, 0.22), transparent 36%)',
                    'radial-gradient(ellipse at 30% 22%, rgba(79, 70, 229, 0.22), transparent 42%)',
                    'radial-gradient(ellipse at 68% 62%, rgba(236, 72, 153, 0.12), transparent 42%)',
                    'linear-gradient(145deg, rgba(0, 2, 8, 1), rgba(1, 5, 18, 0.98) 42%, rgba(8, 3, 20, 1) 72%, rgba(0, 1, 6, 1))',
                ].join(','),
                backgroundRepeat: 'no-repeat',
                backgroundSize: 'cover',
                ...props.style,
            }}
            className={['relative isolate overflow-x-clip', className].filter(Boolean).join(' ')}>
            {children}
        </DocsLayoutContainer>
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

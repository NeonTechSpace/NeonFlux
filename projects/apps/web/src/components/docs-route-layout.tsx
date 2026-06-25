import { Outlet } from '@tanstack/react-router';
import { useFumadocsLoader } from 'fumadocs-core/source/client';
import { DocsLayout } from 'fumadocs-ui/layouts/docs';
import { Container as DocsLayoutContainer } from 'fumadocs-ui/layouts/docs/slots/container';
import { RootProvider } from 'fumadocs-ui/provider/tanstack';
import type { ComponentProps } from 'react';

import { docsLayoutOptions } from '../lib/docs-layout.js';
import type { PublicDocsShellData } from '../server/docs.server.js';

export function DocsRouteLayoutContent({ data }: { data: PublicDocsShellData }) {
    const { pageTree } = useFumadocsLoader({ pageTree: data.pageTree });

    return (
        <RootProvider
            search={{ options: { api: '/docs/api/search' } }}
            theme={{
                defaultTheme: 'dark',
                enableSystem: false,
                forcedTheme: 'dark',
            }}>
            <DocsLayout tree={pageTree} {...docsLayoutOptions} slots={{ container: DocsShellContainer }}>
                <Outlet />
            </DocsLayout>
        </RootProvider>
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
                    'linear-gradient(180deg, rgba(0, 0, 0, 0.78), rgba(0, 0, 0, 0.82) 45%, rgba(0, 0, 0, 0.9) 100%)',
                    'radial-gradient(ellipse at 48% -12%, rgba(56, 189, 248, 0.13), transparent 42%)',
                    'radial-gradient(ellipse at 82% 8%, rgba(217, 70, 239, 0.12), transparent 36%)',
                    'radial-gradient(ellipse at 30% 22%, rgba(79, 70, 229, 0.12), transparent 42%)',
                    'radial-gradient(ellipse at 68% 62%, rgba(236, 72, 153, 0.08), transparent 42%)',
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

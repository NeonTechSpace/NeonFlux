import { HeadContent, Scripts, createRootRoute } from '@tanstack/react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Suspense, lazy, useState } from 'react';

import appCss from '../styles.css?url';

const DevelopmentTools = import.meta.env.DEV ? lazy(() => import('../components/development-tools.js')) : undefined;

export const Route = createRootRoute({
    head: () => ({
        meta: [
            {
                charSet: 'utf-8',
            },
            {
                name: 'viewport',
                content: 'width=device-width, initial-scale=1',
            },
            {
                title: 'NeonFlux',
            },
        ],
        links: [
            {
                rel: 'stylesheet',
                href: appCss,
            },
        ],
    }),
    shellComponent: RootDocument,
});

function RootDocument({ children }: { children: React.ReactNode }) {
    const [queryClient] = useState(() => new QueryClient());

    return (
        <html lang='en' className='dark' style={{ colorScheme: 'dark' }} suppressHydrationWarning>
            <head>
                <HeadContent />
            </head>
            <body className='min-h-screen'>
                <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
                {DevelopmentTools ? (
                    <Suspense fallback={null}>
                        <DevelopmentTools />
                    </Suspense>
                ) : null}
                <Scripts />
            </body>
        </html>
    );
}

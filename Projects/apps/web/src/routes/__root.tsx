import { HeadContent, Scripts, createRootRoute } from '@tanstack/react-router';
import { TanStackRouterDevtoolsPanel } from '@tanstack/react-router-devtools';
import { TanStackDevtools } from '@tanstack/react-devtools';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RootProvider } from 'fumadocs-ui/provider/tanstack';
import { useState } from 'react';

import appCss from '../styles.css?url';

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
                <QueryClientProvider client={queryClient}>
                    <RootProvider
                        search={{ options: { api: '/docs/api/search' } }}
                        theme={{
                            defaultTheme: 'dark',
                            enableSystem: false,
                            forcedTheme: 'dark',
                        }}>
                        {children}
                    </RootProvider>
                </QueryClientProvider>
                <TanStackDevtools
                    config={{
                        position: 'bottom-right',
                    }}
                    plugins={[
                        {
                            name: 'Tanstack Router',
                            render: <TanStackRouterDevtoolsPanel />,
                        },
                    ]}
                />
                <Scripts />
            </body>
        </html>
    );
}

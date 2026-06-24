import { Outlet } from '@tanstack/react-router';
import { RootProvider } from 'fumadocs-ui/provider/tanstack';

export function DocsRouteLayoutContent() {
    return (
        <RootProvider
            search={{ options: { api: '/docs/api/search' } }}
            theme={{
                defaultTheme: 'dark',
                enableSystem: false,
                forcedTheme: 'dark',
            }}>
            <Outlet />
        </RootProvider>
    );
}

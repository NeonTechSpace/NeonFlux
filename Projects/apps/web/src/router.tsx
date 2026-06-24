import { createRouter as createTanStackRouter } from '@tanstack/react-router';
import { NotFoundPage } from './components/not-found-page';
import { routeTree } from './routeTree.gen';

export function getRouter() {
    const router = createTanStackRouter({
        routeTree,
        defaultNotFoundComponent: NotFoundPage,
        scrollRestoration: true,
        defaultPreload: 'intent',
        defaultPreloadStaleTime: 0,
    });

    return router;
}

declare module '@tanstack/react-router' {
    interface Register {
        router: ReturnType<typeof getRouter>;
    }
}

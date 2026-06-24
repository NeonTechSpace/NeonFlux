import { createFileRoute } from '@tanstack/react-router';
import { Suspense, lazy } from 'react';

import { DocsRouteLoading } from '../components/docs-loading.js';

const createRoute = createFileRoute('/docs');
const DocsRouteLayoutContent = lazy(async () => {
    const module = await import('../components/docs-route-layout.js');

    return { default: module.DocsRouteLayoutContent };
});

export const Route = createRoute({
    component: DocsRouteLayout,
});

function DocsRouteLayout() {
    return (
        <Suspense fallback={<DocsRouteLoading />}>
            <DocsRouteLayoutContent />
        </Suspense>
    );
}

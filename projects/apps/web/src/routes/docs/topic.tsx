import { Outlet, createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/docs/topic')({
    component: DocsTopicRouteLayout,
});

function DocsTopicRouteLayout() {
    return <Outlet />;
}

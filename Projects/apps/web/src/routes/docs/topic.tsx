import { Outlet, createFileRoute } from '@tanstack/react-router';

const createRoute = createFileRoute('/docs/topic');

export const docsTopicIndexRouteOptions = {
    component: DocsTopicRouteLayout,
} satisfies NonNullable<Parameters<typeof createRoute>[0]>;

export const Route = createRoute(docsTopicIndexRouteOptions);

function DocsTopicRouteLayout() {
    return <Outlet />;
}

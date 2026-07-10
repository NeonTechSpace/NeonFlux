import { Outlet, createFileRoute } from '@tanstack/react-router';

const createRoute = createFileRoute('/dashboard/$guildId/server-blueprint');

export const Route = createRoute({
    component: Outlet,
});

import { Outlet, createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/dashboard/$guildId/server-blueprint')({
    component: Outlet,
});

import { createFileRoute } from '@tanstack/react-router';
import { createServerOnlyFn } from '@tanstack/react-start';

const handleLogout = createServerOnlyFn(async ({ request }: { request: Request }): Promise<Response> => {
    const { handleLogoutRequest } = await import('../../server/logout.server.js');

    return handleLogoutRequest(request);
});

export const Route = createFileRoute('/auth/logout')({
    server: {
        handlers: {
            POST: handleLogout,
        },
    },
});

import { createFileRoute } from "@tanstack/react-router"
import { authRoute } from "../server/auth-runtime"
export const Route = createFileRoute("/api/session")({
    // DELETE signs out here, because the refresh cookie the sign-out revokes is sent only to this path
    server: {
        handlers: {
            POST: ({ request }) => authRoute("session", request),
            DELETE: ({ request }) => authRoute("logout", request),
        },
    },
})

import { createFileRoute } from '@tanstack/react-router'
import { authRoute } from '../server/auth-runtime'
export const Route = createFileRoute('/auth/logout')({ server: { handlers: { POST: ({ request }) => authRoute('logout', request) } } })

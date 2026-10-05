import { createFileRoute } from '@tanstack/react-router'
import { authRoute } from '../server/auth-runtime'
export const Route = createFileRoute('/api/session')({ server: { handlers: { POST: ({ request }) => authRoute('session', request) } } })

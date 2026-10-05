import { createFileRoute } from '@tanstack/react-router'
import { authRoute } from '../server/auth-runtime'
export const Route = createFileRoute('/auth/fluxer/callback')({ server: { handlers: { GET: ({ request }) => authRoute('callback', request) } } })

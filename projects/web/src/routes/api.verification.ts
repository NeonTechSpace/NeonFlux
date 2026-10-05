import { createFileRoute } from '@tanstack/react-router'
import { verificationRoute } from '../server/verification'
export const Route = createFileRoute('/api/verification')({ server: { handlers: { POST: ({ request }) => verificationRoute(request) } } })

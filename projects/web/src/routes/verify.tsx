import { createFileRoute } from '@tanstack/react-router'
import { VerificationPage } from '../verification-page'

export const Route = createFileRoute('/verify')({
  validateSearch: (search: Record<string,unknown>) => ({ token: typeof search.token === 'string' && /^[a-f0-9]{32}$/.test(search.token) ? search.token : '' }),
  head: () => ({ meta: [{ name: 'referrer', content: 'no-referrer' }, { name: 'robots', content: 'noindex, nofollow' }] }),
  component: () => <VerificationPage token={Route.useSearch().token} />,
})

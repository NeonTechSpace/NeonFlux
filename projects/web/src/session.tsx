import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import type { ReactNode } from 'react'
import type { WebSession } from './dashboard-api'

export function SessionProvider({ children }: { children: ReactNode }) {
  const [client] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: false } } }))
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}
export function useSession() {
  return useQuery<WebSession | null>({ queryKey: ['session'], queryFn: async () => {
    const response = await fetch('/api/session', { method: 'POST', credentials: 'same-origin' })
    if (response.status === 401) return null
    if (!response.ok) throw new Error('Unable to refresh sign-in')
    return response.json() as Promise<WebSession>
  }, refetchInterval: 4 * 60 * 1000, refetchOnWindowFocus: true })
}
export function SignIn() {
  const error = typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('authError')
  return <section className="panel sign-in"><h2>Sign in to continue</h2><p>Use your Fluxer account to manage servers where you are the owner or have Manage Server permission</p>{error && <p className="notice error" role="alert">Sign-in did not complete. Try signing in again</p>}<a className="button" href="/auth/fluxer">Sign in with Fluxer</a></section>
}

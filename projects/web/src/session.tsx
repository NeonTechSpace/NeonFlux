import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import type { ReactNode } from 'react'
import type { WebSession } from './dashboard-api'

export function SessionProvider({ children }: { children: ReactNode }) {
  const [client] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: false } } }))
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}
// Read access lasts five minutes per refresh, so an open tab refreshes in the background too, with a minute of slack for
// browsers that delay timers in hidden tabs. A failed refresh keeps the last session and the next one recovers it
export function useSession() {
  return useQuery<WebSession | null>({ queryKey: ['session'], queryFn: async () => {
    const response = await fetch('/api/session', { method: 'POST', credentials: 'same-origin' })
    if (response.status === 401) return null
    if (!response.ok) throw new Error('Unable to refresh sign-in')
    return response.json() as Promise<WebSession>
  }, refetchInterval: 3 * 60 * 1000, refetchIntervalInBackground: true, refetchOnWindowFocus: true })
}
export function SignIn({ returnTo = '/' }: { returnTo?: string }) {
  const error = typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('authError') : null
  return <section className="panel sign-in"><h2>Sign in to continue</h2><p>Use your Fluxer account to manage servers where you are the owner or have Manage Server permission, or to choose your roles in servers that use the role picker</p>{error !== null && <p className="notice error" role="alert">{error === 'configuration' ? "Sign-in is not set up correctly on this website. The website's operator can find the setting to fix in its server log" : 'Sign-in did not complete. Try signing in again'}</p>}<a className="button" href={`/auth/fluxer?returnTo=${encodeURIComponent(returnTo)}`}>Sign in with Fluxer</a></section>
}

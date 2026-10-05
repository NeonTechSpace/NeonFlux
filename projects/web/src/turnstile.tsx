import { useEffect, useRef, useState } from 'react'

interface TurnstileOptions {
  sitekey: string
  action: string
  theme: 'dark'
  size: 'flexible' | 'compact'
  callback: (token: string) => void
  'expired-callback': () => void
  'error-callback': () => void
}
interface TurnstileApi {
  ready: (callback: () => void) => void
  render: (container: HTMLElement, options: TurnstileOptions) => string
  reset: (widgetId: string) => void
  remove: (widgetId: string) => void
}
declare global { interface Window { turnstile?: TurnstileApi } }

let scriptPromise: Promise<TurnstileApi> | undefined
// Cloudflare's ready() throws for async scripts, so the API is used once the script has loaded
function loadTurnstile(): Promise<TurnstileApi> {
  if (window.turnstile) return Promise.resolve(window.turnstile)
  if (!scriptPromise) scriptPromise = new Promise<TurnstileApi>((resolve, reject) => {
    const script = document.createElement('script')
    script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'
    script.async = true
    script.defer = true
    script.onload = () => {
      if (window.turnstile) resolve(window.turnstile)
      else { script.remove(); reject(new Error('Browser check unavailable')) }
    }
    script.onerror = () => { script.remove(); reject(new Error('Browser check unavailable')) }
    document.head.appendChild(script)
  }).catch(error => { scriptPromise = undefined; throw error })
  return scriptPromise
}

export function Turnstile({ siteKey, resetKey, onToken }: { siteKey: string, resetKey: number, onToken: (token: string) => void }) {
  const container = useRef<HTMLDivElement>(null), widget = useRef<{ api: TurnstileApi, id: string } | undefined>(undefined)
  const callback = useRef(onToken)
  callback.current = onToken
  const [error, setError] = useState(''), [retry, setRetry] = useState(0)
  useEffect(() => {
    let disposed = false
    callback.current('')
    setError('')
    void loadTurnstile().then(api => {
      if (disposed || !container.current) return
      const id = api.render(container.current, {
        sitekey: siteKey, action: 'verification_start', theme: 'dark', size: container.current.clientWidth < 300 ? 'compact' : 'flexible',
        callback: token => { if (!disposed) { setError(''); callback.current(token) } },
        'expired-callback': () => { if (!disposed) callback.current('') },
        'error-callback': () => { if (!disposed) { callback.current(''); setError('Browser check failed. Try again or request staff assistance') } },
      })
      widget.current = { api, id }
    }).catch(() => { if (!disposed) setError('Browser check could not load. Check your connection and try again') })
    return () => { disposed = true; if (widget.current) { widget.current.api.remove(widget.current.id); widget.current = undefined } }
  }, [siteKey, retry])
  useEffect(() => {
    if (widget.current) { callback.current(''); widget.current.api.reset(widget.current.id) }
  }, [resetKey])
  return <div style={{ marginBlock: 16 }}><div ref={container} />{error && <p className="notice error" role="alert">{error} <button className="secondary" type="button" onClick={() => setRetry(value => value + 1)}>Retry browser check</button></p>}</div>
}

import { useEffect, useState } from 'react'
import type { VerificationView } from '@neonflux/backend/verification-contracts'
import { SessionProvider, SignIn, useSession } from './session'
import { MotionCanvas } from './motion-canvas'
import { Turnstile } from './turnstile'

type VerificationPageView = VerificationView & { turnstileSiteKey?: string }

export function VerificationPage({ token }: { token: string }) { return <SessionProvider><VerificationSession token={token} /></SessionProvider> }
function VerificationSession({ token }: { token: string }) {
  const session = useSession()
  return <main><header className="header"><div><h1>NeonFlux verification</h1><p className="muted">Confirm your server access request</p></div><a href="/">Dashboard</a></header>
    {!token ? <p className="notice error" role="alert">This verification link is invalid. Return to the server and react to the verification panel for a new link</p> : <>
      {session.isPending && <p role="status">Checking sign-in…</p>}
      {session.isError && <p className="notice error" role="alert">Sign-in is temporarily unavailable <button onClick={() => session.refetch()}>Try again</button></p>}
      {session.data === null && <SignIn returnTo={`/verify?token=${token}`} />}
      {session.data && <VerificationChallenge token={token} userName={session.data.user.name} />}
    </>}
  </main>
}
export function VerificationChallenge({ token, userName }: { token: string, userName: string }) {
  const [view, setView] = useState<VerificationPageView>(), [selected, setSelected] = useState<number[]>([]), [busy, setBusy] = useState(false), [error, setError] = useState(''), [final, setFinal] = useState('')
  const [turnstileToken, setTurnstileToken] = useState(''), [turnstileReset, setTurnstileReset] = useState(0)
  const [now, setNow] = useState(Date.now()), [assistanceOpen, setAssistanceOpen] = useState(false)
  async function request(operation: 'inspect' | 'start' | 'answer') {
    if (operation === 'start' && !turnstileToken) return
    setBusy(true); setError('')
    try {
      const response = await fetch('/api/verification', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(operation === 'answer' ? { operation, challengeId: view?.challengeId, selected, round: view?.round } : { operation, linkToken: token, ...(operation === 'start' ? { turnstileToken } : {}) }) })
      if (!response.ok) {
        const body = await response.json().catch(() => ({})) as { error?: string, final?: boolean }
        if (body.final && body.error) { setFinal(body.error); return }
        throw new Error()
      }
      const next = await response.json() as VerificationPageView
      setView(next)
      if (operation !== 'inspect' || next.challengeId !== view?.challengeId || next.status !== view?.status || next.round !== view?.round || next.attemptsRemaining !== view?.attemptsRemaining || next.imageDataUri !== view?.imageDataUri || next.motionFrames !== view?.motionFrames) setSelected([])
    } catch { setError(operation === 'start' ? 'Verification could not start. Complete the browser check again, then retry or request staff assistance' : 'Verification could not complete. Your selections have been kept. Check your account, link and connection, then try again') }
    finally { if (operation === 'start') { setTurnstileToken(''); setTurnstileReset(value => value + 1) }; setBusy(false) }
  }
  useEffect(() => { void request('inspect') }, [token])
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(timer) }, [])
  const remaining = view ? Math.max(0, Math.ceil(((view.status === 'issued' ? view.linkExpiresAt : view.expiresAt) - now) / 1000)) : 0
  const active = view?.status === 'started' && remaining > 0
  const terminal = view && ['failed', 'expired', 'redeemed'].includes(view.status)
  return <section className="panel"><h2>{view?.panelName ?? 'Server verification'}</h2><p className="muted">Signed in as {userName}</p>
    {final && <p className="notice error" role="alert">{final}</p>}
    {!view && !error && !final && <p role="status">Loading your verification request…</p>}
    {view?.status === 'issued' && !final && <><p>Complete the browser check, then start when you are ready. This experimental visual challenge uses moving dots, gives you 90 seconds and allows at most two attempts. If you cannot use motion, request staff assistance below</p>
      {view.turnstileSiteKey ? <Turnstile siteKey={view.turnstileSiteKey} resetKey={turnstileReset} onToken={setTurnstileToken} /> : <p className="notice error" role="alert">Browser verification is not configured. Ask server staff for assistance</p>}
      <button disabled={busy || remaining === 0 || !turnstileToken} onClick={() => request('start')}>{busy ? 'Starting…' : 'Start challenge'}</button></>}
    {view?.status === 'started' && !final && <>
      <p role="status">Round {(view.round ?? 0) + 1} of {view.roundCount}</p>
      <p id="challenge-instruction">{view.instruction}</p><p><strong>{remaining} seconds remaining</strong> · {view.attemptsRemaining} attempts remaining</p>
      <p>Both rounds share this timer. Choose one option per round. Your choices are checked together after round 2</p>
      {active && <MotionCanvas frames={view.motionFrames ?? ''} paused={assistanceOpen} />}
      {view.imageDataUri && <img src={view.imageDataUri} alt="Six shape choices labeled A through F. Choose the shape that appears in the moving dots" className="challenge-image motion-choices-image" />}
      <fieldset className="choice-fieldset" disabled={busy || !active} aria-describedby="challenge-instruction"><legend>Select one shape option</legend><div className="choices">{Array.from({ length: 6 }, (_,index) => <button key={index} type="button" aria-pressed={selected.includes(index)} aria-label={`Option ${String.fromCharCode(65 + index)}`} onClick={() => setSelected([index])}>{`${String.fromCharCode(65 + index)}${selected.includes(index) ? ' ✓' : ''}`}</button>)}</div></fieldset>
      <p role="status">{selected.length ? `Option ${String.fromCharCode(65 + selected[0])} selected` : 'No option selected'}</p><button disabled={busy || !active || selected.length !== 1} onClick={() => request('answer')}>{busy ? 'Checking…' : view.round === 0 ? 'Continue' : 'Submit choices'}</button>
      {!active && <p className="notice" role="alert">The solving window ended. Return to the server and request a new link</p>}
    </>}
    {(view?.status === 'solved' || view?.status === 'redeemed') && !view.deliveryOutcome && <><p className="success" role="status">Challenge accepted. Your access role is pending</p><button disabled={busy} className="secondary" onClick={() => request('inspect')}>Check access status</button></>}
    {view?.deliveryOutcome && <p role="status" className={view.deliveryOutcome === 'succeeded' ? 'success' : 'notice'}>{view.deliveryOutcome === 'succeeded' ? 'Your access role was applied' : 'The challenge passed, but the role could not be applied. Ask server staff for assistance'}</p>}
    {terminal && view.status !== 'redeemed' && <p className="notice" role="alert">This request {view.status === 'expired' ? 'expired' : 'has no attempts remaining'}. Return to the server and react to the verification panel for a new link</p>}
    {error && !final && <p className="notice error" role="alert">{error} <button className="secondary" disabled={busy} onClick={() => request('inspect')}>Try again</button></p>}
    <details style={{ marginTop: 24 }} onToggle={event => setAssistanceOpen(event.currentTarget.open)}><summary>Request staff assistance</summary><p>If you cannot use the visual challenge, contact the server's staff through their available support channel. Staff can review your request using their normal moderation process</p></details>
  </section>
}

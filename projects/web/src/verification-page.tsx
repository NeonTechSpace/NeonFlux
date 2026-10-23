import { useEffect, useState } from "react"
import type { VerificationView } from "@neonflux/backend/verification-contracts"
import { VERIFICATION_SOLVE_TTL, type SparkSample } from "@neonflux/contracts/motion-captcha"
import { SessionProvider, SignIn, useSession } from "./session"
import { MotionCanvas } from "./motion-canvas"
import { Turnstile } from "./turnstile"

type VerificationPageView = VerificationView & { turnstileSiteKey?: string }
const solveSeconds = VERIFICATION_SOLVE_TTL / 1000
const attemptsText = (count: number) => count + (count === 1 ? " attempt" : " attempts")
export function VerificationPage({ token }: { token: string }) {
    return (
        <SessionProvider>
            <VerificationSession token={token} />
        </SessionProvider>
    )
}
function VerificationSession({ token }: { token: string }) {
    const session = useSession()
    return (
        <main className="verification-main">
            <header className="verification-brand">
                <a href="/">NeonFlux</a>
                <span>Server access</span>
            </header>
            {!token ? (
                <section className="panel verification-card">
                    <h1>Server verification</h1>
                    <p className="notice error" role="alert">
                        This verification link is invalid. Return to the server and react to the verification panel for
                        a new link
                    </p>
                </section>
            ) : (
                <>
                    {session.isPending && <p role="status">Checking sign-in…</p>}
                    {session.isError && (
                        <p className="notice error" role="alert">
                            Sign-in is temporarily unavailable{" "}
                            <button onClick={() => session.refetch()}>Try again</button>
                        </p>
                    )}
                    {session.data === null && <SignIn returnTo={"/verify?token=" + token} />}
                    {session.data && <VerificationChallenge token={token} userName={session.data.user.name} />}
                </>
            )}
        </main>
    )
}
export function VerificationChallenge({ token, userName }: { token: string; userName: string }) {
    const [view, setView] = useState<VerificationPageView>(),
        [path, setPath] = useState<SparkSample[]>([]),
        [busy, setBusy] = useState(false),
        [error, setError] = useState(""),
        [final, setFinal] = useState("")
    const [turnstileToken, setTurnstileToken] = useState(""),
        [turnstileReset, setTurnstileReset] = useState(0)
    const [now, setNow] = useState(Date.now()),
        [assistanceOpen, setAssistanceOpen] = useState(false)
    async function request(operation: "inspect" | "start" | "answer", trace = path) {
        if (operation === "start" && !turnstileToken) return
        setBusy(true)
        setError("")
        try {
            const response = await fetch("/api/verification", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(
                    operation === "answer"
                        ? { operation, challengeId: view?.challengeId, path: trace }
                        : { operation, linkToken: token, ...(operation === "start" ? { turnstileToken } : {}) },
                ),
            })
            if (!response.ok) {
                const body = (await response.json().catch(() => ({}))) as { error?: string; final?: boolean }
                if (body.final && body.error) {
                    setFinal(body.error)
                    return
                }
                throw new Error()
            }
            const next = (await response.json()) as VerificationPageView
            setView(next)
            if (
                operation !== "inspect" ||
                next.challengeId !== view?.challengeId ||
                next.status !== view?.status ||
                next.attemptsRemaining !== view?.attemptsRemaining ||
                next.motionFrames !== view?.motionFrames
            )
                setPath([])
        } catch {
            setError(
                operation === "start"
                    ? "Verification could not start. Complete the browser check again, then retry or request staff assistance"
                    : "Verification could not complete. " +
                          (trace.length ? "Your path has been kept. " : "") +
                          "Check your account, link and connection, then try again",
            )
        } finally {
            if (operation === "start") {
                setTurnstileToken("")
                setTurnstileReset((value) => value + 1)
            }
            setBusy(false)
        }
    }
    useEffect(() => {
        void request("inspect")
    }, [token])
    useEffect(() => {
        const timer = window.setInterval(() => setNow(Date.now()), 1000)
        return () => window.clearInterval(timer)
    }, [])
    const remaining = view
        ? Math.max(0, Math.ceil(((view.status === "issued" ? view.linkExpiresAt : view.expiresAt) - now) / 1000))
        : 0
    const expired =
        view?.status === "expired" || ((view?.status === "issued" || view?.status === "started") && remaining === 0)
    const active = view?.status === "started" && !expired && !final,
        solved = view?.status === "solved" || view?.status === "redeemed"
    return (
        <section className="panel verification-card">
            <div className="verification-heading">
                <div>
                    <h1>Server verification</h1>
                    <p className="muted">Signed in as {userName}</p>
                </div>
                {view?.status === "started" && !final && (
                    <div
                        className={"verification-timer" + (remaining <= 15 ? " low" : "")}
                        role="timer"
                        aria-label={remaining + " seconds remaining"}
                    >
                        <svg viewBox="0 0 60 60" aria-hidden="true">
                            <circle className="timer-track" cx="30" cy="30" r="26" />
                            <circle
                                className="timer-value"
                                cx="30"
                                cy="30"
                                r="26"
                                pathLength={solveSeconds}
                                strokeDasharray={solveSeconds}
                                strokeDashoffset={solveSeconds - Math.min(solveSeconds, remaining)}
                            />
                        </svg>
                        <strong>
                            {remaining}
                            <small>sec</small>
                        </strong>
                    </div>
                )}
            </div>
            {final && (
                <p className="notice error" role="alert">
                    {final}
                </p>
            )}
            {!view && !error && !final && <p role="status">Loading your verification request…</p>}
            {view?.status === "issued" && !expired && !final && (
                <>
                    <h2>Guide the spark</h2>
                    <p>
                        Follow the moving current from the start into the goal ring. Drag the spark, or focus the field
                        and use the arrow keys
                    </p>
                    <p className="muted">
                        You get {attemptsText(view.attemptsRemaining)} and {solveSeconds} seconds once you start. If
                        motion is uncomfortable, request staff assistance below
                    </p>
                    {view.turnstileSiteKey ? (
                        <Turnstile
                            siteKey={view.turnstileSiteKey}
                            resetKey={turnstileReset}
                            onToken={setTurnstileToken}
                        />
                    ) : (
                        <p className="notice error" role="alert">
                            Browser verification is not configured. Ask server staff for assistance
                        </p>
                    )}
                    <button
                        className="verification-action"
                        disabled={busy || !turnstileToken}
                        onClick={() => request("start")}
                    >
                        {busy ? "Starting…" : "Start challenge"}
                    </button>
                </>
            )}
            {active && (
                <>
                    <h2>Guide the spark</h2>
                    <p id="challenge-instruction">{view.instruction}</p>
                    <MotionCanvas
                        frames={view.motionFrames ?? ""}
                        paused={assistanceOpen || busy || path.length > 0}
                        resetKey={view.attemptsRemaining}
                        onComplete={(trace) => {
                            setPath(trace)
                            void request("answer", trace)
                        }}
                    />
                    <div className="verification-play-status">
                        <span>{attemptsText(view.attemptsRemaining)} remaining</span>
                        <span role="status">
                            {busy
                                ? "Checking your path…"
                                : path.length
                                  ? "Path ready to submit"
                                  : view.attemptsRemaining < 2
                                    ? "Stay in the current and try again from the start"
                                    : "Stay in the current until you reach the ring"}
                        </span>
                    </div>
                    {path.length > 0 && !busy && (
                        <button className="verification-action" onClick={() => request("answer")}>
                            Submit path again
                        </button>
                    )}
                </>
            )}
            {expired && !final && (
                <div className="verification-result expired" role="alert">
                    <span className="result-mark" aria-hidden="true" />
                    <h2>Time's up</h2>
                    <p>Return to the server and react to the verification panel for a new link</p>
                </div>
            )}
            {view?.status === "failed" && !final && (
                <div className="verification-result" role="alert">
                    <h2>No attempts remaining</h2>
                    <p>
                        Return to the server and react to the verification panel for a new link, or request staff
                        assistance below
                    </p>
                </div>
            )}
            {solved && !final && (
                <div className="verification-result success" role="status">
                    <span className="result-mark" aria-hidden="true">
                        ✓
                    </span>
                    <h2>Verification complete</h2>
                    <p>
                        {view.deliveryOutcome === "succeeded"
                            ? "Your access role was applied"
                            : view.deliveryOutcome === "failed"
                              ? "The challenge passed, but the role could not be applied. Ask server staff for assistance"
                              : "Challenge accepted. Your access role is pending"}
                    </p>
                </div>
            )}
            {solved && !view.deliveryOutcome && (
                <button disabled={busy} className="secondary verification-action" onClick={() => request("inspect")}>
                    Check access status
                </button>
            )}
            {error && !final && (
                <p className="notice error" role="alert">
                    {error}{" "}
                    <button className="secondary" disabled={busy} onClick={() => request("inspect")}>
                        Try again
                    </button>
                </p>
            )}
            <details
                className="verification-assistance"
                onToggle={(event) => setAssistanceOpen(event.currentTarget.open)}
            >
                <summary>Request staff assistance</summary>
                <p>
                    If you cannot use the visual challenge, contact the server's staff through their available support
                    channel. Staff can review your request using their normal moderation process
                </p>
                {view && !solved && !final && (
                    <>
                        <p>
                            Your request reference: <code>{view.challengeId}</code>
                        </p>
                        <p>
                            If you ask the server's staff for help, give them this reference. The server owner or an
                            Administrator can review it with <code>!verify review {view.challengeId}</code>. The prefix
                            may differ if the server changed it
                        </p>
                    </>
                )}
            </details>
        </section>
    )
}

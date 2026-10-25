import assert from "node:assert/strict"
import { test } from "node:test"
import { createHash } from "node:crypto"
import { ConvexError } from "convex/values"
import { createAuthHandlers, discoverProvider } from "../src/server/auth.ts"
import { readWebSettings } from "../src/server/auth-runtime.ts"
import type { AuthDependencies } from "../src/server/auth.ts"

const origin = "http://localhost:3000"
const session = {
    sessionToken: "synthetic-session-capability",
    user: { id: "1", name: "Test user" },
    mode: "single" as const,
    servers: [{ id: "2", name: "Test server", icon: null }],
    expiresAt: 400000,
}
function fixture(overrides: Partial<AuthDependencies> = {}) {
    const calls: Array<{ url: string; init?: RequestInit | undefined }> = []
    const admitted: string[] = []
    const deps: AuthDependencies = {
        config: {
            origin,
            clientId: "synthetic-client-id",
            clientSecret: "synthetic-client-secret",
            convexUrl: "https://synthetic.convex.cloud",
            sessionSecret: "synthetic-handshake-key-longer-than-thirty-two",
        },
        now: () => 100000,
        fetch: (async (url: string | URL | Request, init?: RequestInit) => {
            calls.push({ url: String(url), init })
            return String(url).endsWith("/.well-known/fluxer")
                ? Response.json({ endpoints: { api_public: "https://api.fluxer.app" } })
                : Response.json({
                      access_token: "synthetic-provider-token",
                      token_type: "bearer",
                      scope: "identify guilds",
                  })
        }) as typeof fetch,
        admit: async (token) => {
            admitted.push(token)
            return session
        },
        refresh: async () => session,
        rotate: async () => null,
        logout: async () => null,
        ...overrides,
    }
    return { handlers: createAuthHandlers(deps), calls, admitted, config: deps.config, deps }
}
async function begin(f: ReturnType<typeof fixture>, suffix = "") {
    const response = await f.handlers.begin(new Request(`${origin}/auth/fluxer${suffix}`))
    const location = new URL(response.headers.get("location")!)
    const cookie = response.headers.getSetCookie()[0]!.split(";")[0]!
    return { response, location, cookie }
}
test("OAuth uses bound state, S256 PKCE and exact callback, and keeps provider credentials off returned session", async () => {
    const f = fixture(),
        started = await begin(f, "?returnTo=%2Fverify%3Ftoken%3D" + "a".repeat(32))
    assert.equal(started.location.searchParams.get("scope"), "identify guilds")
    assert.equal(started.location.origin + started.location.pathname, "https://api.fluxer.app/v1/oauth2/authorize")
    assert.equal(started.location.searchParams.get("code_challenge_method"), "S256")
    assert.equal(started.location.searchParams.get("redirect_uri"), `${origin}/auth/fluxer/callback`)
    assert.match(started.response.headers.getSetCookie()[0]!, /HttpOnly; SameSite=Lax; Max-Age=600/)
    const response = await f.handlers.callback(
        new Request(
            `${origin}/auth/fluxer/callback?code=synthetic-code&state=${started.location.searchParams.get("state")}`,
            { headers: { cookie: started.cookie } },
        ),
    )
    assert.equal(response.headers.get("location"), `/verify?token=${"a".repeat(32)}`)
    assert.equal(f.calls[2]?.url, "https://api.fluxer.app/v1/oauth2/token")
    const body = f.calls[2]!.init!.body as URLSearchParams
    assert.equal(
        createHash("sha256").update(body.get("code_verifier")!).digest("base64url"),
        started.location.searchParams.get("code_challenge"),
    )
    assert.deepEqual(f.admitted, ["synthetic-provider-token"])
    assert.equal(
        response.headers.getSetCookie().some((cookie) => cookie.includes("synthetic-provider-token")),
        false,
    )
    const exposed = await f.handlers.session(
        new Request(`${origin}/api/session`, {
            method: "POST",
            headers: { origin, cookie: "neonflux_session=synthetic-session-capability" },
        }),
    )
    assert.equal(exposed.status, 200)
    assert.equal(exposed.headers.get("cache-control"), "no-store")
    const data = await exposed.json()
    assert.equal(data.sessionToken, session.sessionToken)
    assert.equal(JSON.stringify(data).includes("synthetic-provider-token"), false)
    assert.equal(JSON.stringify(data).includes("synthetic-client-secret"), false)
})
test("Wrong state, tampered or expired handshake never exchanges a code", async () => {
    for (const kind of ["state", "tampered", "expired"]) {
        const f = fixture(),
            started = await begin(f)
        const target = kind === "expired" ? fixture({ now: () => 800001 }) : f
        const response = await target.handlers.callback(
            new Request(
                `${origin}/auth/fluxer/callback?code=synthetic-code&state=${kind === "state" ? "wrong" : started.location.searchParams.get("state")}`,
                { headers: { cookie: started.cookie + (kind === "tampered" ? "tampered" : "") } },
            ),
        )
        assert.equal(response.headers.get("location"), "/?authError=state")
        assert.equal(target.calls.filter((call) => call.url.endsWith("/oauth2/token")).length, 0)
    }
})
test("Signing in again returns to a dashboard section link, and other paths fall back to the dashboard", async () => {
    for (const [returnTo, expected] of [
        ["/?server=12&section=rolepicker", "/?server=12&section=rolepicker"],
        ["/?section=logs", "/?section=logs"],
        ["/?server=12&section=logs&next=https://outside.invalid", "/"],
        ["//outside.invalid/?server=12", "/"],
    ] as const) {
        const f = fixture(),
            started = await begin(f, `?returnTo=${encodeURIComponent(returnTo)}`)
        const response = await f.handlers.callback(
            new Request(`${origin}/auth/fluxer/callback?code=x&state=${started.location.searchParams.get("state")}`, {
                headers: { cookie: started.cookie },
            }),
        )
        assert.equal(response.headers.get("location"), expected)
    }
})
test("A client secret of another application than the deployment owns gets its own sign-in diagnostic", async (t) => {
    t.mock.method(console, "error", () => {})
    const tokenRefused = (answer: Response) =>
        (async (url: string | URL | Request) =>
            String(url).endsWith("/.well-known/fluxer")
                ? Response.json({ endpoints: { api_public: "https://api.fluxer.app" } })
                : answer.clone()) as typeof fetch
    const mismatch = async () => {
        throw new ConvexError({
            status: 403,
            error: "Sign-in token belongs to another Fluxer application",
            code: "OAUTH_CLIENT_MISMATCH",
        })
    }
    for (const [overrides, expected] of [
        [{ fetch: tokenRefused(Response.json({ error: "invalid_client" }, { status: 401 })) }, "configuration"],
        [{ fetch: tokenRefused(Response.json({ error: "invalid_client" }, { status: 400 })) }, "configuration"],
        [{ admit: mismatch }, "configuration"],
        [{ fetch: tokenRefused(Response.json({ error: "invalid_grant" }, { status: 400 })) }, "unavailable"],
    ] as const) {
        const f = fixture(overrides),
            started = await begin(f)
        const response = await f.handlers.callback(
            new Request(`${origin}/auth/fluxer/callback?code=x&state=${started.location.searchParams.get("state")}`, {
                headers: { cookie: started.cookie },
            }),
        )
        assert.equal(response.headers.get("location"), `/?authError=${expected}`)
    }
})
test("The web environment keeps its own settings and names problems without values", () => {
    const valid = {
        CONVEX_URL: "https://synthetic.convex.cloud",
        FLUXER_CLIENT_SECRET: "synthetic-private-secret",
        WEB_SESSION_SECRET: "x".repeat(32),
    }
    assert.deepEqual(readWebSettings(valid), {
        settings: {
            convexUrl: valid.CONVEX_URL,
            clientSecret: valid.FLUXER_CLIENT_SECRET,
            sessionSecret: valid.WEB_SESSION_SECRET,
            turnstileSiteKey: "",
        },
        problems: [],
    })
    const broken = readWebSettings({ CONVEX_URL: "not a URL", WEB_SESSION_SECRET: "synthetic-private-short" })
    assert.equal(broken.settings, undefined)
    assert.deepEqual(
        broken.problems.map((problem) => /Set (\w+)/.exec(problem)![1]),
        ["CONVEX_URL", "FLUXER_CLIENT_SECRET", "WEB_SESSION_SECRET"],
    )
    assert.equal(JSON.stringify(broken).includes("synthetic-private"), false)
})
test("External return URLs are discarded and provider failure stays private", async () => {
    const f = fixture(),
        started = await begin(f, "?returnTo=https://outside.invalid")
    const success = await f.handlers.callback(
        new Request(`${origin}/auth/fluxer/callback?code=x&state=${started.location.searchParams.get("state")}`, {
            headers: { cookie: started.cookie },
        }),
    )
    assert.equal(success.headers.get("location"), "/")
    const failed = fixture({
        fetch: async () => {
            throw new Error("synthetic-private-error")
        },
    })
    const response = await failed.handlers.callback(
        new Request(`${origin}/auth/fluxer/callback?code=x&state=${started.location.searchParams.get("state")}`, {
            headers: { cookie: started.cookie },
        }),
    )
    assert.equal(response.headers.get("location"), "/?authError=unavailable")
    assert.equal((await response.text()).includes("synthetic-private-error"), false)
    assert.equal(failed.admitted.length, 0)
})
test("Cross-origin session access and sign-out cannot expose or revoke a capability", async () => {
    let revoked = false
    const f = fixture({
        logout: async () => {
            revoked = true
        },
    })
    for (const method of ["session", "logout"] as const) {
        const response = await f.handlers[method](
            new Request(`${origin}/api/session`, {
                method: "POST",
                headers: { origin: "https://outside.invalid", cookie: "neonflux_session=synthetic-session-capability" },
            }),
        )
        assert.equal(response.status, 403)
    }
    assert.equal(revoked, false)
})
test("Transient refresh preserves the cookie, expired authorization clears it, failed sign-out keeps recoverable state", async () => {
    const request = new Request(`${origin}/api/session`, {
        method: "POST",
        headers: { origin, cookie: "neonflux_session=synthetic-session-capability" },
    })
    const transient = await fixture({
        refresh: async () => {
            throw new Error("network")
        },
    }).handlers.session(request)
    assert.equal(transient.status, 503)
    assert.equal(transient.headers.has("set-cookie"), false)
    for (const status of [401, 403]) {
        const expired = await fixture({
            refresh: async () => {
                throw new ConvexError({ status, message: "Expired" })
            },
        }).handlers.session(request)
        assert.equal(expired.status, 401)
        assert.match(expired.headers.get("set-cookie")!, /Max-Age=0/)
    }
    const signOut = await fixture({
        logout: async () => {
            throw new Error("network")
        },
    }).handlers.logout(request)
    assert.equal(signOut.status, 503)
    assert.equal(signOut.headers.has("set-cookie"), false)
})
test("Official discovery allows its exact one-hop HTTPS redirect and rejects other destinations", async () => {
    const calls: string[] = []
    const fetcher = (async (url: string | URL | Request) => {
        calls.push(String(url))
        return calls.length === 1
            ? new Response(null, { status: 308, headers: { location: "https://api.fluxer.app/.well-known/fluxer" } })
            : Response.json({ endpoints: { api_public: "https://api.fluxer.app" } })
    }) as typeof fetch
    assert.equal(await discoverProvider(fetcher), "https://api.fluxer.app")
    assert.equal(calls.length, 2)
    await assert.rejects(
        discoverProvider(
            async () => new Response(null, { status: 308, headers: { location: "https://outside.invalid/discovery" } }),
        ),
    )
})
test("Multi-server sessions carry the bot invite with the derived permissions, and single-server sessions do not", async () => {
    const request = () =>
        new Request(`${origin}/api/session`, {
            method: "POST",
            headers: { origin, cookie: "neonflux_session=synthetic-session-capability" },
        })
    const multi = (await (
        await fixture({ refresh: async () => ({ ...session, mode: "multi" as const }) }).handlers.session(request())
    ).json()) as { inviteUrl?: string }
    const invite = new URL(multi.inviteUrl!)
    assert.equal(invite.origin + invite.pathname, "https://api.fluxer.app/v1/oauth2/authorize")
    assert.deepEqual(
        [...invite.searchParams],
        [
            ["client_id", "synthetic-client-id"],
            ["scope", "bot"],
            ["permissions", "9008694793694454"],
        ],
    )
    const single = (await (await fixture().handlers.session(request())).json()) as { inviteUrl?: string }
    assert.equal(single.inviteUrl, undefined)
})
// A sign-in whose token answers carry refresh tokens, with a clock the test moves and a record of every refresh request.
// Each fixture gets its own refresh token, because the process shares refresh outcomes between handlers
let fixtures = 0
function refreshFixture(
    options: {
        origin?: string
        rotate?: (sessionToken: string, accessToken: string) => Promise<unknown>
        refreshToken?: string
    } = {},
) {
    const clock = { now: 100000 },
        refreshToken = `${options.refreshToken ?? ""}synthetic-refresh-token-${++fixtures}`,
        refreshes: string[] = [],
        rotated: Array<[string, string]> = []
    let answer: (refreshToken: string) => Response = (refreshToken) =>
        Response.json({
            access_token: `synthetic-access-after-${refreshToken}`,
            token_type: "Bearer",
            scope: "identify guilds",
            refresh_token: `${refreshToken}-next`,
            expires_in: 604800,
        })
    const base = fixture()
    const f = fixture({
        ...(options.origin ? { config: { ...base.config, origin: options.origin } } : {}),
        now: () => clock.now,
        fetch: (async (url: string | URL | Request, init?: RequestInit) => {
            if (String(url).endsWith("/.well-known/fluxer"))
                return Response.json({ endpoints: { api_public: "https://api.fluxer.app" } })
            const body = init!.body as URLSearchParams
            if (body.get("grant_type") === "refresh_token") {
                refreshes.push(body.get("refresh_token")!)
                return answer(body.get("refresh_token")!)
            }
            return Response.json({
                access_token: "synthetic-provider-token",
                token_type: "Bearer",
                scope: "identify guilds",
                refresh_token: refreshToken,
                expires_in: 604800,
            })
        }) as typeof fetch,
        rotate:
            options.rotate ??
            (async (sessionToken, accessToken) => {
                rotated.push([sessionToken, accessToken])
                return null
            }),
    })
    return {
        ...f,
        clock,
        refreshToken,
        refreshes,
        rotated,
        answer: (next: typeof answer) => {
            answer = next
        },
    }
}
const cookieNamed = (response: Response, name: string) =>
    response.headers.getSetCookie().find((cookie) => cookie.startsWith(`${name}=`))
async function signIn(f: ReturnType<typeof refreshFixture>) {
    const started = await begin(f)
    const response = await f.handlers.callback(
        new Request(`${origin}/auth/fluxer/callback?code=x&state=${started.location.searchParams.get("state")}`, {
            headers: { cookie: started.cookie },
        }),
    )
    return { response, refresh: cookieNamed(response, "neonflux_refresh")!.split(";")[0]! }
}
const sessionCall = (refresh: string, sessionToken = session.sessionToken) =>
    new Request(`${origin}/api/session`, {
        method: "POST",
        headers: { origin, cookie: `neonflux_session=${sessionToken}; ${refresh}` },
    })
test("Sign-in keeps the session for 90 days and the refresh token only in an encrypted session-refresh cookie", async () => {
    const f = refreshFixture(),
        { response, refresh } = await signIn(f)
    assert.match(cookieNamed(response, "neonflux_session")!, /Path=\/; HttpOnly; SameSite=Lax; Max-Age=7776000$/)
    assert.match(
        cookieNamed(response, "neonflux_refresh")!,
        /^neonflux_refresh=[\w-]+; Path=\/api\/session; HttpOnly; SameSite=Strict; Max-Age=7776000$/,
    )
    assert.equal(response.headers.getSetCookie().join().includes(f.refreshToken), false)
    // A week of access token left needs no refresh
    const fresh = await f.handlers.session(sessionCall(refresh))
    assert.equal(fresh.status, 200)
    assert.deepEqual([f.refreshes, cookieNamed(fresh, "neonflux_refresh")], [[], undefined])
    assert.equal(JSON.stringify(await fresh.json()).includes(f.refreshToken), false)
    // HTTPS origins mark the cookie Secure
    const secure = refreshFixture({ origin: "https://dashboard.invalid" }),
        started = await secure.handlers.begin(new Request("https://dashboard.invalid/auth/fluxer"))
    const signedIn = await secure.handlers.callback(
        new Request(
            `https://dashboard.invalid/auth/fluxer/callback?code=x&state=${new URL(started.headers.get("location")!).searchParams.get("state")}`,
            { headers: { cookie: started.headers.getSetCookie()[0]!.split(";")[0]! } },
        ),
    )
    assert.match(cookieNamed(signedIn, "neonflux_refresh")!, /; Secure$/)
})
test("A session call with under an hour of access left renews the token once, stores it and keeps the new refresh token", async () => {
    const f = refreshFixture(),
        { refresh } = await signIn(f)
    // Exactly an hour left still needs no refresh
    f.clock.now += 604800000 - 3600000
    await f.handlers.session(sessionCall(refresh))
    assert.deepEqual(f.refreshes, [])
    f.clock.now += 1
    const response = await f.handlers.session(sessionCall(refresh))
    assert.equal(response.status, 200)
    assert.deepEqual(f.refreshes, [f.refreshToken])
    assert.deepEqual(f.rotated, [[session.sessionToken, `synthetic-access-after-${f.refreshToken}`]])
    const renewed = cookieNamed(response, "neonflux_refresh")!
    assert.match(renewed, /Path=\/api\/session; HttpOnly; SameSite=Strict; Max-Age=7174799$/)
    assert.equal(cookieNamed(response, "neonflux_session"), undefined)
    // The new cookie carries the new refresh token and a week of access, so the next call needs no refresh
    f.clock.now += 3600000
    const next = await f.handlers.session(sessionCall(renewed.split(";")[0]!))
    assert.deepEqual([next.status, f.refreshes.length, cookieNamed(next, "neonflux_refresh")], [200, 1, undefined])
    f.clock.now += 604800000 - 3600000 * 2 + 1
    await f.handlers.session(sessionCall(renewed.split(";")[0]!))
    assert.deepEqual(f.refreshes, [f.refreshToken, `${f.refreshToken}-next`])
})
test("A refresh token of any length that fits the browser's cookie is kept, and one that does not fit ends with its access token", async () => {
    // Far past the old limit of 256 characters, and still within the 4096 bytes a browser keeps for one cookie
    const long = refreshFixture({ refreshToken: "a".repeat(2000) }),
        { refresh } = await signIn(long)
    assert.match(refresh, /^neonflux_refresh=[\w-]{2700,4079}$/)
    long.clock.now += 604800000
    const renewed = await long.handlers.session(sessionCall(refresh))
    assert.deepEqual(long.refreshes, [long.refreshToken])
    assert.match(
        cookieNamed(renewed, "neonflux_refresh")!,
        /^neonflux_refresh=[\w-]+; Path=\/api\/session;.*Max-Age=[1-9]/,
    )
    // A token whose encrypted cookie would pass that size gets no cookie at sign-in
    const huge = refreshFixture({ refreshToken: "b".repeat(3100) }),
        started = await begin(huge)
    const signedIn = await huge.handlers.callback(
        new Request(`${origin}/auth/fluxer/callback?code=x&state=${started.location.searchParams.get("state")}`, {
            headers: { cookie: started.cookie },
        }),
    )
    assert.ok(cookieNamed(signedIn, "neonflux_session"))
    assert.match(cookieNamed(signedIn, "neonflux_refresh")!, /^neonflux_refresh=; .*Max-Age=0$/)
    // Fluxer already replaced the old token when it rotates to one that does not fit, so the cookie is cleared, not kept
    const rotated = refreshFixture({ refreshToken: "c".repeat(100) }),
        first = await signIn(rotated)
    rotated.answer(() =>
        Response.json({
            access_token: "synthetic-access-rotated",
            token_type: "Bearer",
            scope: "identify guilds",
            refresh_token: "d".repeat(3100),
            expires_in: 604800,
        }),
    )
    rotated.clock.now += 604800000
    const cleared = await rotated.handlers.session(sessionCall(first.refresh))
    assert.match(cookieNamed(cleared, "neonflux_refresh")!, /^neonflux_refresh=; Path=\/api\/session;.*Max-Age=0$/)
})
test("Concurrent session calls with the same cookie send one refresh and both get the new cookie", async () => {
    const f = refreshFixture(),
        { refresh } = await signIn(f)
    let release!: () => void
    const gate = new Promise<void>((resolve) => (release = resolve))
    const answered: string[] = []
    f.answer((refreshToken) => {
        answered.push(refreshToken)
        return Response.json({
            access_token: "synthetic-access-shared",
            token_type: "Bearer",
            scope: "identify guilds",
            refresh_token: "synthetic-refresh-shared",
            expires_in: 604800,
        })
    })
    const rotate = f.rotated
    f.clock.now += 604800000
    // The first call holds its rotation until the second call has started
    const handlers = createAuthHandlers({
        ...f.deps,
        rotate: async (sessionToken, accessToken) => {
            await gate
            rotate.push([sessionToken, accessToken])
            return null
        },
    })
    const first = handlers.session(sessionCall(refresh)),
        second = handlers.session(sessionCall(refresh))
    release()
    const responses = await Promise.all([first, second])
    assert.deepEqual(answered, [f.refreshToken])
    assert.equal(rotate.length, 1)
    for (const response of responses) {
        assert.equal(response.status, 200)
        assert.ok(cookieNamed(response, "neonflux_refresh")!.length > 40)
    }
    // A call that still carries the old cookie shortly after shares the same outcome instead of spending the old token again
    f.clock.now += 30000
    const late = await handlers.session(sessionCall(refresh))
    assert.deepEqual([late.status, answered.length], [200, 1])
    assert.ok(cookieNamed(late, "neonflux_refresh")!.length > 40)
})
test("A refused refresh token or a gateway failure clears only the refresh cookie, and other failures keep it", async () => {
    const f = refreshFixture(),
        { refresh } = await signIn(f)
    f.clock.now += 604800000
    f.answer(() => Response.json({ error: "temporarily_unavailable" }, { status: 503 }))
    const transient = await f.handlers.session(sessionCall(refresh))
    assert.deepEqual([transient.status, transient.headers.getSetCookie()], [200, []])
    // A later attempt with the same cookie asks Fluxer again once the shared outcome is a minute old
    f.clock.now += 60001
    f.answer(() => Response.json({ error: "invalid_grant" }, { status: 400 }))
    const refused = await f.handlers.session(sessionCall(refresh))
    assert.equal(refused.status, 200)
    assert.equal(f.refreshes.length, 2)
    assert.match(cookieNamed(refused, "neonflux_refresh")!, /^neonflux_refresh=; Path=\/api\/session;.*Max-Age=0$/)
    assert.equal(cookieNamed(refused, "neonflux_session"), undefined)
    assert.deepEqual(f.rotated, [])
    // A gateway error or timeout may hide a token Fluxer already replaced, so it clears the cookie like a lost answer
    for (const status of [502, 504]) {
        const g = refreshFixture(),
            signed = await signIn(g)
        g.clock.now += 604800000
        g.answer(() => new Response("Bad gateway", { status }))
        const gateway = await g.handlers.session(sessionCall(signed.refresh))
        assert.equal(gateway.status, 200)
        assert.match(cookieNamed(gateway, "neonflux_refresh")!, /^neonflux_refresh=; Path=\/api\/session;.*Max-Age=0$/)
    }
})
test("A failed rotation keeps the new refresh token and renews again on the next call", async () => {
    let failures = 1
    const rotated: string[] = []
    const f = refreshFixture({
            rotate: async (_sessionToken, accessToken) => {
                if (failures-- > 0) throw new Error("network")
                rotated.push(accessToken)
                return null
            },
        }),
        { refresh } = await signIn(f)
    f.clock.now += 604800000 - 60000
    const failed = await f.handlers.session(sessionCall(refresh))
    assert.equal(failed.status, 200)
    const kept = cookieNamed(failed, "neonflux_refresh")!.split(";")[0]!
    f.clock.now += 1000
    await f.handlers.session(sessionCall(kept))
    assert.deepEqual(f.refreshes, [f.refreshToken, `${f.refreshToken}-next`])
    assert.deepEqual(rotated, [`synthetic-access-after-${f.refreshToken}-next`])
    // A session the backend ended clears the refresh cookie too
    const ended = refreshFixture({
            rotate: async () => {
                throw new ConvexError({ status: 401, error: "Sign in again" })
            },
        }),
        signedIn = await signIn(ended)
    ended.clock.now += 604800000
    const response = await ended.handlers.session(sessionCall(signedIn.refresh))
    assert.match(cookieNamed(response, "neonflux_refresh")!, /Max-Age=0$/)
})
test("A refresh cookie of another session or a tampered one is ignored", async () => {
    const f = refreshFixture(),
        { refresh } = await signIn(f)
    f.clock.now += 604800000
    const foreign = await f.handlers.session(sessionCall(refresh, "synthetic-other-session"))
    assert.deepEqual([foreign.status, f.refreshes, foreign.headers.getSetCookie()], [200, [], []])
    const value = refresh.slice("neonflux_refresh=".length),
        tampered = `neonflux_refresh=${value.slice(0, -2)}${value.endsWith("AA") ? "BB" : "AA"}`
    const altered = await f.handlers.session(sessionCall(tampered))
    assert.deepEqual([altered.status, f.refreshes], [200, []])
    // Another web server secret cannot read it either
    const other = createAuthHandlers({
        ...f.deps,
        config: { ...f.config, sessionSecret: "synthetic-other-key-longer-than-thirty-two" },
    })
    await other.session(sessionCall(refresh))
    assert.deepEqual(f.refreshes, [])
})
test("Sign-out and an ended session clear both cookies, and a sign-in without a refresh token stores none", async () => {
    const f = refreshFixture(),
        { refresh } = await signIn(f)
    const signOut = await f.handlers.logout(sessionCall(refresh))
    assert.match(cookieNamed(signOut, "neonflux_session")!, /Max-Age=0/)
    assert.match(cookieNamed(signOut, "neonflux_refresh")!, /^neonflux_refresh=; Path=\/api\/session;.*Max-Age=0$/)
    const ended = await fixture({
        refresh: async () => {
            throw new ConvexError({ status: 401, message: "Expired" })
        },
    }).handlers.session(sessionCall(refresh))
    assert.equal(ended.status, 401)
    assert.match(cookieNamed(ended, "neonflux_session")!, /Max-Age=0/)
    assert.match(cookieNamed(ended, "neonflux_refresh")!, /Max-Age=0/)
    const plain = fixture(),
        started = await begin(plain)
    const response = await plain.handlers.callback(
        new Request(`${origin}/auth/fluxer/callback?code=x&state=${started.location.searchParams.get("state")}`, {
            headers: { cookie: started.cookie },
        }),
    )
    assert.match(cookieNamed(response, "neonflux_refresh")!, /^neonflux_refresh=; .*Max-Age=0$/)
})
test("A refresh whose answer is lost is never sent again, and one that never left is tried again", async () => {
    for (const lost of [
        () => {
            throw new TypeError("fetch failed")
        },
        () => new Response("{", { status: 200, headers: { "content-type": "application/json" } }),
        () => Response.json({ token_type: "Bearer" }),
    ]) {
        const f = refreshFixture(),
            { refresh } = await signIn(f)
        f.clock.now += 604800000 - 60000
        f.answer(lost)
        const first = await f.handlers.session(sessionCall(refresh))
        assert.equal(first.status, 200)
        assert.match(cookieNamed(first, "neonflux_refresh")!, /^neonflux_refresh=; Path=\/api\/session;.*Max-Age=0$/)
        // The browser keeps what the answer set, so a call after the shared minute does not post the same refresh token
        // again
        const set = cookieNamed(first, "neonflux_refresh")?.split(";")[0]
        f.clock.now += 120000
        await f.handlers.session(sessionCall(set === undefined ? refresh : set))
        assert.deepEqual([f.refreshes, f.rotated], [[f.refreshToken], []])
    }
    // Provider discovery fails before the token request, so the refresh token is unspent and kept
    let discovery = false
    const f = refreshFixture(),
        { refresh } = await signIn(f)
    const handlers = createAuthHandlers({
        ...f.deps,
        fetch: (async (url: string | URL | Request, init?: RequestInit) => {
            if (!discovery && String(url).endsWith("/.well-known/fluxer")) throw new TypeError("fetch failed")
            return f.deps.fetch(url, init)
        }) as typeof fetch,
    })
    f.clock.now += 604800000 - 60000
    const unsent = await handlers.session(sessionCall(refresh))
    assert.deepEqual([unsent.status, unsent.headers.getSetCookie(), f.refreshes], [200, [], []])
    discovery = true
    f.clock.now += 60001
    await handlers.session(sessionCall(refresh))
    assert.deepEqual(f.refreshes, [f.refreshToken])
})
test("Sign-out revokes the session's refresh token after ending the session, and still signs out when that fails", async () => {
    const revoked: Array<{ url: string; body: string; authorization: string | null }> = []
    let refuse = false
    const f = refreshFixture(),
        { refresh } = await signIn(f)
    const order: string[] = []
    const handlers = createAuthHandlers({
        ...f.deps,
        logout: async () => {
            order.push("logout")
            return null
        },
        fetch: (async (url: string | URL | Request, init?: RequestInit) => {
            if (String(url).endsWith("/revoke")) {
                order.push("revoke")
                revoked.push({
                    url: String(url),
                    body: String(init!.body),
                    authorization: new Headers(init!.headers).get("authorization"),
                })
                if (refuse) throw new TypeError("fetch failed")
                return new Response(null, { status: 200 })
            }
            return f.deps.fetch(url, init)
        }) as typeof fetch,
    })
    const signOut = await handlers.logout(sessionCall(refresh))
    assert.equal(signOut.status, 200)
    assert.deepEqual(order, ["logout", "revoke"])
    assert.deepEqual(revoked, [
        {
            url: "https://api.fluxer.app/v1/oauth2/token/revoke",
            body: `token=${f.refreshToken}&token_type_hint=refresh_token`,
            authorization: `Basic ${Buffer.from("synthetic-client-id:synthetic-client-secret").toString("base64")}`,
        },
    ])
    refuse = true
    const failed = await handlers.logout(sessionCall(refresh))
    assert.equal(failed.status, 200)
    assert.match(cookieNamed(failed, "neonflux_refresh")!, /Max-Age=0$/)
    // A refresh cookie of another session is not revoked
    await handlers.logout(sessionCall(refresh, "synthetic-other-session"))
    assert.equal(revoked.length, 2)
})

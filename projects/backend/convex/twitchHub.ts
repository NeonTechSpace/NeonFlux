import { cutText } from "@neonflux/contracts/common"
import { v } from "convex/values"
import { internalAction, internalMutation, internalQuery, type MutationCtx } from "./_generated/server.js"
import { internal } from "./_generated/api.js"
import { isServed } from "./serviceGuard.ts"
import { ringWork } from "./workSignal.ts"
import { twitchSource, twitchSubscription } from "./twitchStore.ts"
import {
    twitchConfig,
    twitchSignatureMatches,
    hubBackoff,
    TWITCH_CALLBACK_PATH,
    TWITCH_RETENTION_MS,
} from "./twitchDomain.ts"
import { twitchMode } from "./twitchValidators.ts"

// EventSub is shared by broadcaster, never polled for streams. The sweep only maintains subscriptions and retries failed requests
const BATCH = 100
const followed = async (ctx: MutationCtx, id: string) =>
    !!(await ctx.db
        .query("twitchSubscriptions")
        .withIndex("by_source", (q) => q.eq("twitchChannelId", id))
        .first())
export const leases = internalMutation({
    args: {},
    handler: async (ctx) => {
        const now = Date.now(),
            due = await ctx.db
                .query("twitchSources")
                .withIndex("by_due", (q) => q.lte("dueAt", now))
                .take(25)
        for (const row of due) {
            const mode = (await followed(ctx, row.twitchChannelId)) ? row.mode : "unsubscribe"
            if (
                mode === "unsubscribe" &&
                !row.subscriptionId &&
                (row.requestedAt === undefined || !/^\d+$/.test(row.twitchChannelId))
            ) {
                await ctx.db.delete(row._id)
                continue
            }
            if (row.verifiedAt !== undefined && mode === "subscribe") {
                await ctx.db.patch(row._id, { dueAt: now + 3600000 })
                continue
            }
            if (row.stopped && mode === "subscribe") {
                await ctx.db.patch(row._id, { dueAt: now + 3600000 })
                continue
            }
            await ctx.db.patch(row._id, { mode, failures: row.failures + 1, requestedAt: now, dueAt: now + 3600000 })
            await ctx.scheduler.runAfter(0, internal.twitchHub.request, { twitchChannelId: row.twitchChannelId, mode })
        }
        if (due.length === 25) await ctx.scheduler.runAfter(0, internal.twitchHub.leases, {})
    },
})
/** Randomness belongs in the action, and the source keeps its first secret through retries */
export const prepare = internalMutation({
    args: { twitchChannelId: v.string(), mode: twitchMode, secret: v.string() },
    handler: async (ctx, args) => {
        const row = await twitchSource(ctx, args.twitchChannelId)
        if (!row || row.mode !== args.mode || (row.stopped && args.mode === "subscribe")) return null
        if (!row.secret) await ctx.db.patch(row._id, { secret: args.secret })
        return { ...row, secret: row.secret ?? args.secret }
    },
})
// Tokens live only inside the action that needs them. Neither responses nor error bodies are stored or logged
async function appHeaders(signal: AbortSignal) {
    const config = twitchConfig()
    if (!config) throw new Error("Twitch alerts are not configured")
    const response = await fetch("https://id.twitch.tv/oauth2/token", {
        method: "POST",
        signal,
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
            client_id: config.clientId,
            client_secret: config.clientSecret,
            grant_type: "client_credentials",
        }).toString(),
    })
    if (!response.ok) throw new Error("Twitch credentials could not be accepted")
    const token = (await response.json()) as { access_token?: string }
    if (!token.access_token) throw new Error("Twitch credentials could not be accepted")
    return {
        "Client-Id": config.clientId,
        Authorization: `Bearer ${token.access_token}`,
        "Content-Type": "application/json",
    }
}
// Twitch disables a subscription whose callback keeps failing, and its revocation message can be lost in the same outage, so nothing
// here would ever learn of it. Once an hour a deployment with verified subscriptions reads Twitch's list of enabled ones, page by
// page, and subscribes again for any that is gone. A failed or unfinished read changes nothing and waits for the next hour
const AUDIT_PAGES = 100
export const verifiedPage = internalQuery({
    args: { cursor: v.union(v.string(), v.null()) },
    handler: async (ctx, { cursor }) => {
        const page = await ctx.db.query("twitchSources").paginate({ cursor, numItems: 200 })
        return {
            ...page,
            page: page.page.flatMap((row) =>
                row.mode === "subscribe" && row.verifiedAt !== undefined && row.subscriptionId
                    ? [{ twitchChannelId: row.twitchChannelId, subscriptionId: row.subscriptionId }]
                    : [],
            ),
        }
    },
})
export const lost = internalMutation({
    args: { twitchChannelId: v.string(), subscriptionId: v.string(), checkedAt: v.number() },
    handler: async (ctx, args) => {
        const row = await twitchSource(ctx, args.twitchChannelId)
        // One verified after the list was read may be newer than that list, so only the same older subscription counts as gone
        if (
            !row ||
            row.subscriptionId !== args.subscriptionId ||
            row.verifiedAt === undefined ||
            row.verifiedAt >= args.checkedAt
        )
            return
        const now = Date.now()
        await ctx.db.patch(row._id, {
            verifiedAt: undefined,
            lastError: "Twitch stopped this subscription. NeonFlux is subscribing again",
            failures: 0,
            dueAt: now,
        })
        await ctx.scheduler.runAfter(0, internal.twitchHub.leases, {})
    },
})
export const audit = internalAction({
    args: {},
    handler: async (ctx) => {
        const config = twitchConfig()
        if (!config) return
        const first = await ctx.runQuery(internal.twitchHub.verifiedPage, { cursor: null })
        if (!first.page.length && first.isDone) return
        const checkedAt = Date.now(),
            controller = new AbortController(),
            timer = setTimeout(() => controller.abort(), 30000),
            enabled = new Set<string>()
        try {
            const headers = await appHeaders(controller.signal),
                prefix = `${config.callbackOrigin}${TWITCH_CALLBACK_PATH}?channel=`
            let after: string | undefined,
                finished = false
            for (let pages = 0; pages < AUDIT_PAGES && !finished; pages++) {
                const response = await fetch(
                    `https://api.twitch.tv/helix/eventsub/subscriptions?status=enabled${after ? `&after=${encodeURIComponent(after)}` : ""}`,
                    { headers, signal: controller.signal },
                )
                if (!response.ok) return
                const list = (await response.json()) as {
                    data: RemoteSubscription[]
                    pagination?: { cursor?: string }
                }
                for (const item of list.data) if (item.transport.callback.startsWith(prefix)) enabled.add(item.id)
                after = list.pagination?.cursor
                finished = !after
            }
            if (!finished) return
        } catch {
            return
        } finally {
            clearTimeout(timer)
        }
        let page = first
        for (;;) {
            for (const source of page.page)
                if (!enabled.has(source.subscriptionId))
                    await ctx.runMutation(internal.twitchHub.lost, { ...source, checkedAt })
            if (page.isDone) return
            page = await ctx.runQuery(internal.twitchHub.verifiedPage, { cursor: page.continueCursor })
        }
    },
})
type RemoteSubscription = {
    id: string
    type: string
    version: string
    status: string
    condition: { broadcaster_user_id: string }
    transport: { callback: string }
}
export const request = internalAction({
    args: { twitchChannelId: v.string(), mode: twitchMode },
    handler: async (ctx, args) => {
        const random = Array.from(crypto.getRandomValues(new Uint8Array(32)), (byte) =>
            byte.toString(16).padStart(2, "0"),
        ).join("")
        const row = await ctx.runMutation(internal.twitchHub.prepare, { ...args, secret: random })
        if (!row) return
        const controller = new AbortController(),
            timer = setTimeout(() => controller.abort(), 5000)
        let error: string | undefined,
            stopped = false,
            subscriptionId: string | undefined
        try {
            const headers = await appHeaders(controller.signal),
                config = twitchConfig()!
            const api = (path: string, init?: RequestInit) =>
                fetch(`https://api.twitch.tv/helix/${path}`, { ...init, headers, signal: controller.signal })
            if (args.mode === "subscribe" && (!/^\d+$/.test(args.twitchChannelId) || !row.login)) {
                const response = await api(
                    `users?${/^\d+$/.test(args.twitchChannelId) ? "id" : "login"}=${encodeURIComponent(args.twitchChannelId.replace(/^pending:/, ""))}`,
                )
                if (!response.ok) throw new Error("Twitch could not look up this login")
                const user = (
                    (await response.json()) as { data: { id: string; login: string; display_name: string }[] }
                ).data[0]
                if (!user) {
                    error = "This Twitch login does not exist. Remove it and add a current login"
                    stopped = true
                } else {
                    await ctx.runMutation(internal.twitchHub.resolved, {
                        pending: args.twitchChannelId,
                        id: user.id,
                        login: user.login,
                        title: user.display_name,
                    })
                    return
                }
            } else {
                // Looking up this broadcaster's subscriptions recovers a create whose answer or challenge was lost
                const callback = `${config.callbackOrigin}${TWITCH_CALLBACK_PATH}?channel=${args.twitchChannelId}`
                let remoteId = row.subscriptionId
                if (!remoteId) {
                    const response = await api(`eventsub/subscriptions?user_id=${args.twitchChannelId}`)
                    if (!response.ok) throw new Error("Twitch subscriptions could not be read")
                    const list = (await response.json()) as { data: RemoteSubscription[] }
                    remoteId = list.data.find(
                        (item) =>
                            item.type === "stream.online" &&
                            item.version === "1" &&
                            item.condition.broadcaster_user_id === args.twitchChannelId &&
                            item.transport.callback === callback,
                    )?.id
                }
                if (remoteId) {
                    // An enabled subscription has no renewal. Reaching here means confirmation was lost, a revocation arrived, or the last follower left
                    const response = await api(`eventsub/subscriptions?id=${encodeURIComponent(remoteId)}`, {
                        method: "DELETE",
                    })
                    if (!response.ok && response.status !== 404)
                        throw new Error("Twitch could not remove the subscription")
                    await ctx.runMutation(internal.twitchHub.deleted, {
                        twitchChannelId: args.twitchChannelId,
                        subscriptionId: remoteId,
                    })
                }
                if (args.mode === "subscribe") {
                    const response = await api("eventsub/subscriptions", {
                        method: "POST",
                        body: JSON.stringify({
                            type: "stream.online",
                            version: "1",
                            condition: { broadcaster_user_id: args.twitchChannelId },
                            transport: { method: "webhook", callback, secret: row.secret },
                        }),
                    })
                    if (!response.ok)
                        throw new Error(
                            response.status === 429
                                ? "Twitch subscription limit reached"
                                : "Twitch turned down the subscription",
                        )
                    subscriptionId = ((await response.json()) as { data: RemoteSubscription[] }).data[0]?.id
                    if (!subscriptionId) throw new Error("Twitch returned no subscription")
                }
            }
        } catch (cause) {
            error = cause instanceof Error && !controller.signal.aborted ? cause.message : "Twitch could not be reached"
        } finally {
            clearTimeout(timer)
        }
        await ctx.runMutation(internal.twitchHub.requested, {
            ...args,
            ...(subscriptionId ? { subscriptionId } : {}),
            ...(error ? { error } : {}),
            stopped,
        })
    },
})
/** Resolve a login once, then migrate bounded pages to the one numeric source shared by all servers */
export const resolved = internalMutation({
    args: { pending: v.string(), id: v.string(), login: v.string(), title: v.string() },
    handler: async (ctx, args) => {
        const pending = await twitchSource(ctx, args.pending)
        if (!pending) return
        if (!/^\d{1,25}$/.test(args.id) || !/^[a-z0-9_]{1,25}$/.test(args.login)) throw new Error("Invalid Twitch user")
        const now = Date.now()
        if (args.pending === args.id) {
            await ctx.db.patch(pending._id, { login: args.login, title: cutText(args.title, 256), dueAt: now })
            await ctx.scheduler.runAfter(0, internal.twitchHub.leases, {})
            return
        }
        const source = await twitchSource(ctx, args.id)
        if (!source)
            await ctx.db.insert("twitchSources", {
                twitchChannelId: args.id,
                login: args.login,
                title: cutText(args.title, 256),
                mode: "subscribe",
                failures: 0,
                dueAt: now,
                createdAt: now,
            })
        else
            await ctx.db.patch(source._id, {
                login: args.login,
                title: cutText(args.title, 256),
                ...(source.mode === "unsubscribe" || source.stopped
                    ? { mode: "subscribe" as const, dueAt: now, stopped: false }
                    : {}),
            })
        const page = await ctx.db
            .query("twitchSubscriptions")
            .withIndex("by_source", (q) => q.eq("twitchChannelId", args.pending))
            .take(BATCH)
        for (const row of page) {
            const exists = await twitchSubscription(ctx, row.serverId, args.id)
            if (!exists) await ctx.db.patch(row._id, { twitchChannelId: args.id })
            else {
                // A renamed streamer the server already follows: This add is the newer one, so its destination wins
                await ctx.db.patch(exists._id, { channelId: row.channelId, enabled: row.enabled, problem: row.problem })
                await ctx.db.delete(row._id)
            }
        }
        if (page.length === BATCH) await ctx.scheduler.runAfter(0, internal.twitchHub.resolved, args)
        else {
            await ctx.db.delete(pending._id)
            await ctx.scheduler.runAfter(0, internal.twitchHub.leases, {})
        }
    },
})
/** A replacement challenge may arrive before the create request returns */
export const deleted = internalMutation({
    args: { twitchChannelId: v.string(), subscriptionId: v.string() },
    handler: async (ctx, args) => {
        const row = await twitchSource(ctx, args.twitchChannelId)
        if (row?.subscriptionId === args.subscriptionId)
            await ctx.db.patch(row._id, { subscriptionId: undefined, verifiedAt: undefined })
    },
})
export const requested = internalMutation({
    args: {
        twitchChannelId: v.string(),
        mode: twitchMode,
        error: v.optional(v.string()),
        stopped: v.boolean(),
        subscriptionId: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        const row = await twitchSource(ctx, args.twitchChannelId)
        if (!row) return
        if (!args.error && args.mode === "unsubscribe") {
            if (row.mode === "unsubscribe") await ctx.db.delete(row._id)
            else {
                await ctx.db.patch(row._id, { subscriptionId: undefined, verifiedAt: undefined, dueAt: Date.now() })
                await ctx.scheduler.runAfter(0, internal.twitchHub.leases, {})
            }
            return
        }
        if (args.subscriptionId) await ctx.db.patch(row._id, { subscriptionId: args.subscriptionId })
        if (row.mode !== args.mode) {
            await ctx.db.patch(row._id, { dueAt: Date.now() })
            await ctx.scheduler.runAfter(0, internal.twitchHub.leases, {})
            return
        }
        if (row.verifiedAt !== undefined && !args.error) return
        const dueAt = args.stopped
            ? Date.now() + 3600000
            : Date.now() + (args.error ? hubBackoff(row.failures) : 3600000)
        await ctx.db.patch(row._id, { lastError: args.error, stopped: args.stopped, dueAt })
        if (!args.stopped) await ctx.scheduler.runAt(dueAt, internal.twitchHub.leases, {})
    },
})
/** A valid callback is recorded quickly. Metadata and fan-out run after the HTTP acknowledgement */
export const notify = internalMutation({
    args: {
        twitchChannelId: v.string(),
        signature: v.union(v.string(), v.null()),
        messageId: v.string(),
        timestamp: v.string(),
        messageType: v.string(),
        body: v.bytes(),
    },
    handler: async (ctx, args): Promise<{ status: number; challenge?: string }> => {
        const row = await twitchSource(ctx, args.twitchChannelId)
        if (!row?.secret) return { status: 404 }
        if (!(await twitchSignatureMatches(row.secret, args.signature, args.messageId, args.timestamp, args.body)))
            return { status: 403 }
        let payload: {
            subscription?: RemoteSubscription
            challenge?: string
            event?: {
                id: string
                type: string
                broadcaster_user_id: string
                broadcaster_user_login: string
                broadcaster_user_name: string
                started_at: string
            }
        }
        try {
            payload = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(args.body))
        } catch {
            return { status: 400 }
        }
        const subscription = payload?.subscription
        if (
            !subscription ||
            subscription.type !== "stream.online" ||
            subscription.version !== "1" ||
            subscription.condition?.broadcaster_user_id !== row.twitchChannelId ||
            typeof subscription.id !== "string"
        )
            return { status: 400 }
        if (row.mode !== "subscribe") return { status: 204 }
        if (row.subscriptionId && row.subscriptionId !== subscription.id) return { status: 204 }
        const now = Date.now()
        if (args.messageType === "webhook_callback_verification") {
            if (typeof payload.challenge !== "string" || !payload.challenge || payload.challenge.length > 4096)
                return { status: 400 }
            await ctx.db.patch(row._id, {
                subscriptionId: subscription.id,
                verifiedAt: now,
                lastError: undefined,
                stopped: false,
                failures: 0,
                dueAt: now + 3600000,
            })
            return { status: 200, challenge: payload.challenge }
        }
        if (args.messageType === "revocation") {
            // Message type is a header outside the HMAC, so an enabled notification cannot be relabelled as a revocation
            if (
                !subscription.status ||
                subscription.status === "enabled" ||
                subscription.status === "webhook_callback_verification_pending"
            )
                return { status: 400 }
            const reason = typeof subscription.status === "string" ? subscription.status.slice(0, 200) : "unknown"
            const retrying = [
                "notification_failures_exceeded",
                "webhook_callback_verification_failed",
                "beta_maintenance",
            ].includes(reason)
            const dueAt = retrying ? now + hubBackoff(row.failures + 1) : now + 3600000
            await ctx.db.patch(row._id, {
                lastError: `Twitch revoked this subscription: ${reason}`,
                verifiedAt: undefined,
                stopped: !retrying,
                dueAt,
            })
            if (retrying) await ctx.scheduler.runAt(dueAt, internal.twitchHub.leases, {})
            return { status: 204 }
        }
        const event = payload.event
        if (args.messageType !== "notification") return { status: 400 }
        if (!event || event.type !== "live") return { status: 204 }
        const publishedAt = Date.parse(event.started_at)
        if (
            !/^\d{1,30}$/.test(event.id) ||
            event.broadcaster_user_id !== row.twitchChannelId ||
            !/^[a-z0-9_]{1,25}$/.test(event.broadcaster_user_login) ||
            typeof event.broadcaster_user_name !== "string" ||
            !Number.isFinite(publishedAt) ||
            publishedAt > now + 60000
        )
            return { status: 400 }
        await ctx.db.patch(row._id, {
            lastNotificationAt: now,
            login: event.broadcaster_user_login,
            title: cutText(event.broadcaster_user_name, 256),
        })
        const seen = await ctx.db
            .query("twitchStreams")
            .withIndex("by_stream", (q) => q.eq("streamId", event.id))
            .unique()
        if (seen) return { status: 204 }
        await ctx.db.insert("twitchStreams", {
            streamId: event.id,
            twitchChannelId: row.twitchChannelId,
            title: `${cutText(event.broadcaster_user_name, 256)} is live`,
            publishedAt,
            seenAt: now,
            expiresAt: now + TWITCH_RETENTION_MS,
        })
        await ctx.scheduler.runAfter(0, internal.twitchHub.enrich, {
            twitchChannelId: row.twitchChannelId,
            streamId: event.id,
        })
        return { status: 204 }
    },
})
/** One best-effort read, with two seconds for token and stream together, never retried */
export const enrich = internalAction({
    args: { twitchChannelId: v.string(), streamId: v.string() },
    handler: async (ctx, args) => {
        const controller = new AbortController(),
            timer = setTimeout(() => controller.abort(), 2000)
        let details: { title?: string; game?: string; thumbnail?: string } = {}
        try {
            const headers = await appHeaders(controller.signal),
                response = await fetch(`https://api.twitch.tv/helix/streams?user_id=${args.twitchChannelId}`, {
                    headers,
                    signal: controller.signal,
                })
            if (response.ok) {
                const stream = (
                    (await response.json()) as {
                        data: { id: string; type: string; title: string; game_name: string; thumbnail_url: string }[]
                    }
                ).data.find((item) => item.id === args.streamId && item.type === "live")
                if (stream)
                    details = {
                        ...(stream.title ? { title: cutText(stream.title, 1000) } : {}),
                        ...(stream.game_name ? { game: cutText(stream.game_name, 256) } : {}),
                        ...(stream.thumbnail_url?.startsWith("https://")
                            ? {
                                  thumbnail: stream.thumbnail_url
                                      .replace("{width}", "1280")
                                      .replace("{height}", "720")
                                      .slice(0, 2048),
                              }
                            : {}),
                    }
            }
        } catch {
            /* Metadata is optional, so a failed read still posts the alert */
        } finally {
            clearTimeout(timer)
        }
        await ctx.runMutation(internal.twitchHub.fanOutPage, { streamId: args.streamId, afterServerId: "", ...details })
    },
})
export const fanOutPage = internalMutation({
    args: {
        streamId: v.string(),
        afterServerId: v.string(),
        title: v.optional(v.string()),
        game: v.optional(v.string()),
        thumbnail: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        let stream = await ctx.db
            .query("twitchStreams")
            .withIndex("by_stream", (q) => q.eq("streamId", args.streamId))
            .unique()
        if (!stream) return
        const details = {
            ...(args.title ? { title: args.title } : {}),
            ...(args.game ? { game: args.game } : {}),
            ...(args.thumbnail ? { thumbnail: args.thumbnail } : {}),
        }
        await ctx.db.patch(stream._id, details)
        stream = { ...stream, ...details }
        const now = Date.now(),
            page = await ctx.db
                .query("twitchSubscriptions")
                .withIndex("by_source", (q) =>
                    q.eq("twitchChannelId", stream!.twitchChannelId).gt("serverId", args.afterServerId),
                )
                .take(BATCH)
        let created = 0
        for (const row of page) {
            if (
                !row.enabled ||
                row.createdAt > stream.publishedAt ||
                now - stream.publishedAt >= 86400000 ||
                !(await isServed(ctx, row.serverId)) ||
                (await ctx.db
                    .query("twitchDeliveries")
                    .withIndex("by_stream", (q) =>
                        q
                            .eq("serverId", row.serverId)
                            .eq("twitchChannelId", row.twitchChannelId)
                            .eq("streamId", args.streamId),
                    )
                    .unique())
            )
                continue
            await ctx.db.insert("twitchDeliveries", {
                serverId: row.serverId,
                twitchChannelId: row.twitchChannelId,
                streamId: args.streamId,
                title: stream.title,
                ...(stream.game ? { game: stream.game } : {}),
                ...(stream.thumbnail ? { thumbnail: stream.thumbnail } : {}),
                state: "queued",
                nextCheckAt: now,
                createdAt: now,
                expiresAt: now + TWITCH_RETENTION_MS,
            })
            created++
        }
        if (created) await ringWork(ctx)
        if (page.length === BATCH)
            await ctx.scheduler.runAfter(0, internal.twitchHub.fanOutPage, {
                streamId: args.streamId,
                afterServerId: page.at(-1)!.serverId,
            })
    },
})

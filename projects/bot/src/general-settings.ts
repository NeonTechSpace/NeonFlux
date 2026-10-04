import { Clock, Effect, Schema } from "effect"
import { Permissions, type BotEventContext, type Client } from "@neontechspace/fluxerly/effect"
import {
    GeneralGetResult,
    GeneralManageResult,
    validPrefix,
    type GeneralGetRequest,
    type GeneralManageRequest,
} from "@neonflux/contracts/general"
import { createBackendRequest } from "./backend-http.ts"
import type { BackendConfig } from "./config.ts"
import { code, notSetUp } from "./reply-style.ts"

export function createGeneralSettingsStore(backend: BackendConfig, serverId: string) {
    const request = createBackendRequest(backend)
    return {
        get: () =>
            request("/general/get", { serverId } satisfies GeneralGetRequest).pipe(
                Effect.flatMap(Schema.decodeUnknownEffect(GeneralGetResult)),
            ),
        set: (actorId: string, change: { prefix: string }, expectedRevision: number) =>
            request("/general/manage", {
                serverId,
                originServerId: serverId,
                actorId,
                managerAuthorized: true,
                ...change,
                expectedRevision,
            } satisfies GeneralManageRequest).pipe(Effect.flatMap(Schema.decodeUnknownEffect(GeneralManageResult))),
    }
}
export type GeneralSettingsStore = ReturnType<typeof createGeneralSettingsStore>

// Each managed server's prefix in bot memory. Chat changes apply at once and other backend changes within the TTL
export const prefixTtlMs = 30000
type General = { readonly prefix: string }
const prefixes = new Map<string, General & { readAt: number }>()
const remember = (serverId: string, { prefix }: General) =>
    Clock.currentTimeMillis.pipe(
        Effect.map((readAt) => {
            prefixes.set(serverId, { prefix, readAt })
        }),
    )

/** The prefix that commands in a reply to this message use */
export const replyPrefix = (serverId: string) => prefixes.get(serverId)?.prefix ?? "!"

/** Print bot-authored usage text with a reply's prefix */
export const withPrefix = (text: string, prefix: string) =>
    prefix === "!" ? text : text.replace(/(?<![\w!])!(?=[a-z])/g, () => prefix)

/** Forget a retired server's prefix, so memory holds only servers this process serves */
export const forgetPrefix = (serverId: string) => {
    prefixes.delete(serverId)
}

/** Start one server's prefix memory for a new bot run and return its prefix reader */
export function createPrefixReader(store: GeneralSettingsStore | undefined, serverId: string) {
    prefixes.delete(serverId)
    return Effect.gen(function* () {
        if (!store) return "!"
        const cached = prefixes.get(serverId)
        if (cached && (yield* Clock.currentTimeMillis) - cached.readAt < prefixTtlMs) return cached.prefix
        // A failed refresh keeps the last known prefix, or ! without one, for another TTL
        const value = yield* store
            .get()
            .pipe(
                Effect.catch(() =>
                    Effect.logWarning(
                        "The configured prefix could not be read. Commands use the last known prefix or !",
                    ).pipe(Effect.as<General>(cached ?? { prefix: "!" })),
                ),
            )
        yield* remember(serverId, value)
        return value.prefix
    })
}

export function handlePrefixCommand(
    store: GeneralSettingsStore | undefined,
    serverId: string,
    args: readonly string[],
    context: BotEventContext<"messageCreate">,
) {
    const respond = (content: string) => context.reply({ content })
    return Effect.gen(function* () {
        if (!store) {
            yield* respond(notSetUp("The prefix setting"))
            return
        }
        if (context.message.guildId !== serverId) return
        const current = yield* store.get()
        yield* remember(serverId, current)
        if (!args.length) {
            yield* respond(`Current prefix: ${current.prefix}`)
            return
        }
        if (args.length !== 1 || !validPrefix(args[0])) {
            yield* respond(`Use ${code(`${current.prefix}prefix <one to five punctuation characters>`)}`)
            return
        }
        if (!(yield* readServerManagerAuthority(context.client, serverId, context.message.author.id))) {
            yield* respond("Only the server owner or members with Manage community can change the prefix")
            return
        }
        const saved = yield* store.set(context.message.author.id, { prefix: args[0]! }, current.revision)
        if (saved.saved) yield* remember(serverId, { ...current, prefix: args[0]! })
        yield* respond(
            saved.saved
                ? `Prefix changed to ${args[0]}`
                : "The prefix changed while this command ran. Check the current prefix and try again",
        )
    })
}

/** Server settings follow one rule: the server owner, Administrator or Manage community, read fresh from Fluxer. The owner holds every permission */
function readServerManagerAuthority(client: Client, serverId: string, userId: string) {
    return client.permissions.fetch({ guildId: serverId, userId }, { timeoutMs: 5000 }).pipe(
        Effect.map((bits) => (bits & (Permissions.Administrator | Permissions.ManageGuild)) !== 0n),
        Effect.catch(() => Effect.succeed(false)),
    )
}

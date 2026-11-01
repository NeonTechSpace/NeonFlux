import type {
    VoiceDashboardContext,
    VoiceGenerator,
    VoiceGeneratorPatch,
    VoiceManageOperation,
    VoiceMemberOperation,
    VoiceRoomView,
} from "@neonflux/contracts/voice"
import type { DashboardConfigurationJob, DashboardConfigurationReadyJob } from "@neonflux/contracts/dashboard"
import {
    ChannelType,
    errors,
    format,
    permissionBits,
    Permissions,
    type BotEventContext,
    type Client,
    type MessageReaction,
    type OverwritePatch,
    type PermissionOverwrite,
} from "@neontechspace/fluxerly/effect"
import { Cause, Clock, Effect } from "effect"
import type { BotConfig } from "./config.ts"
import { warnFailure } from "./contained.ts"
import { voiceHelp, type VoiceCommand, type VoiceRoomControl } from "./voice-command.ts"
import { voicePanelAction, voiceRoomPage } from "./voice-panel.ts"
import { readVoiceAuthority } from "./voice-permissions.ts"
import { VoiceStoreError, type VoiceStore } from "./voice-store.ts"
import { voiceGeneratorLimit, voiceRoomLimit, voiceRuntimes, type VoiceRuntime } from "./voice-worker.ts"
import { isConfined } from "./jail-memory.ts"
import { memberTimeout, readSafetyAuthority, SafetyPermissionError } from "./safety-permissions.ts"
import { fixSentence, nativeFix, permissionNames } from "./permission-fix.ts"
import { clip, code, replyCard, replyText } from "./reply-style.ts"
import { sourceTimestamp } from "./responses.ts"
import { replyPrefix, withPrefix } from "./general-settings.ts"

export const voiceDefaultTemplate = "{owner}'s room"
const access = ["ViewChannel", "Connect"] as const
const staffRule = "the server owner, an Administrator or a moderation staff role with Manage channels"

function describe(error: unknown) {
    if (error instanceof VoiceStoreError) {
        if (error.status === 403) return `Only ${staffRule} can manage voice generators`
        if (error.status === 404) return "That channel is not a generator. Check !voice generator list"
        if (error.status === 409)
            return "That channel is already a generator or a temporary room, or its settings changed. Check !voice generator list"
        if (error.status === 429) return `A server can have at most ${voiceGeneratorLimit} generators`
        if (error.status === 400) return "Check the voice command values. Use !voice help"
        return "Voice settings are unavailable right now. Try again shortly"
    }
    if (error instanceof SafetyPermissionError) return "Current permissions could not be read. Try again shortly"
    // Fluxer may have applied it, so NeonFlux never repeats it by itself
    if (errors.outcome(error) === "unknown")
        return "NeonFlux could not confirm this room change, and it may have applied. Check the room before trying again"
    if (error !== null && typeof error === "object" && (error as { _tag?: unknown })._tag === "ChannelOperationError") {
        return (
            nativeFix(error) ??
            "Fluxer refused the channel change. NeonFlux needs Manage channels, and Manage roles to change visibility, the lock or member access"
        )
    }
    return "The voice command could not be completed"
}
const rooms = (generator: VoiceGenerator) =>
    `Rooms named "${generator.template}"${generator.categoryId ? ` in ${format.channelMention(generator.categoryId)}` : ""}, ` +
    `${generator.userLimit ? `up to ${generator.userLimit} members` : "no member limit"}, ${generator.region ? `region ${generator.region}` : "automatic region"}` +
    `${generator.panel === false ? ", no controls card" : ""}`
/** The one generator setting a command changed, with its new value */
function generatorChange(patch: VoiceGeneratorPatch, generator: VoiceGenerator) {
    const where = format.channelMention(generator.channelId),
        from = `Rooms from ${where}`
    if (patch.channelName !== undefined) return `Generator ${where} renamed to ${patch.channelName}`
    if (patch.categoryId !== undefined)
        return generator.categoryId
            ? `${from} now open in ${format.channelMention(generator.categoryId)}`
            : `${from} now open outside any category`
    if (patch.template !== undefined) return `${from} are now named "${generator.template}"`
    if (patch.userLimit !== undefined)
        return generator.userLimit
            ? `${from} now hold up to ${generator.userLimit} members`
            : `${from} now have no member limit`
    if (patch.panel !== undefined)
        return patch.panel ? `${from} now get a controls card` : `${from} no longer get a controls card`
    return generator.region ? `${from} now use region ${generator.region}` : `${from} now use the automatic region`
}

export function handleVoiceCommand(
    store: VoiceStore,
    runtime: VoiceRuntime,
    config: BotConfig,
    command: VoiceCommand | { error: string },
    context: BotEventContext<"messageCreate">,
) {
    const prefix = replyPrefix(config.serverId, context.message.guildId)
    const reply = (content: string) => replyText(context, withPrefix(content, prefix))
    return Effect.gen(function* () {
        const { message } = context
        if (message.guildId !== config.serverId) return
        if ("error" in command) {
            yield* reply(command.error)
            return
        }
        if (command.type === "help") {
            const page = voiceRoomPage(config.websiteUrl, config.serverId)
            yield* reply(page ? `${voiceHelp}\nControl your room on the website: ${page}` : voiceHelp)
            return
        }
        if (
            command.type === "generator-add" ||
            command.type === "generator-list" ||
            command.type === "generator-remove" ||
            command.type === "generator-set"
        ) {
            yield* manageGenerators(store, runtime, config, command, context, reply)
        } else {
            const outcome = yield* command.type === "claim" || command.type === "transfer"
                ? handOverRoom(store, runtime, context.client, config.serverId, message.author.id, command)
                : changeRoom(store, runtime, context.client, config.serverId, message.author.id, command)
            yield* reply(outcome.text)
        }
    }).pipe(Effect.catch((error) => reply(describe(error))))
}

function manageGenerators(
    store: VoiceStore,
    runtime: VoiceRuntime,
    config: BotConfig,
    command: Extract<VoiceCommand, { type: `generator-${string}` }>,
    context: BotEventContext<"messageCreate">,
    reply: (content: string) => Effect.Effect<unknown, unknown>,
) {
    return Effect.gen(function* () {
        const { message, client } = context,
            serverId = config.serverId
        const { actor } = yield* readVoiceAuthority(client, serverId, message.author.id)
        const authority = yield* store.query({ serverId, operation: { type: "authority", actor } })
        if (authority.type !== "authority" || !authority.staff) {
            yield* reply(`Only ${staffRule} can manage voice generators`)
            return
        }
        if (command.type === "generator-list") {
            yield* replyCard(context, serverId, {
                title: "Voice generators",
                description:
                    authority.generators
                        .map((generator) => `${format.channelMention(generator.channelId)}: ${rooms(generator)}`)
                        .join("\n") ||
                    `No voice generators yet. Add one with ${code(`${replyPrefix(serverId, message.guildId)}voice generator add "Join to create"`)}`,
                footer: `${authority.generators.length} of ${voiceGeneratorLimit} generators, ${authority.rooms} of ${voiceRoomLimit} temporary rooms in use`,
            })
            return
        }
        const manage = (operation: VoiceManageOperation) =>
            sourceTimestamp(message).pipe(
                Effect.flatMap((createdAt) =>
                    store.manage({ serverId, messageId: message.id, createdAt, actor, operation }),
                ),
            )
        const category =
            command.type === "generator-add"
                ? command.categoryId
                : command.type === "generator-set"
                  ? command.patch.categoryId
                  : undefined
        if (typeof category === "string" && !(yield* isCategory(client, serverId, category))) {
            yield* reply("Choose a category ID from this server, or none")
            return
        }
        if (command.type === "generator-remove") {
            yield* manage({ type: "generator-remove", channelId: command.channelId })
            runtime.removeGenerator(command.channelId)
            yield* reply(
                `Generator removed. ${format.channelMention(command.channelId)} stays as an ordinary voice channel, and its existing rooms are still deleted once they are empty`,
            )
            return
        }
        if (command.type === "generator-add") {
            if (authority.generators.length >= voiceGeneratorLimit) {
                yield* reply(`A server can have at most ${voiceGeneratorLimit} generators`)
                return
            }
            const created = yield* client.channels.create(
                serverId,
                { type: ChannelType.Voice, name: command.channelName, parentId: command.categoryId },
                { auditReason: "Voice generator" },
            )
            const result = yield* manage({
                type: "generator-add",
                channelId: created.id,
                channelName: command.channelName,
                categoryId: command.categoryId,
                template: voiceDefaultTemplate,
                userLimit: null,
                region: null,
            }).pipe(
                Effect.tapError(() =>
                    client.channels
                        .delete(created.id, { auditReason: "Voice generator could not be saved" })
                        .pipe(Effect.catch(() => Effect.void)),
                ),
            )
            if (result.type === "generator") runtime.setGenerator(result.generator)
            yield* reply(
                `Generator ${format.channelMention(created.id)} created. Members who join it get their own room named "${voiceDefaultTemplate}"\nChange its name, room names, limit, region or category with \`!voice generator set\``,
            )
            return
        }
        if (!authority.generators.some((generator) => generator.channelId === command.channelId)) {
            yield* reply("That channel is not a generator. Check !voice generator list")
            return
        }
        if (command.patch.channelName !== undefined)
            yield* client.channels.edit(
                command.channelId,
                { name: command.patch.channelName },
                { auditReason: "Voice generator renamed" },
            )
        const result = yield* manage({ type: "generator-set", channelId: command.channelId, patch: command.patch })
        // The line can quote a room name template, so it is sent as it is
        if (result.type === "generator") {
            runtime.setGenerator(result.generator)
            yield* replyText(context, generatorChange(command.patch, result.generator))
        }
    })
}
function isCategory(client: Client, serverId: string, channelId: string) {
    return client.channels.fetch(channelId, { timeoutMs: 5000 }).pipe(
        Effect.map(
            (channel) =>
                channel.id === channelId && channel.guildId === serverId && channel.type === ChannelType.Category,
        ),
        Effect.catch(() => Effect.succeed(false)),
    )
}

/** What a room change came to. The caller replies in chat, stays silent on a reaction or records it on the member's website request */
type RoomOutcome = { readonly ok: boolean; readonly text: string }
const done = (text: string): RoomOutcome => ({ ok: true, text }),
    refused = (text: string): RoomOutcome => ({ ok: false, text })
/** The room controls, and what a panel reaction turns into once the room's state is read */
type RoomAction =
    | VoiceRoomControl
    | { type: "toggle-lock"; roomId: string }
    | { type: "toggle-hide"; roomId: string }
    | { type: "limit-step"; roomId: string; by: 1 | -1 }
const paused = "Room commands are paused while the server's DEFCON level is raised"
const notReady = "NeonFlux is still reading who is in voice. Try again in a minute"
const timedOut = "You cannot change a voice room while you are timed out"
const jailedActor = "You cannot change a voice room while you are jailed"

/** The next limit of a panel step. The first step down from no limit starts at the members in the room, and a step never removes a limit */
const steppedLimit = (limit: number, by: 1 | -1, occupants: number) =>
    by === 1
        ? limit === 0
            ? 0
            : Math.min(limit + 1, 99)
        : limit === 0
          ? Math.max(occupants, 1)
          : Math.max(limit - 1, 1)

/**
 * The overwrites of a locked room. Everyone loses Connect, while the owner and NeonFlux keep full access and members inside keep
 * Connect, unless they are blocked, so they can rejoin. Allowed members already hold their own overwrite
 */
function lockedOverwrites(
    overwrites: readonly PermissionOverwrite[],
    serverId: string,
    keepers: readonly string[],
    occupants: readonly string[],
) {
    const next = new Map(overwrites.map((entry) => [`${entry.type}:${entry.id}`, entry]))
    const entry = (id: string, type: "role" | "member") =>
        next.get(`${type}:${id}`) ?? { id, type, allow: 0n, deny: 0n }
    const everyone = entry(serverId, "role")
    next.set(`role:${serverId}`, { ...everyone, ...permissionBits.patchOverwrite(everyone, { deny: ["Connect"] }) })
    for (const id of occupants) {
        const current = entry(id, "member")
        next.set(`member:${id}`, { ...current, allow: current.allow | Permissions.Connect })
    }
    for (const id of keepers) {
        const current = entry(id, "member")
        next.set(`member:${id}`, { ...current, ...permissionBits.patchOverwrite(current, { allow: access }) })
    }
    return [...next.values()]
}
/** The members inside a lock has to give Connect: Not the owner or NeonFlux, a blocked or jailed member or one who already holds it */
const lockGrantsFor = (
    overwrites: readonly PermissionOverwrite[],
    serverId: string,
    keepers: readonly string[],
    occupants: readonly string[],
) =>
    occupants.filter((id) => {
        const own = overwrites.find((entry) => entry.id === id && entry.type === "member")
        return (
            !keepers.includes(id) &&
            !isConfined(serverId, id) &&
            ((own?.allow ?? 0n) & Permissions.Connect) === 0n &&
            ((own?.deny ?? 0n) & Permissions.Connect) === 0n
        )
    })
/**
 * Unlocking returns Connect to everyone, with the explicit allow a lock took, and takes back only the Connect the lock gave members inside.
 * Allow and block overwrites and grants that were there before stay
 */
function unlockedOverwrites(
    overwrites: readonly PermissionOverwrite[],
    serverId: string,
    keepers: readonly string[],
    heldAllow: bigint,
    lockGrants: readonly string[],
) {
    return overwrites.flatMap((entry) => {
        if (entry.id === serverId && entry.type === "role")
            return [
                {
                    ...entry,
                    deny: entry.deny & ~Permissions.Connect,
                    allow: entry.allow | (heldAllow & Permissions.Connect),
                },
            ]
        if (entry.type !== "member" || keepers.includes(entry.id) || !lockGrants.includes(entry.id)) return [entry]
        const allow = entry.allow & ~Permissions.Connect
        return allow === 0n && entry.deny === 0n ? [] : [{ ...entry, allow }]
    })
}
const everyoneDenies = (overwrites: readonly PermissionOverwrite[], serverId: string, bit: bigint) =>
    ((overwrites.find((entry) => entry.id === serverId && entry.type === "role")?.deny ?? 0n) & bit) !== 0n

/** The owner or staff rule of a room command, for a command, a panel reaction and a website request alike */
function changeRoom(
    store: VoiceStore,
    runtime: VoiceRuntime,
    client: Client,
    serverId: string,
    actorId: string,
    request: RoomAction,
) {
    return Effect.gen(function* () {
        if (request.roomId === undefined) yield* runtime.ready
        const roomId = request.roomId ?? runtime.ownedRoom(actorId)?.channelId
        if (!roomId) return refused("You do not own a temporary voice room. Join a generator to create one")
        // Fresh native reads come first, then the backend confirms the room record and the owner or staff rule
        const { authority, actor, botBits } = yield* readVoiceAuthority(client, serverId, actorId, roomId)
        const checked = yield* store.query({ serverId, operation: { type: "authority", actor, channelId: roomId } })
        const channel = authority.channel
        if (checked.type !== "authority" || !checked.room || channel?.type !== ChannelType.Voice)
            return refused("That channel is not a temporary voice room")
        if (checked.paused) return refused(paused)
        // A timed-out member cannot send the command, so the panel and the website refuse them too
        if (memberTimeout(client, authority.actor, yield* Clock.currentTimeMillis) !== "none") return refused(timedOut)
        // The same holds for a jailed member, whose only commands are the jail's own, and one whose jail outcome is unknown, as at the command gate
        if (isConfined(serverId, actorId)) return refused(jailedActor)
        const room = checked.room
        if (room.ownerId !== actorId && !checked.staff)
            return refused(`Only the room owner or ${staffRule} can change this room`)
        const overwrites = channel.permissionOverwrites ?? [],
            locked = everyoneDenies(overwrites, serverId, Permissions.Connect),
            hidden = everyoneDenies(overwrites, serverId, Permissions.ViewChannel)
        const command: Exclude<RoomAction, { type: "toggle-lock" | "toggle-hide" }> =
            request.type === "toggle-lock"
                ? { type: locked ? "unlock" : "lock", roomId }
                : request.type === "toggle-hide"
                  ? { type: hidden ? "show" : "hide", roomId }
                  : request
        const required =
            Permissions.ViewChannel |
            (command.type === "panel"
                ? Permissions.SendMessages | Permissions.AddReactions | Permissions.ManageMessages
                : command.type === "lock" || command.type === "unlock"
                  ? Permissions.ManageRoles | Permissions.ManageChannels
                  : command.type === "hide" ||
                      command.type === "show" ||
                      command.type === "allow" ||
                      command.type === "block"
                    ? Permissions.ManageRoles
                    : Permissions.ManageChannels)
        if ((botBits & required) !== required)
            return refused(fixSentence({ permissions: permissionNames(required & ~botBits), channelId: roomId }))
        const current = (id: string, type: "role" | "member"): PermissionOverwrite =>
            overwrites.find((entry) => entry.id === id && entry.type === type) ?? {
                id,
                type,
                allow: 0n,
                deny: 0n,
            }
        const change = (id: string, type: "role" | "member", patch: OverwritePatch) =>
            client.channels.setPermissionOverwrite(roomId, {
                id,
                type,
                ...permissionBits.patchOverwrite(current(id, type), patch),
            })
        // An explicit allow for everyone would be lost to a deny on the same bit, so the bits go on the record before the native change. Without
        // the record the room could not get them back, so a failure here stops the change
        const everyone = current(serverId, "role"),
            heldAllow = BigInt(room.heldAllow ?? "0")
        const lockGrants = room.lockGrants ?? []
        const holdAllow = (bit: bigint, grants: readonly string[] = []) => {
            const allowed = (everyone.allow & bit) !== 0n
            return !allowed && !grants.length
                ? Effect.void
                : store.rooms({
                      serverId,
                      operation: {
                          type: "update",
                          channelId: roomId,
                          ...(allowed ? { heldAllow: String(heldAllow | bit) } : {}),
                          ...(grants.length ? { lockGrants: [...new Set([...lockGrants, ...grants])] } : {}),
                      },
                  })
        }
        const releaseAllow = (bit: bigint) =>
            (heldAllow & bit) === 0n ? Effect.void : runtime.updateRoom(roomId, { heldAllow: String(heldAllow & ~bit) })
        // What the room's website page shows. Fluxer's overwrites stay the truth for every decision above
        const record = (changed: Partial<Omit<VoiceRoomView, "observedAt">>) =>
            Effect.gen(function* () {
                yield* runtime.updateRoom(roomId, {
                    view: {
                        ...roomView(channel, overwrites, serverId),
                        ...changed,
                        observedAt: yield* Clock.currentTimeMillis,
                    },
                })
            })
        if (command.type === "panel") {
            yield* runtime.postPanel(roomId)
            return done("Room controls posted in this room's chat")
        }
        if (command.type === "rename") {
            yield* client.channels.edit(roomId, { name: command.name })
            yield* record({ name: command.name })
            return done(`Room renamed to ${command.name}`)
        }
        if (command.type === "limit" || command.type === "limit-step") {
            yield* runtime.ready
            const limit =
                command.type === "limit"
                    ? command.limit
                    : steppedLimit(channel.userLimit ?? 0, command.by, runtime.occupants(roomId)?.length ?? 0)
            yield* client.channels.edit(roomId, { userLimit: limit })
            yield* record({ userLimit: limit })
            return done(limit ? `Room limit set to ${limit} members` : "Room limit removed")
        }
        if (command.type === "region") {
            const applied = yield* client.channels.edit(roomId, { rtcRegion: command.region }).pipe(
                Effect.as(true),
                // Fluxer knows the regions it offers and answers 400 for any other ID
                Effect.catch((error) =>
                    (error as { status?: unknown }).status === 400 ? Effect.succeed(false) : Effect.fail(error),
                ),
            )
            if (!applied) return refused("Fluxer does not offer that region. Check the region ID, or use auto")
            yield* record({ region: command.region })
            return done(command.region ? `Room region set to ${command.region}` : "Room region set to automatic")
        }
        if (command.type === "lock" || command.type === "unlock") {
            yield* runtime.ready
            const keepers = [authority.botId, room.ownerId]
            if (command.type === "unlock") {
                yield* client.channels.edit(roomId, {
                    permissionOverwrites: unlockedOverwrites(overwrites, serverId, keepers, heldAllow, lockGrants),
                })
                yield* releaseAllow(Permissions.Connect)
                if (lockGrants.length) yield* runtime.updateRoom(roomId, { lockGrants: [] })
                yield* record({ locked: false })
                return done("Room unlocked. Members can join again")
            }
            const occupants = runtime.occupants(roomId)
            if (!occupants) return refused(notReady)
            const grants = lockGrantsFor(overwrites, serverId, keepers, occupants)
            yield* holdAllow(Permissions.Connect, grants)
            // One edit replaces the whole list, so a large room costs one request and is never left half locked
            yield* client.channels.edit(roomId, {
                permissionOverwrites: lockedOverwrites(overwrites, serverId, keepers, grants),
            })
            yield* record({ locked: true })
            return done("Room locked. Only you, members inside and members you allow can join")
        }
        if (command.type === "hide") {
            // The bot keeps sight of its rooms, or Fluxer would stop delivering their voice events
            yield* holdAllow(Permissions.ViewChannel)
            yield* change(authority.botId, "member", { allow: access })
            yield* change(room.ownerId, "member", { allow: access })
            yield* change(serverId, "role", { deny: ["ViewChannel"] })
            yield* record({ hidden: true })
            return done("Room hidden from everyone without explicit access")
        }
        if (command.type === "show") {
            yield* client.channels.setPermissionOverwrite(roomId, {
                id: serverId,
                type: "role",
                allow: everyone.allow | (heldAllow & Permissions.ViewChannel),
                deny: everyone.deny & ~Permissions.ViewChannel,
            })
            yield* releaseAllow(Permissions.ViewChannel)
            yield* record({ hidden: false })
            return done("Room visible again")
        }
        if (command.type === "allow") {
            // A member overwrite would beat the jail role's denial
            if (isConfined(serverId, command.userId)) return refused("A jailed member cannot be let into a voice room")
            yield* change(command.userId, "member", { allow: access })
            // Allowed on purpose, so unlocking no longer takes this member's Connect back
            if (lockGrants.includes(command.userId))
                yield* runtime.updateRoom(roomId, { lockGrants: lockGrants.filter((id) => id !== command.userId) })
            return done(`${format.userMention(command.userId)} can see and join this room`)
        }
        if (command.type !== "block") return refused("Check the voice command syntax. Use !voice help")
        if (command.userId === room.ownerId || command.userId === authority.botId)
            return refused("The room owner and NeonFlux cannot be blocked")
        yield* change(command.userId, "member", { deny: access })
        return done(
            `${format.userMention(command.userId)} can no longer see or join this room. Members already inside stay connected`,
        )
    })
}
const roomView = (
    channel: {
        readonly name?: string | undefined
        readonly userLimit?: number | null
        readonly rtcRegion?: string | null
    },
    overwrites: readonly PermissionOverwrite[],
    serverId: string,
): Omit<VoiceRoomView, "observedAt"> => ({
    name: clip(channel.name ?? "Voice room", 100, ""),
    userLimit: channel.userLimit ?? 0,
    hidden: everyoneDenies(overwrites, serverId, Permissions.ViewChannel),
    locked: everyoneDenies(overwrites, serverId, Permissions.Connect),
    region: channel.rtcRegion ?? null,
})

/**
 * A member in a room takes it over once its owner left, or the owner or staff give it to a member in it. Who is in a room comes from
 * the voice tracker, which knows nothing until Fluxer sends its voice list. A new owner of a hidden or locked room gets the access hide
 * gives. roomId names the room a panel reaction or a website request is about, and a claim then needs the member in that room
 */
function handOverRoom(
    store: VoiceStore,
    runtime: VoiceRuntime,
    client: Client,
    serverId: string,
    authorId: string,
    command: Extract<VoiceCommand, { type: "claim" | "transfer" }>,
    named?: string,
) {
    return Effect.gen(function* () {
        yield* runtime.ready
        const inside = runtime.memberRoom(authorId)
        if (inside === undefined) return refused(notReady)
        const roomId = command.type === "claim" ? inside : (named ?? runtime.ownedRoom(authorId)?.channelId ?? inside)
        if (!roomId)
            return refused(
                command.type === "claim"
                    ? "Join the voice room you want to claim first"
                    : "You do not own a temporary voice room. Join a generator to create one",
            )
        if (command.type === "claim" && named !== undefined && named !== inside)
            return refused("Join the voice room you want to claim first")
        const newOwner = command.type === "claim" ? authorId : command.userId
        const { authority, actor, botBits } = yield* readVoiceAuthority(
            client,
            serverId,
            authorId,
            roomId,
            newOwner === authorId ? undefined : newOwner,
        )
        const checked = yield* store.query({ serverId, operation: { type: "authority", actor, channelId: roomId } })
        if (checked.type !== "authority" || !checked.room) return refused("That channel is not a temporary voice room")
        if (checked.paused) return refused(paused)
        if (memberTimeout(client, authority.actor, yield* Clock.currentTimeMillis) !== "none") return refused(timedOut)
        if (isConfined(serverId, authorId)) return refused(jailedActor)
        // A new owner of a hidden or locked room gets a member overwrite, which would beat the jail role
        if (isConfined(serverId, newOwner)) return refused("A jailed member cannot own a temporary voice room")
        // Another bot in the room can react to the card, and a bot never owns a room
        if (authority.actor.isBot) return refused("A bot cannot own a temporary voice room")
        const room = checked.room,
            occupants = runtime.occupants(roomId)
        if (!occupants) return refused(notReady)
        if (command.type === "claim") {
            if (room.ownerId === authorId) return refused("You already own this room")
            if (occupants.includes(room.ownerId)) return refused("The owner is still in this room")
        } else {
            if (room.ownerId !== authorId && !checked.staff)
                return refused(`Only the room owner or ${staffRule} can give this room away`)
            if (!occupants.includes(newOwner) || !authority.target) return refused("They must be in your room")
            if (authority.target.isBot) return refused("A bot cannot own a temporary voice room")
        }
        if (runtime.ownedRoom(newOwner))
            return refused(
                command.type === "claim"
                    ? "You already own a temporary voice room"
                    : "They already own a temporary voice room",
            )
        const result = yield* store.rooms({
            serverId,
            operation: { type: "transfer", channelId: roomId, expectedOwnerId: room.ownerId, ownerId: newOwner },
        })
        if (result.type !== "transferred")
            return refused(
                result.type === "not-transferred" && result.reason === "owner"
                    ? command.type === "claim"
                        ? "You already own a temporary voice room"
                        : "They already own a temporary voice room"
                    : "This room changed meanwhile. Check it and try again",
            )
        runtime.setRoom(result.room)
        const owned =
            command.type === "claim" ? "You own this room now" : `${format.userMention(newOwner)} owns this room now`
        // A hidden or locked room keeps its old owner's access, and the new owner gets the same access hide gives
        const roomOverwrites = authority.channel?.permissionOverwrites ?? []
        if (
            everyoneDenies(roomOverwrites, serverId, Permissions.ViewChannel) ||
            everyoneDenies(roomOverwrites, serverId, Permissions.Connect)
        ) {
            if ((botBits & Permissions.ManageRoles) === 0n)
                return done(
                    `${owned}. ${fixSentence({ permissions: permissionNames(Permissions.ManageRoles), channelId: roomId })}`,
                )
            const current = roomOverwrites.find((entry) => entry.id === newOwner && entry.type === "member") ?? {
                id: newOwner,
                type: "member" as const,
                allow: 0n,
                deny: 0n,
            }
            yield* client.channels.setPermissionOverwrite(roomId, {
                id: newOwner,
                type: "member",
                ...permissionBits.patchOverwrite(current, { allow: access }),
            })
        }
        return done(owned)
    })
}

/**
 * A reaction on a room's controls card applies the same rule as the command it stands for. The member's reaction goes once either way and
 * a refused one gets no reply. A reaction on any other message answers false after reading only memory. Answers whether the message was a card
 */
export function handleVoicePanelReaction(
    store: VoiceStore,
    runtime: VoiceRuntime,
    client: Client,
    serverId: string,
    reaction: Pick<MessageReaction, "id" | "channelId" | "guildId" | "emoji">,
    userId: string,
) {
    return Effect.gen(function* () {
        const roomId = reaction.guildId === serverId ? runtime.panelRoom(reaction.id) : undefined
        if (!roomId) return false
        const action = voicePanelAction(reaction.emoji)
        if (!action) return true
        yield* (
            action === "claim"
                ? handOverRoom(store, runtime, client, serverId, userId, { type: "claim" }, roomId)
                : changeRoom(
                      store,
                      runtime,
                      client,
                      serverId,
                      userId,
                      action === "lock"
                          ? { type: "toggle-lock", roomId }
                          : action === "hide"
                            ? { type: "toggle-hide", roomId }
                            : { type: "limit-step", roomId, by: action === "limit-up" ? 1 : -1 },
                  )
        ).pipe(Effect.catch((error) => warnFailure("A room controls reaction could not be applied", error)))
        yield* client.messages
            .removeUserReaction({ id: reaction.id, channelId: reaction.channelId }, reaction.emoji.name!, userId, {
                timeoutMs: 5000,
            })
            .pipe(Effect.ignore)
        return true
    })
}

/** A website page reads as plain text, so a reply's mention becomes words */
const plainText = (text: string) => clip(text.replace(/<#\d+>/g, "your room").replace(/<@!?\d+>/g, "that member"), 512)

/** A website request runs the same checks and native work as the chat command, so the website never decides authority */
function memberRequest(
    store: VoiceStore,
    runtime: VoiceRuntime,
    client: Client,
    serverId: string,
    actorId: string,
    operation: VoiceMemberOperation,
): Effect.Effect<RoomOutcome, unknown> {
    return Effect.gen(function* () {
        if (operation.type === "lookup") {
            yield* runtime.ready
            const room = runtime.ownedRoom(actorId)
            if (!room) return done("No room")
            const { authority } = yield* readVoiceAuthority(client, serverId, actorId, room.channelId)
            if (!authority.channel) return refused("That channel is not a temporary voice room")
            yield* runtime.updateRoom(room.channelId, {
                view: {
                    ...roomView(authority.channel, authority.channel.permissionOverwrites ?? [], serverId),
                    observedAt: yield* Clock.currentTimeMillis,
                },
            })
            return done("Read")
        }
        if (operation.type === "transfer") {
            return yield* handOverRoom(
                store,
                runtime,
                client,
                serverId,
                actorId,
                { type: "transfer", userId: operation.userId },
                operation.roomId,
            )
        }
        return yield* changeRoom(store, runtime, client, serverId, actorId, operation)
    })
}
/**
 * The dashboard pass for website room requests. Each is claimed once before it acts, with the member's fresh roles for the automod check of a new
 * name. A report that fails leaves the claimed request to expire as uncertain, and only the member's next request acts again
 */
export function processVoiceMemberPass(store: VoiceStore, runtime: VoiceRuntime, serverId: string, client: Client) {
    return Effect.gen(function* () {
        const ready = yield* store.memberReady({ serverId })
        for (const job of ready.jobs) {
            if ((yield* Clock.currentTimeMillis) >= job.expiresAt) continue
            const outcome = yield* Effect.gen(function* () {
                const { roleIds } = yield* readSafetyAuthority(client, serverId, job.actorId)
                const { started } = yield* store.memberStart({
                    serverId,
                    jobId: job.id,
                    actorId: job.actorId,
                    roleIds: [...roleIds],
                })
                if (!started) return undefined
                return yield* memberRequest(store, runtime, client, serverId, job.actorId, job.operation)
            }).pipe(
                Effect.catchCause((cause) =>
                    Cause.hasInterrupts(cause)
                        ? Effect.failCause(cause)
                        : Effect.succeed(refused(describe(Cause.squash(cause)))),
                ),
            )
            if (!outcome) continue
            yield* store
                .memberFinish({
                    serverId,
                    jobId: job.id,
                    ...(outcome.ok ? {} : { error: plainText(outcome.text) }),
                })
                .pipe(Effect.catch((error) => warnFailure("A website voice request could not be finished", error)))
        }
    })
}

/** Native work a dashboard voice request needs before the backend applies it, with an undo for a channel that was only just created */
export function prepareVoiceDashboardJob(client: Client, serverId: string, job: DashboardConfigurationReadyJob) {
    return Effect.gen(function* () {
        if (job.family !== "voice") return undefined
        const op = job.operation
        if (op.type === "generator-add") {
            const created = yield* client.channels.create(
                serverId,
                { type: ChannelType.Voice, name: op.channelName, parentId: op.categoryId },
                { auditReason: "Voice generator" },
            )
            return {
                context: { originServerId: serverId, channelId: created.id } satisfies VoiceDashboardContext,
                undo: client.channels
                    .delete(created.id, { auditReason: "Voice generator could not be saved" })
                    .pipe(Effect.catch(() => Effect.void)),
            }
        }
        if (op.type === "generator-set" && op.patch.channelName !== undefined)
            yield* client.channels.edit(
                op.channelId,
                { name: op.patch.channelName },
                { auditReason: "Voice generator renamed" },
            )
        return { undo: Effect.void }
    })
}
export function finishVoiceDashboardJob(
    serverId: string,
    state: DashboardConfigurationJob["state"],
    work: { undo: Effect.Effect<void> },
) {
    return Effect.gen(function* () {
        if (state !== "applied") yield* work.undo
        const runtime = voiceRuntimes.get(serverId)
        if (runtime) yield* runtime.reload()
    })
}

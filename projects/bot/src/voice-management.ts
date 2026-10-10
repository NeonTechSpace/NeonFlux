import type { VoiceDashboardContext, VoiceGenerator, VoiceGeneratorPatch, VoiceManageOperation } from "@neonflux/contracts/voice"
import type { DashboardConfigurationJob, DashboardConfigurationReadyJob } from "@neonflux/contracts/dashboard"
import { ChannelType, format, Permissions, type BotEventContext, type Client, type PermissionOverwrite } from "@neontechspace/fluxerly/effect"
import { Effect } from "effect"
import type { BotConfig } from "./config.ts"
import { voiceHelp, type VoiceCommand, type VoiceRoomControl } from "./voice-command.ts"
import { readVoiceAuthority } from "./voice-permissions.ts"
import { VoiceStoreError, type VoiceStore } from "./voice-store.ts"
import { voiceGeneratorLimit, voiceRoomLimit, voiceRuntimes, type VoiceRuntime } from "./voice-worker.ts"
import { SafetyPermissionError } from "./safety-permissions.ts"
import { fixSentence, nativeFix, permissionNames } from "./permission-fix.ts"
import { code, replyCard, replyText } from "./reply-style.ts"
import { sourceTimestamp } from "./responses.ts"
import { replyPrefix, withPrefix } from "./general-settings.ts"

export const voiceDefaultTemplate = "{owner}'s room"
const access = Permissions.ViewChannel | Permissions.Connect
const staffRule = "the server owner, an Administrator or a moderation staff role with Manage Channels"

function describe(error: unknown) {
    if (error instanceof VoiceStoreError) {
        if (error.status === 403) return `Only ${staffRule} can manage voice generators`
        if (error.status === 404) return "That channel is not a generator. Check !voice generator list"
        if (error.status === 409) return "That channel is already a generator or a temporary room, or its settings changed. Check !voice generator list"
        if (error.status === 429) return `A server can have at most ${voiceGeneratorLimit} generators`
        if (error.status === 400) return "Check the voice command values. Use !voice help"
        return "Voice settings are unavailable right now. Try again shortly"
    }
    if (error instanceof SafetyPermissionError) return "Current permissions could not be read. Try again shortly"
    if (error !== null && typeof error === "object" && (error as { _tag?: unknown })._tag === "ChannelOperationError") {
        return nativeFix(error) ?? "Fluxer refused the channel change. NeonFlux needs Manage Channels, and Manage Roles to change visibility or member access"
    }
    return "The voice command could not be completed"
}
const rooms = (generator: VoiceGenerator) => `Rooms named "${generator.template}"${generator.categoryId ? ` in ${format.channelMention(generator.categoryId)}` : ""}, `
    + `${generator.userLimit ? `up to ${generator.userLimit} members` : "no member limit"}, ${generator.region ? `region ${generator.region}` : "automatic region"}`
/** The one generator setting a command changed, with its new value */
function generatorChange(patch: VoiceGeneratorPatch, generator: VoiceGenerator) {
    const where = format.channelMention(generator.channelId), from = `Rooms from ${where}`
    if (patch.channelName !== undefined) return `Generator ${where} renamed to ${patch.channelName}`
    if (patch.categoryId !== undefined) return generator.categoryId ? `${from} now open in ${format.channelMention(generator.categoryId)}` : `${from} now open outside any category`
    if (patch.template !== undefined) return `${from} are now named "${generator.template}"`
    if (patch.userLimit !== undefined) return generator.userLimit ? `${from} now hold up to ${generator.userLimit} members` : `${from} now have no member limit`
    return generator.region ? `${from} now use region ${generator.region}` : `${from} now use the automatic region`
}

export function handleVoiceCommand(store: VoiceStore, runtime: VoiceRuntime, config: BotConfig, command: VoiceCommand | { error: string }, context: BotEventContext<"messageCreate">) {
    const prefix = replyPrefix(config.serverId, context.message.guildId)
    const reply = (content: string) => replyText(context, withPrefix(content, prefix))
    return Effect.gen(function* () {
        const { message } = context
        if (message.guildId !== config.serverId) return
        if ("error" in command) { yield* reply(command.error); return }
        if (command.type === "help") { yield* reply(voiceHelp); return }
        if (command.type === "generator-add" || command.type === "generator-list" || command.type === "generator-remove" || command.type === "generator-set") {
            yield* manageGenerators(store, runtime, config, command, context, reply)
        } else yield* controlRoom(store, runtime, config, command, context, reply)
    }).pipe(Effect.catch(error => reply(describe(error))))
}

function manageGenerators(store: VoiceStore, runtime: VoiceRuntime, config: BotConfig, command: Extract<VoiceCommand, { type: `generator-${string}` }>,
    context: BotEventContext<"messageCreate">, reply: (content: string) => Effect.Effect<unknown, unknown>) {
    return Effect.gen(function* () {
        const { message, client } = context, serverId = config.serverId
        const { actor } = yield* readVoiceAuthority(client, serverId, message.author.id)
        const authority = yield* store.query({ serverId, operation: { type: "authority", actor } })
        if (authority.type !== "authority" || !authority.staff) { yield* reply(`Only ${staffRule} can manage voice generators`); return }
        if (command.type === "generator-list") {
            yield* replyCard(context, serverId, { title: "Voice generators", description: authority.generators.map(generator => `${format.channelMention(generator.channelId)}: ${rooms(generator)}`).join("\n")
                || `No voice generators yet. Add one with ${code(`${replyPrefix(serverId, message.guildId)}voice generator add "Join to create"`)}`,
                footer: `${authority.generators.length} of ${voiceGeneratorLimit} generators, ${authority.rooms} of ${voiceRoomLimit} temporary rooms in use` })
            return
        }
        const manage = (operation: VoiceManageOperation) => sourceTimestamp(message).pipe(Effect.flatMap(createdAt => store.manage({ serverId, messageId: message.id, createdAt, actor, operation })))
        const category = command.type === "generator-add" ? command.categoryId : command.type === "generator-set" ? command.patch.categoryId : undefined
        if (typeof category === "string" && !(yield* isCategory(client, serverId, category))) { yield* reply("Choose a category ID from this server, or none"); return }
        if (command.type === "generator-remove") {
            yield* manage({ type: "generator-remove", channelId: command.channelId })
            runtime.removeGenerator(command.channelId)
            yield* reply(`Generator removed. ${format.channelMention(command.channelId)} stays as an ordinary voice channel, and its existing rooms are still deleted once they are empty`)
            return
        }
        if (command.type === "generator-add") {
            if (authority.generators.length >= voiceGeneratorLimit) { yield* reply(`A server can have at most ${voiceGeneratorLimit} generators`); return }
            const created = yield* client.channels.create(serverId, { type: ChannelType.Voice, name: command.channelName, parentId: command.categoryId }, { auditReason: "Voice generator" })
            const result = yield* manage({ type: "generator-add", channelId: created.id, channelName: command.channelName, categoryId: command.categoryId, template: voiceDefaultTemplate, userLimit: null, region: null })
                .pipe(Effect.tapError(() => client.channels.delete(created.id, { auditReason: "Voice generator could not be saved" }).pipe(Effect.catch(() => Effect.void))))
            if (result.type === "generator") runtime.setGenerator(result.generator)
            yield* reply(`Generator ${format.channelMention(created.id)} created. Members who join it get their own room named "${voiceDefaultTemplate}"\nChange its name, room names, limit, region or category with \`!voice generator set\``)
            return
        }
        if (!authority.generators.some(generator => generator.channelId === command.channelId)) { yield* reply("That channel is not a generator. Check !voice generator list"); return }
        if (command.patch.channelName !== undefined) yield* client.channels.edit(command.channelId, { name: command.patch.channelName }, { auditReason: "Voice generator renamed" })
        const result = yield* manage({ type: "generator-set", channelId: command.channelId, patch: command.patch })
        // The line can quote a room name template, so it is sent as it is
        if (result.type === "generator") { runtime.setGenerator(result.generator); yield* replyText(context, generatorChange(command.patch, result.generator)) }
    })
}
function isCategory(client: Client, serverId: string, channelId: string) {
    return client.channels.fetch(channelId, { timeoutMs: 5000 }).pipe(Effect.map(channel => channel.id === channelId && channel.guildId === serverId && channel.type === ChannelType.Category),
        Effect.catch(() => Effect.succeed(false)))
}

function controlRoom(store: VoiceStore, runtime: VoiceRuntime, config: BotConfig, command: VoiceRoomControl, context: BotEventContext<"messageCreate">,
    reply: (content: string) => Effect.Effect<unknown, unknown>) {
    return Effect.gen(function* () {
        const { message, client } = context, serverId = config.serverId
        const roomId = command.roomId ?? runtime.ownedRoom(message.author.id)?.channelId
        if (!roomId) { yield* reply("You do not own a temporary voice room. Join a generator to create one"); return }
        // Fresh native reads come first, then the backend confirms the room record and the owner or staff rule
        const { authority, actor, botBits } = yield* readVoiceAuthority(client, serverId, message.author.id, roomId)
        const checked = yield* store.query({ serverId, operation: { type: "authority", actor, channelId: roomId } })
        const channel = authority.channel
        if (checked.type !== "authority" || !checked.room || channel?.type !== ChannelType.Voice) { yield* reply("That channel is not a temporary voice room"); return }
        const room = checked.room
        if (room.ownerId !== message.author.id && !checked.staff) { yield* reply(`Only the room owner or ${staffRule} can change this room`); return }
        const overwrites = command.type === "hide" || command.type === "show" || command.type === "allow" || command.type === "block"
        const required = Permissions.ViewChannel | (overwrites ? Permissions.ManageRoles : Permissions.ManageChannels)
        if ((botBits & required) !== required) { yield* reply(fixSentence({ permissions: permissionNames(required & ~botBits), channelId: roomId })); return }
        const current = (id: string, type: "role" | "member"): PermissionOverwrite => channel.permissionOverwrites?.find(entry => entry.id === id && entry.type === type) ?? { id, type, allow: 0n, deny: 0n }
        const grant = (id: string, type: "role" | "member", bits: bigint) => { const entry = current(id, type); return client.channels.setPermissionOverwrite(roomId, { id, type, allow: entry.allow | bits, deny: entry.deny & ~bits }) }
        const deny = (id: string, type: "role" | "member", bits: bigint) => { const entry = current(id, type); return client.channels.setPermissionOverwrite(roomId, { id, type, allow: entry.allow & ~bits, deny: entry.deny | bits }) }
        if (command.type === "rename") { yield* client.channels.edit(roomId, { name: command.name }); yield* reply(`Room renamed to ${command.name}`); return }
        if (command.type === "limit") { yield* client.channels.edit(roomId, { userLimit: command.limit }); yield* reply(command.limit ? `Room limit set to ${command.limit} members` : "Room limit removed"); return }
        if (command.type === "hide") {
            // The bot keeps sight of its rooms, or Fluxer would stop delivering their voice events
            yield* grant(authority.botId, "member", access)
            yield* grant(room.ownerId, "member", access)
            yield* deny(serverId, "role", Permissions.ViewChannel)
            yield* reply("Room hidden from everyone without explicit access")
            return
        }
        if (command.type === "show") {
            const everyone = current(serverId, "role")
            yield* client.channels.setPermissionOverwrite(roomId, { id: serverId, type: "role", allow: everyone.allow, deny: everyone.deny & ~Permissions.ViewChannel })
            yield* reply("Room visible again")
            return
        }
        if (command.type !== "allow" && command.type !== "block") return
        if (command.type === "allow") { yield* grant(command.userId, "member", access); yield* reply(`${format.userMention(command.userId)} can see and join this room`); return }
        if (command.userId === room.ownerId || command.userId === authority.botId) { yield* reply("The room owner and NeonFlux cannot be blocked"); return }
        yield* deny(command.userId, "member", access)
        yield* reply(`${format.userMention(command.userId)} can no longer see or join this room. Members already inside stay connected`)
    })
}

/** Native work a dashboard voice request needs before the backend applies it, with an undo for a channel that was only just created */
export function prepareVoiceDashboardJob(client: Client, serverId: string, job: DashboardConfigurationReadyJob) {
    return Effect.gen(function* () {
        if (job.family !== "voice") return undefined
        const op = job.operation
        if (op.type === "generator-add") {
            const created = yield* client.channels.create(serverId, { type: ChannelType.Voice, name: op.channelName, parentId: op.categoryId }, { auditReason: "Voice generator" })
            return { context: { originServerId: serverId, channelId: created.id } satisfies VoiceDashboardContext,
                undo: client.channels.delete(created.id, { auditReason: "Voice generator could not be saved" }).pipe(Effect.catch(() => Effect.void)) }
        }
        if (op.type === "generator-set" && op.patch.channelName !== undefined) yield* client.channels.edit(op.channelId, { name: op.patch.channelName }, { auditReason: "Voice generator renamed" })
        return { undo: Effect.void }
    })
}
export function finishVoiceDashboardJob(serverId: string, state: DashboardConfigurationJob["state"], work: { undo: Effect.Effect<void> }) {
    return Effect.gen(function* () {
        if (state !== "applied") yield* work.undo
        const runtime = voiceRuntimes.get(serverId)
        if (runtime) yield* runtime.reload()
    })
}

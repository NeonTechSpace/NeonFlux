import type * as C from "@neonflux/backend/contracts"
import { ChannelType, format, Permissions, type BotEventContext, type Client, type PermissionOverwrite } from "@neontechspace/fluxerly/effect"
import { Clock, Effect } from "effect"
import type { BotConfig } from "./config.ts"
import { readServerManager, replyPrefix, withPrefix } from "./general-settings.ts"
import { lfgHelp, type LfgCommand } from "./lfg-command.ts"
import { LfgStoreError, type LfgStore } from "./lfg-store.ts"
import { lfgCard, updateLfgCard } from "./lfg-worker.ts"
import { at, code, duration, notSetUp, onOff, replyCard, replyText, usage, type Card } from "./reply-style.ts"
import { nextPosition, noNextPage, pageKey, rememberPosition } from "./paging.ts"
import { fixSentence, nativeFix } from "./permission-fix.ts"
import { noMentions, sourceTimestamp } from "./responses.ts"
import { channelPermissionInput, readAuthenticatedBotId, SafetyPermissionError } from "./safety-permissions.ts"
import { createRoomChannel, groupRoomGraceMs, voiceRoomLimit, type VoiceRuntime } from "./voice-worker.ts"

const access = Permissions.ViewChannel | Permissions.Connect
const posting = Permissions.ViewChannel | Permissions.SendMessages
const managerRule = "the server owner or members with Manage Server"
/** Open groups on one page of !lfg list */
const GROUP_PAGE = 10

function refusalText(result: Extract<C.LfgManageResult, { type: "refused" }>) {
    const limit = result.limit ?? 0
    switch (result.reason) {
        case "off": return "Looking for group is off here or has no group channel yet. A manager sets it up with !lfg config"
        case "size": return `Groups here have at most ${limit} members, counting the host`
        case "member-limit": return `You already host ${limit === 1 ? "an open group" : `${limit} open groups`}. Cancel one with !lfg cancel <group> or wait until it closes`
        case "server-limit": return `This server already has ${limit} open groups, its limit. Join one from !lfg list`
        case "missing": return "That group is not open. Check !lfg list"
        case "joined": return "You are already in that group"
        case "full": return "That group is full"
        case "host": return "You host that group. Cancel it with !lfg cancel <group> instead"
        case "not-joined": return "You are not in that group"
        case "permission": return `Only the host or ${managerRule} can do that while the group is not full`
        case "generator": return "No voice generator is chosen for group rooms. A manager chooses one with !lfg config generator #generator"
        case "room-limit": return `This server has reached its limit of ${voiceRoomLimit} temporary voice rooms. Try again when one is gone`
    }
}
// A refusal the backend reported means nothing was written. No status, 429 and 5xx leave the outcome unknown
const refusedStart = (error: LfgStoreError) => error.status !== null && error.status >= 400 && error.status < 500 && error.status !== 429
function describe(error: unknown) {
    if (error instanceof LfgStoreError) {
        if (error.status === 403) return `Only ${managerRule} can change looking for group settings`
        if (error.status === 404) return "That channel is not a voice generator. Check !voice generator list"
        if (error.status === 409) return "Looking for group settings changed on the website while this command ran. Try again"
        if (error.status === 400) return "Check the command values. Use !lfg help"
        return "Looking for group is unavailable right now. Try again shortly"
    }
    if (error instanceof SafetyPermissionError) return "Current permissions could not be read. Try again shortly"
    return nativeFix(error) ?? "Fluxer refused the change. NeonFlux needs Manage Channels and Manage Roles for group rooms"
}
const settingsCard = (settings: C.LfgSettings, prefix: string, open: number): Card => ({ title: "Looking for group", fields: [["Status", onOff(settings.enabled)],
    ["Group channel", settings.channelId ? format.channelMention(settings.channelId) : `Not set. Run ${code(`${prefix}lfg config channel #channel`)}`],
    ["Voice generator", settings.generatorChannelId ? format.channelMention(settings.generatorChannelId) : `Not set. Run ${code(`${prefix}lfg config generator #generator`)}`],
    ["Group size", `Up to ${settings.maxSize} members`], ["Open for", duration(settings.expiryMinutes * 60)], ["Groups each member hosts", `Up to ${settings.memberGroups}`],
    ["Open groups", `Up to ${settings.serverGroups} at once, ${open} open now`]] })
/** The one setting a config command changed, with its new value. Commands use ! because replies print them with the server's prefix */
function settingsChange(patch: C.LfgSettingsPatch, s: C.LfgSettings) {
    if (patch.enabled !== undefined) return !s.enabled ? "Looking for group is off" : s.channelId ? `Looking for group is on in ${format.channelMention(s.channelId)}`
        : "Looking for group is on. Members can post groups once a manager sets a group channel with `!lfg config channel #channel`"
    if (patch.channelId !== undefined) return s.channelId ? `Groups are now posted in ${format.channelMention(s.channelId)}` : "Looking for group has no group channel now, so members cannot post groups"
    if (patch.generatorChannelId !== undefined) return s.generatorChannelId ? `Group rooms now open from ${format.channelMention(s.generatorChannelId)}` : "No voice generator is chosen for group rooms now, so groups cannot start"
    if (patch.expiryMinutes !== undefined) return `Groups now stay open for ${duration(s.expiryMinutes * 60)}`
    if (patch.maxSize !== undefined) return `Groups now have up to ${s.maxSize} members, counting the host`
    if (patch.memberGroups !== undefined) return `Each member can now host up to ${s.memberGroups} open group${s.memberGroups === 1 ? "" : "s"}`
    return `The server can now have up to ${s.serverGroups} open groups`
}

// The room the group may see: NeonFlux and every member get access like !voice allow, and a new room is hidden from everyone else like !voice hide
function shareRoom(client: Client, serverId: string, roomId: string, overwrites: readonly PermissionOverwrite[], userIds: readonly string[], hide: boolean) {
    return Effect.gen(function* () {
        const current = (id: string, type: "role" | "member") => overwrites.find(entry => entry.id === id && entry.type === type) ?? { id, type, allow: 0n, deny: 0n }
        const members = hide ? [yield* readAuthenticatedBotId(client), ...userIds] : userIds
        for (const id of members) { const entry = current(id, "member"); yield* client.channels.setPermissionOverwrite(roomId, { id, type: "member", allow: entry.allow | access, deny: entry.deny & ~access }) }
        if (!hide) return
        const everyone = current(serverId, "role")
        yield* client.channels.setPermissionOverwrite(roomId, { id: serverId, type: "role", allow: everyone.allow & ~Permissions.ViewChannel, deny: everyone.deny | Permissions.ViewChannel })
    })
}

export function handleLfgCommand(store: LfgStore | undefined, rooms: VoiceRuntime | undefined, config: BotConfig, command: LfgCommand | { error: string }, context: BotEventContext<"messageCreate">) {
    const prefix = replyPrefix(config.serverId, context.message.guildId)
    const reply = (content: string) => replyText(context, withPrefix(content, prefix)), card = (value: Card) => replyCard(context, config.serverId, value)
    return Effect.gen(function* () {
        const { message, client } = context, serverId = config.serverId, userId = message.author.id
        if (message.guildId !== serverId) return
        if (!store || !rooms) { yield* reply(notSetUp("Looking for group")); return }
        if ("error" in command) { yield* reply(command.error); return }
        if (command.type === "help") { yield* reply(lfgHelp); return }
        const source = { serverId, originServerId: serverId, messageId: message.id, createdAt: yield* sourceTimestamp(message) }
        const member: C.ModerationActor = { originServerId: serverId, userId, roleIds: [], isOwner: false, isAdministrator: false, nativePermissionAuthorized: false }
        const manage = (operation: C.LfgOperation, actor = member, managerAuthorized = false) => store.manage({ ...source, actor, managerAuthorized, operation })
        // Cancelling or starting another member's group needs a manager, read fresh only when the backend asks for it
        const asManager = (operation: C.LfgOperation) => manage(operation).pipe(Effect.flatMap(result => result.type !== "refused" || result.reason !== "permission" ? Effect.succeed(result)
            : readServerManager(client, serverId, userId).pipe(Effect.flatMap(read => read.manager ? manage(operation, read.actor, true) : Effect.succeed(result)))))
        const deleteChannel = (channelId: string) => client.channels.delete(channelId, { auditReason: "Group room could not be recorded" }).pipe(Effect.catch(() => Effect.void))

        if (command.type === "list" || command.type === "config") {
            const key = pageKey(serverId, message, "lfg", "list"), next = command.type === "list" && command.next ? nextPosition<number>(key) : 1
            if (next === undefined) { yield* reply(noNextPage("!lfg list")); return }
            const found = yield* store.query({ serverId, operation: { type: "list" } })
            if (found.type !== "groups") return
            if (command.type === "config") { yield* card(settingsCard(found.settings, prefix, found.groups.length)); return }
            // Groups that closed since the last page can shorten the list, so next shows its last page at most
            const groups = found.groups, pages = Math.max(1, Math.ceil(groups.length / GROUP_PAGE)), page = Math.min(next, pages)
            rememberPosition(key, page < pages ? page + 1 : undefined)
            yield* card({ title: "Open groups", ...groups.length ? { description: groups.slice((page - 1) * GROUP_PAGE, page * GROUP_PAGE)
                .map(group => `**#${group.groupNo}** ${group.activity}, ${group.memberIds.length} of ${group.size}, hosted by ${format.userMention(group.hostId)}, open until ${at(group.expiresAt)}`).join("\n"),
                note: `Join one with ${code(`${prefix}lfg join <group>`)}`, ...page < pages ? { fields: [["Next", code(`${prefix}lfg list next`)] as const] } : {},
                footer: `${usage(groups.length, found.settings.serverGroups)} group${groups.length === 1 ? "" : "s"} open` }
                : { description: `No open groups yet. Post one with ${code(`${prefix}lfg "activity" <size>`)}` } })
            return
        }
        if (command.type === "config-set") {
            const channelId = command.patch.channelId ?? undefined
            const { authority, actor, manager } = yield* readServerManager(client, serverId, userId, channelId)
            if (!manager) { yield* reply(`Only ${managerRule} can change looking for group settings`); return }
            if (channelId) {
                const channel = authority.channel
                if (channel?.type !== ChannelType.Text && channel?.type !== ChannelType.Announcement) { yield* reply("Choose a text or announcement channel of this server"); return }
                const bits = client.permissions.calculate({ guild: authority.guild, member: authority.bot, roles: authority.roles, ...channelPermissionInput(authority) })
                if ((bits & posting) !== posting) { yield* reply(fixSentence({ permissions: ["ViewChannel", "SendMessages"], channelId })); return }
            }
            const saved = yield* manage({ type: "settings", patch: command.patch }, actor, true)
            if (saved.type === "settings") yield* reply(settingsChange(command.patch, saved.settings))
            return
        }
        if (command.type === "create") {
            const { type: _type, ...fields } = command
            const result = yield* manage({ type: "create", ...fields })
            if (result.type === "refused") { yield* reply(refusalText(result)); return }
            if (result.type !== "group") return
            const group = result.group
            const sent = yield* client.messages.send(group.channelId, { content: lfgCard(group, { state: "open" }, prefix), allowedMentions: noMentions }, { timeoutMs: 5000 }).pipe(
                Effect.map(value => ({ id: value.id })), Effect.catch(error => Effect.succeed({ error })))
            // A group nobody can see is not left open
            if ("error" in sent) {
                yield* manage({ type: "cancel", groupNo: group.groupNo })
                yield* reply(`Could not post the group in <#${group.channelId}>. ${nativeFix(sent.error, group.channelId) ?? fixSentence({ permissions: ["ViewChannel", "SendMessages"], channelId: group.channelId })}`)
                return
            }
            yield* manage({ type: "card", groupNo: group.groupNo, messageId: sent.id })
            yield* reply(`Group #${group.groupNo} posted in <#${group.channelId}>. Others join with \`!lfg join ${group.groupNo}\``)
            return
        }
        const groupNo = command.groupNo
        if (command.type === "join" || command.type === "leave") {
            const result = yield* manage({ type: command.type, groupNo })
            if (result.type === "refused") { yield* reply(refusalText(result)); return }
            if (result.type !== "group") return
            const group = result.group
            yield* updateLfgCard(client, serverId, group, { state: "open" })
            if (command.type === "leave") { yield* reply(`You left group #${groupNo}`); return }
            if (group.memberIds.length < group.size) { yield* reply(`You joined group #${groupNo}, ${group.memberIds.length} of ${group.size} members`); return }
        }
        if (command.type === "cancel") {
            const result = yield* asManager({ type: "cancel", groupNo })
            if (result.type === "refused") { yield* reply(refusalText(result)); return }
            if (result.type !== "closed") return
            yield* updateLfgCard(client, serverId, result.group, { state: "cancelled" })
            yield* reply(`Group #${groupNo} cancelled`)
            return
        }
        // A join that filled the group or a start command creates the room
        const preview = yield* store.query({ serverId, operation: { type: "start", groupNo } })
        if (preview.type !== "start" || !preview.group) { yield* reply(refusalText({ type: "refused", reason: "missing" })); return }
        const group = preview.group
        let actor = member, managerAuthorized = false
        if (group.hostId !== userId && group.memberIds.length < group.size) {
            const read = yield* readServerManager(client, serverId, userId)
            if (!read.manager) { yield* reply(refusalText({ type: "refused", reason: "permission" })); return }
            actor = read.actor; managerAuthorized = true
        }
        if (!preview.generator) { yield* reply(refusalText({ type: "refused", reason: "generator" })); return }
        const created = yield* createRoomChannel(client, serverId, preview.generator, group.activity.replace(/[\u000c‮]/g, "").trim() || "Group room")
        // An unrecorded room would never be cleaned up, so the new channel is removed when the backend refuses the start. A lost
        // answer, such as a timeout, may hide a start that recorded the room and closed the group, so it is settled by a read instead
        const result = yield* manage({ type: "start", groupNo, channelId: created.id }, actor, managerAuthorized).pipe(
            Effect.tapError(error => refusedStart(error) ? deleteChannel(created.id) : Effect.void),
            Effect.catchIf(error => !refusedStart(error), () => Effect.succeed({ type: "unknown" as const })))
        if (result.type === "unknown") {
            // The start is never sent again. A room NeonFlux could not check follows the voice room rules like a recorded one
            const recorded = yield* rooms.recordedRoom(created.id).pipe(Effect.catch(() => Effect.succeed(undefined)))
            if (recorded === null) {
                yield* deleteChannel(created.id)
                yield* reply(`NeonFlux could not confirm that group #${groupNo} started, and its new room was not recorded, so the room was removed. Check !lfg list and start the group again if it is still open`)
                return
            }
            yield* rooms.adopt(recorded ?? { channelId: created.id, ownerId: group.hostId, generatorChannelId: preview.generator.channelId, createdAt: yield* Clock.currentTimeMillis }, groupRoomGraceMs)
            yield* reply(recorded ? `Group #${groupNo} started in <#${created.id}>, but NeonFlux lost the confirmation, so it did not call the group or limit who sees the room. Share the room with your group`
                : `NeonFlux could not confirm whether group #${groupNo} started. Its new room <#${created.id}> stays and is removed once it is empty. Check !lfg list before starting the group again`)
            return
        }
        if (result.type !== "started") {
            yield* deleteChannel(created.id)
            yield* reply(result.type === "refused" ? refusalText(result) : refusalText({ type: "refused", reason: "missing" }))
            return
        }
        const roomId = result.room.channelId, memberIds = result.group.memberIds
        if (result.created) yield* rooms.adopt(result.room, groupRoomGraceMs)
        else yield* deleteChannel(created.id)
        const problem = yield* shareRoom(client, serverId, roomId, result.created ? created.permissionOverwrites ?? [] : [], memberIds, result.created).pipe(Effect.as(undefined),
            Effect.catch(error => Effect.succeed(nativeFix(error, roomId) ?? fixSentence({ permissions: ["ManageRoles"], channelId: roomId }))))
        yield* client.messages.send(result.group.channelId, { content: `${memberIds.map(id => `<@${id}>`).join(" ")} Your group for ${result.group.activity} is ready in <#${roomId}>`,
            allowedMentions: { users: memberIds, roles: [], everyone: false, repliedUser: false } }, { timeoutMs: 5000 }).pipe(Effect.asVoid, Effect.catch(() => Effect.logWarning("A group could not be called to its room")))
        yield* updateLfgCard(client, serverId, result.group, { state: "started", roomId })
        yield* reply(`Group #${groupNo} started in <#${roomId}>${result.created ? "" : ", the host's room"}${problem ? `. Only the group should see it, but NeonFlux could not limit it: ${problem}` : ""}`)
    }).pipe(Effect.catch(error => reply(describe(error))), Effect.asVoid)
}

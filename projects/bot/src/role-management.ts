import type * as C from "@neonflux/backend/contracts"
import { format, type BotEventContext, type Client } from "@neontechspace/fluxerly/effect"
import { Clock, Effect } from "effect"
import type { BotConfig } from "./config.ts"
import { moderationActor } from "./moderation.ts"
import { sourceTimestamp } from "./responses.ts"
import { code, notSetUp, onOff, replyCard, replyText, type Card } from "./reply-style.ts"
import { readNativeMember } from "./member-evidence.ts"
import { roleHelp, type RoleCommand, type RoleCommandName } from "./role-command.ts"
import { readRoleAuthority, RolePermissionError, rolePermissionFix } from "./role-permissions.ts"
import { readSafetyAuthority } from "./safety-permissions.ts"
import { evaluateRoleRequest, roleMemberContext, roleSnapshots, roleEventSource, RoleHandlingError, withRoleMember } from "./roles.ts"
import { RolesStoreError, rolesErrorMessage, type RolesStore } from "./roles-store.ts"
import { performPublishingGrant } from "./publishing.ts"
import { readPublishingAuthority } from "./publishing-permissions.ts"
import { equalPublishingContent } from "./publishing-content.ts"
import type { PublishingStore } from "./publishing-store.ts"
import type { startRoleReactionWorker } from "./role-reconciliation.ts"
import { replyPrefix, withPrefix } from "./general-settings.ts"
import { nextPosition, noNextPage, pageKey, rememberPosition } from "./paging.ts"
import { sentenceList } from "./permission-fix.ts"

const roles = (ids: readonly string[]) => ids.map(format.roleMention).join(", ")
const kind = (panel: C.RolesPanel) => panel.kind === "verification" ? "Rules verification" : "Reaction roles"
const panelCard = (panel: C.RolesPanel, prefix: string): Card => ({ title: `Role panel ${panel.name}`, fields: [["Type", kind(panel)], ["Status", onOff(panel.enabled)],
    ["Mode", panel.exclusive ? "Exclusive, one role at a time" : "Toggle, any number of roles"], ...(panel.withdrawing ? [["Retiring", "Removing the roles it gave"] as const] : []),
    ["Roles", panel.mappings.map((m) => `${m.emoji} ${format.roleMention(m.roleId)}${m.prerequisiteRoleIds.length ? `, requires ${roles(m.prerequisiteRoleIds)}` : ""}${m.exclusionRoleIds.length ? `, excludes ${roles(m.exclusionRoleIds)}` : ""}`).join("\n")
        || `None yet. Add one with ${code(panel.kind === "verification" ? `${prefix}verify configure @role <emoji>` : `${prefix}roles map ${panel.name} <emoji> @role`)}`],
    ["Posted", !panel.published ? "Not posted yet" : `In ${format.channelMention(panel.published.channelId)}${panel.published.revision === panel.revision ? "" : ". Changed since then, so publish it again to apply the change"}`]] })
/** The one change a panel command made, with its new value. A posted panel shows a change only once it is published again */
function panelChange(command: RoleCommand, panel: C.RolesPanel) {
    const name = `Role panel ${panel.name}`, mapped = (emoji: string) => `${emoji} on role panel ${panel.name}`
    const line = command.type === "mode" ? `${name} is now ${panel.exclusive ? "exclusive, one role at a time" : "toggle, any number of roles"}`
        : command.type === "enable" || command.type === "disable" ? `${name} is ${onOff(panel.enabled).toLowerCase()}`
        : command.type === "mapping" ? `${mapped(command.emoji)} now gives ${format.roleMention(command.roleId)}`
        : command.type === "unmap" ? `${mapped(command.emoji)} no longer gives a role`
        : command.type === "scope" ? !command.roleIds.length ? `${mapped(command.emoji)} has no ${command.field === "prerequisites" ? "required" : "excluded"} roles now`
            : `${mapped(command.emoji)} now ${command.field === "prerequisites" ? "requires" : "excludes members with"} ${roles(command.roleIds)}`
        : command.type === "configure" ? `Accepting the rules with ${command.emoji} now gives ${format.roleMention(command.roleId)}`
        : command.type === "publish" && panel.published ? `${name} posted in ${format.channelMention(panel.published.channelId)}` : `${name} saved`
    return panel.published && panel.published.revision !== panel.revision ? `${line}. Publish it again to apply the change` : line
}
/** Up to five names and how many more, joined for a sentence */
const someNames = (names: readonly string[]) => sentenceList(names.length > 5 ? [...names.slice(0, 4), `${names.length - 4} more`] : names)
/** Reaction checks in one sentence, such as 4 reaction checks: 3 running, 1 stopped (panel colors). Only a stopped check needs staff */
function jobsCard(jobs: readonly C.RolesReactionJob[], prefix: string): Card {
    const of = (status: C.RolesReactionJob["status"]) => jobs.filter(job => job.status === status), stopped = of("blocked").map(job => job.name)
    const counts = [[of("running").length, "running"], [of("queued").length, "waiting"], [stopped.length, "stopped"]] as const, total = counts.reduce((sum, [count]) => sum + count, 0)
    const parts = counts.filter(([count]) => count).map(([count, state]) => `${count} ${state}${state === "stopped" ? ` (${stopped.length > 1 ? "panels" : "panel"} ${someNames(stopped)})` : ""}`)
    return { title: "Reaction checks", description: total ? `${total} reaction check${total === 1 ? "" : "s"}: ${parts.join(", ")}` : "No reaction checks are running",
        ...(stopped.length ? { note: `Send ${code(`${prefix}roles resume <panel>`)} to check a stopped panel again` } : {}) }
}
const claimStates: Record<C.RolesClaim["status"], string> = { idle: "Settled", pending: "In progress", uncertain: "Not confirmed yet" }
/** A role request's result in words. Delivery decides when a role change was attempted */
function requestText(result: C.RolesEvaluateResult, outcome?: { outcome: string, acknowledged: boolean }) {
    if (outcome) return outcome.outcome === "succeeded" ? outcome.acknowledged ? "Your roles are updated" : "Your roles changed, but NeonFlux could not record it yet"
        : outcome.outcome === "failed" ? "Your roles could not be changed" : outcome.outcome === "uncertain" ? "Your role change is not confirmed yet. Check your roles before you try again" : "Your role change is still in progress"
    return result.status === "blocked" ? "You can't get that role right now" : result.status === "ambiguous" ? "That request could not be settled. Try again"
        : result.status === "acknowledged" ? "Rules accepted" : result.status === "unchanged" ? "Nothing to change" : "Your role change is still in progress"
}
const configuration = (consumerKey: string) => consumerKey.startsWith("autorole:") ? "Autorole" : `Panel ${consumerKey.split(":")[1]}`

export function processRoleWithdrawal(store: RolesStore, serverId: string, client: Client, actorId: string, source: C.RolesSource, withdrawal: C.RolesWithdrawal,
    manage: (operation: Extract<C.RolesManageOperation, { type: "withdraw-departed" | "withdraw-next" }>) => Effect.Effect<C.RolesManageResult, unknown>,
    query: (cursor?: string) => Effect.Effect<C.RolesQueryResult, unknown>) {
    const withdrawTarget = (target: C.RolesWithdrawal["targets"][number]) => Effect.gen(function* () {
        const evidence = yield* readNativeMember(client, serverId, target.userId), native = evidence.member
        if (!native || native.joinedAt !== target.joinedAt) {
            const retired = yield* manage({ type: "withdraw-departed", withdrawalId: withdrawal.withdrawalId, userId: target.userId,
                joinedAt: target.joinedAt, originServerId: evidence.originServerId, memberUserId: evidence.userId,
                currentJoinedAt: native?.joinedAt ?? null, observedAt: yield* Clock.currentTimeMillis })
            return retired.duplicate || retired.type !== "withdrawal" || retired.withdrawal.status !== "blocked"
        }
        const applied = yield* evaluateRoleRequest(store, serverId, client,
            { ...source, sourceId: roleEventSource("withdraw", source.sourceId, withdrawal.withdrawalId, target.userId, target.joinedAt, target.roleId) },
            target.userId, { type: "withdraw", withdrawalId: withdrawal.withdrawalId, roleId: target.roleId }, actorId, native.isBot, target.joinedAt)
            .pipe(effect => withRoleMember(client, target.userId, effect, serverId))
        return applied.result.status !== "blocked" && (!applied.outcome || applied.outcome.outcome === "succeeded" && applied.outcome.acknowledged)
    })
    return Effect.gen(function* () {
        let current = withdrawal, conflicts = 0, cursor: string | undefined
        const skipped = new Set<string>()
        // One bounded run pages through the withdrawal itself and moves past targets that cannot be confirmed
        for (let round = 0; round < 50 && current.status !== "complete"; round++) {
            const targets = current.targets.filter((target) => !skipped.has(`${target.userId}:${target.joinedAt}:${target.roleId}`))
            for (const target of targets) {
                const done = yield* withdrawTarget(target).pipe(Effect.match({ onFailure: () => false, onSuccess: (value) => value }))
                if (!done) { conflicts++; skipped.add(`${target.userId}:${target.joinedAt}:${target.roleId}`) }
            }
            if (targets.length) {
                const found = yield* query(cursor)
                if (found.type === "withdrawal") current = found.withdrawal
                continue
            }
            // Skipped targets stay for later recovery while the next page is inspected
            if (current.targets.length) {
                if (!current.nextCursor) break
                cursor = current.nextCursor
                const found = yield* query(cursor)
                if (found.type === "withdrawal") current = found.withdrawal
                continue
            }
            // Acknowledgment and configuration cleanup continue once no target remains on the first page
            if (cursor !== undefined || current.status !== "pending") break
            const settled = yield* manage({ type: "withdraw-next", withdrawalId: current.withdrawalId, expectedStep: current.step })
            if (settled.duplicate || settled.type !== "withdrawal") break
            current = settled.withdrawal
        }
        return { withdrawal: current, conflicts }
    })
}

export function handleRoleCommand(store: RolesStore, publishing: PublishingStore | undefined, config: BotConfig,
    name: RoleCommandName, command: RoleCommand | { error: string }, context: BotEventContext<"messageCreate">,
    worker?: Effect.Success<ReturnType<typeof startRoleReactionWorker>>) {
    const prefix = replyPrefix(config.serverId, context.message.guildId)
    const reply = (content: string) => replyText(context, content), card = (value: Card) => replyCard(context, config.serverId, value)
    const work = Effect.gen(function* () {
        if ("error" in command) { yield* reply(command.error); return }
        if (command.type === "help") { yield* reply(withPrefix(roleHelp(name), prefix)); return }
        const { client, message } = context
        const source = { sourceId: message.id, createdAt: yield* sourceTimestamp(message) }
        const selfService = command.type === "verify" || command.type === "choose" || name === "verify" && command.type === "status"
        const authority = yield* readSafetyAuthority(client, config.serverId, message.author.id)
        const actor = moderationActor(authority)
        if (!selfService && !authority.isOwner && !authority.isAdmin) { yield* reply("Only the server owner or an administrator can manage role configuration and staff recovery"); return }
        const query = (operation: C.RolesQueryRequest["operation"], currentActor = actor) => store.query({ serverId: config.serverId, actor: currentActor, operation })
        const manage = (operation: C.RolesManageOperation, currentActor = actor) => store.manage({ serverId: config.serverId, actor: currentActor, messageId: source.sourceId, createdAt: source.createdAt, operation })
        const findPanel = (panelName: string) => Effect.gen(function* () {
            if (selfService) {
                const fresh = yield* roleMemberContext(client, config.serverId, actor.userId)
                const member = yield* store.memberQuery({ serverId: config.serverId, context: fresh.context })
                const panel = member.panels.find((p) => p.name === panelName)
                if (!panel) return yield* Effect.fail(new RoleHandlingError({ stage: "panel" }))
                return panel
            }
            const value = yield* query({ type: "panel-show", name: panelName })
            if (value.type !== "panel") return yield* Effect.fail(new RoleHandlingError({ stage: "panel" }))
            return value.panel
        })
        const changed = (panel: C.RolesPanel, patch: Extract<C.RolesManageOperation, { type: "panel-update" }>["patch"]) => Effect.gen(function* () {
            const ids = patch.mappings?.map((m) => m.roleId) ?? []
            const fresh = yield* readRoleAuthority(client, config.serverId, actor.userId, { configuration: true, roleIds: ids })
            return yield* manage({ type: "panel-update", name: panel.name, expectedRevision: panel.revision, patch, roles: roleSnapshots(fresh) }, moderationActor(fresh))
        })
        // Each operation of a chat command is its own source, so a redelivered message applies nothing twice
        const evaluateCommand = (userId: string, operation: C.RolesEvaluateOperation, index: number) => evaluateRoleRequest(store, config.serverId, client,
            { ...source, sourceId: `command_${message.id}_${index}` }, userId, operation, actor.userId, false)
        if (command.type === "jobs" || command.type === "resume") {
            const current = yield* store.reactionJobs({ serverId: config.serverId, operation: { type: "list" } })
            if (current.type !== "jobs") return yield* Effect.fail(new RoleHandlingError({ stage: "claim" }))
            if (command.type === "resume") {
                const job = current.jobs.find((j) => j.name === command.name)
                if (!job || !worker) { yield* reply(`Panel ${command.name} has no reaction check to resume. Start one with ${code(`${prefix}roles reactions ${command.name}`)}`); return }
                yield* worker.notify(job)
                yield* reply(`Checking the reactions on panel ${job.name} again`)
            } else yield* card(jobsCard(current.jobs, prefix))
            return
        }
        if (command.type === "reactions") {
            const panel = yield* findPanel(command.name)
            if (!panel.published) { yield* reply(`Panel ${panel.name} is not posted yet, so it has no reactions to check`); return }
            if (!worker) { yield* reply("Reaction checks are not running right now"); return }
            yield* worker.enqueue(panel.published.messageId)
            yield* reply(`Checking the reactions on panel ${panel.name}. Members get or lose its roles to match`)
            return
        }
        let result: C.RolesManageResult | undefined
        if (name === "verify" && command.type === "status") {
            const fresh = yield* roleMemberContext(client, config.serverId, actor.userId)
            const current = yield* store.memberQuery({ serverId: config.serverId, context: fresh.context }), yes = (value: boolean) => value ? "Yes" : "No"
            yield* card({ title: "Your verification", fields: [["Rules accepted", yes(current.acknowledgment.acknowledged)], ["Access role", current.acknowledgment.accessRolePresent ? "You have it" : "You don't have it"],
                ["Access confirmed", yes(current.acknowledgment.accessConfirmed)]] })
            return
        }
        if (command.type === "reservations") {
            const start = `${prefix}autorole reservations`, key = pageKey(config.serverId, message, name, "reservations"), next = command.next ? nextPosition<number>(key) : 1
            if (next === undefined) { yield* reply(noNextPage(start)); return }
            const found = yield* query({ type: "settings" })
            if (found.type !== "settings") return
            // Reservations removed since the last page can shorten the list, so next shows its last page at most
            const rows = found.settings.reservations ?? [], pages = Math.max(1, Math.ceil(rows.length / 10)), page = Math.min(next, pages)
            rememberPosition(key, page < pages ? page + 1 : undefined)
            yield* card({ title: "Role reservations", description: rows.length ? [`${rows.length} member${rows.length === 1 ? " gets" : "s get"} roles on joining`,
                ...rows.slice((page - 1) * 10, page * 10).map(row => `${format.userMention(row.userId)}: ${roles(row.roleIds)}`)].join("\n") : "No role reservations yet",
                fields: page < pages ? [["Next", code(`${start} next`)]] : [], footer: "Reserved roles are given when the user joins, while autorole is on and its humans-only setting allows them" })
            return
        }
        if (command.type === "status" || command.type === "list" && name === "autorole") {
            const found = yield* query({ type: "settings" })
            if (found.type !== "settings") return
            const s = found.settings
            yield* card(name === "autorole" ? { title: "Autorole", fields: [["Status", onOff(s.autoroleEnabled)], ["Roles", roles(s.autoroleIds) || `None yet. Add one with ${code(`${prefix}autorole add @role`)}`],
                ["Given to", s.humansOnly ? "Humans only" : "Humans and bots"], ...((s.reservations ?? []).length ? [["Reservations", `${s.reservations!.length}. See ${code(`${prefix}autorole reservations`)}`] as const] : [])] }
                // The rules panel is a role panel too, and !verify status shows a member's own verification
                : { title: "Role panels", fields: [["Reaction roles", onOff(s.panelsEnabled)], ["Rules verification", onOff(s.verificationEnabled)], ["Panels", code(`${prefix}roles list`)]] })
            return
        }
        if (command.type === "list") {
            const key = pageKey(config.serverId, message, name, "list"), page = command.next ? nextPosition<number>(key) : 1
            if (page === undefined) { yield* reply(noNextPage(`${prefix}${name} list`)); return }
            const found = yield* query({ type: "panel-list", page })
            if (found.type !== "panels") return
            rememberPosition(key, found.page < found.totalPages ? found.page + 1 : undefined)
            yield* card({ title: "Role panels", description: found.panels.map((p) => `**${p.name}** ${kind(p)}, ${onOff(p.enabled).toLowerCase()}${p.published ? "" : ", not posted yet"}`).join("\n") || "No role panels yet",
                fields: found.page < found.totalPages ? [["Next", code(`${prefix}${name} list next`)]] : [] })
            return
        }
        if (command.type === "show") { yield* card(panelCard(yield* findPanel(command.name), prefix)); return }
        if (command.type === "history") {
            const start = `${prefix}${name} history${command.name ? ` ${command.name}` : ""}`
            const key = pageKey(config.serverId, message, name, "history", command.name), cursor = command.next ? nextPosition<string>(key) : undefined
            if (command.next && cursor === undefined) { yield* reply(noNextPage(start)); return }
            const found = yield* query({ type: "configuration-list", ...(command.name ? { name: command.name } : {}), ...(cursor ? { cursor } : {}) })
            if (found.type !== "configurations") return
            rememberPosition(key, found.nextCursor)
            yield* card({ title: "Role history", description: found.references.map((r) => `${configuration(r.consumerKey)}: ${format.roleMention(r.roleId)}${r.postNo ? `, post #${r.postNo}` : ""}`).join("\n") || "No role history yet",
                fields: found.nextCursor ? [["Next", code(`${start} next`)]] : [] })
            return
        }
        if (command.type === "module") {
            const fresh = name === "autorole" && command.enabled ? yield* readRoleAuthority(client, config.serverId, actor.userId, { configuration: true }) : undefined
            result = yield* manage({ type: "settings", patch: { [name === "roles" ? "panelsEnabled" : name === "verify" ? "verificationEnabled" : "autoroleEnabled"]: command.enabled }, ...(fresh ? { roles: roleSnapshots(fresh) } : {}) }, fresh ? moderationActor(fresh) : actor)
        }
        if (command.type === "humans") result = yield* manage({ type: "settings", patch: { humansOnly: command.humansOnly } })
        if (command.type === "mode") result = yield* changed(yield* findPanel(command.name), { exclusive: command.exclusive })
        if (command.type === "withdrawal") {
            const found = yield* query({ type: "withdrawal-open", ...(command.name ? { name: command.name } : {}) }).pipe(Effect.catch(error => error instanceof RolesStoreError && error.status === 404 ? Effect.succeed(undefined) : Effect.fail(error)))
            if (!found) { yield* reply(`${command.name ? `Panel ${command.name}` : "Autorole"} has no role removal to continue`); return }
            if (found.type !== "withdrawal") return yield* Effect.fail(new RoleHandlingError({ stage: "identity" }))
            result = yield* manage({ type: "withdraw-next", withdrawalId: found.withdrawal.withdrawalId, expectedStep: found.withdrawal.step })
        }
        if (command.type === "retire") {
            if (name === "autorole") {
                const found = yield* query({ type: "settings" })
                if (found.type !== "settings") return yield* Effect.fail(new RoleHandlingError({ stage: "identity" }))
                result = yield* manage({ type: "autorole-withdraw", revision: found.settings.revision })
            } else {
                const panel = yield* findPanel(command.name ?? "rules")
                result = yield* manage({ type: "withdraw", name: panel.name, revision: panel.published?.revision ?? panel.revision })
            }
        }
        if (command.type === "create") result = yield* manage({ type: "panel-create", name: command.name, kind: "reaction", exclusive: command.mode === "exclusive" })
        if (command.type === "autorole") {
            const found = yield* query({ type: "settings" })
            if (found.type !== "settings") return yield* Effect.fail(new RoleHandlingError({ stage: "identity" }))
            const roleIds = command.operation === "add" ? [...new Set([...found.settings.autoroleIds, command.roleId])] : found.settings.autoroleIds.filter((id) => id !== command.roleId)
            const fresh = yield* readRoleAuthority(client, config.serverId, actor.userId, { configuration: true, roleIds })
            result = yield* manage({ type: "settings", patch: { autoroleIds: roleIds }, roles: roleSnapshots(fresh), expectedRevision: found.settings.revision }, moderationActor(fresh))
        }
        if (command.type === "reservation") {
            const found = yield* query({ type: "settings" })
            if (found.type !== "settings") return yield* Effect.fail(new RoleHandlingError({ stage: "identity" }))
            const reservations = (found.settings.reservations ?? []).filter(row => row.userId !== command.userId)
            if (command.roleIds.length) reservations.push({ userId: command.userId, roleIds: command.roleIds })
            const roleIds = [...new Set([...found.settings.autoroleIds, ...reservations.flatMap(row => row.roleIds)])]
            const fresh = yield* readRoleAuthority(client, config.serverId, actor.userId, { configuration: true, roleIds, readOnly: !roleIds.length })
            result = yield* manage({ type: "settings", patch: { reservations }, roles: roleSnapshots(fresh), expectedRevision: found.settings.revision }, moderationActor(fresh))
        }
        if (command.type === "enable" || command.type === "disable") result = yield* changed(yield* findPanel(command.name), { enabled: command.type === "enable" })
        if (command.type === "mapping" || command.type === "unmap" || command.type === "scope") {
            const panel = yield* findPanel(command.name)
            let mappings = panel.mappings.map((m) => ({ ...m }))
            if (command.type === "mapping") mappings = [...mappings.filter((m) => m.emoji !== command.emoji), { emoji: command.emoji, roleId: command.roleId, prerequisiteRoleIds: [], exclusionRoleIds: [] }]
            else if (command.type === "unmap") mappings = mappings.filter((m) => m.emoji !== command.emoji)
            else {
                const selected = mappings.find((m) => m.emoji === command.emoji)
                if (!selected) { yield* reply(`That emoji gives no role on panel ${panel.name}`); return }
                if (command.roleIds.some((id) => !authority.roles.some((r) => r.id === id))) { yield* reply("Every required and excluded role must exist in this server"); return }
                if (command.field === "prerequisites") selected.prerequisiteRoleIds = command.roleIds
                else selected.exclusionRoleIds = command.roleIds
            }
            result = yield* changed(panel, { mappings })
        }
        if (command.type === "configure") {
            const mappings = [{ emoji: command.emoji, roleId: command.roleId, prerequisiteRoleIds: [], exclusionRoleIds: [] }]
            const panel = yield* findPanel("rules").pipe(Effect.catch((error) => error instanceof RolesStoreError && error.status === 404 ? Effect.succeed(undefined) : Effect.fail(error)))
            if (panel) result = yield* changed(panel, { mappings })
            else {
                const fresh = yield* readRoleAuthority(client, config.serverId, actor.userId, { configuration: true, roleIds: [command.roleId] })
                result = yield* manage({ type: "panel-create", name: "rules", kind: "verification", mappings, roles: roleSnapshots(fresh) }, moderationActor(fresh))
            }
        }
        if (command.type === "publish") {
            if (!publishing) { yield* reply(notSetUp("Publishing")); return }
            const panel = yield* findPanel(command.name ?? "rules")
            const draft = yield* publishing.query({ serverId: config.serverId, actor, operation: { type: "draft-show", kind: "draft", name: command.draftName } })
            if (draft.type !== "draft") return yield* Effect.fail(new RoleHandlingError({ stage: "panel" }))
            const fresh = yield* readPublishingAuthority(client, config.serverId, actor.userId, command.channelId, !!draft.draft.content.embed)
            const reserved = yield* publishing.manage({ serverId: config.serverId, actor: moderationActor(fresh), messageId: message.id, createdAt: source.createdAt,
                operation: { type: "send", kind: "draft", name: draft.draft.name, expectedRevision: draft.draft.revision, channelId: command.channelId,
                    context: { originServerId: fresh.guild.id, botId: fresh.botId, channelId: command.channelId, actorAuthorized: true, botAuthorized: true } } })
            if (reserved.duplicate) return
            if (reserved.type !== "post" || !equalPublishingContent(reserved.grant.content, draft.draft.content)) return yield* Effect.fail(new RoleHandlingError({ stage: "snapshot" }))
            const delivered = yield* performPublishingGrant(publishing, config.serverId, actor.userId, client, reserved.grant)
            const postNo = reserved.post.postNo
            if (delivered.outcome !== "sent" || !delivered.acknowledged) { yield* reply(delivered.outcome === "failed" ? `The panel could not be posted. See post #${postNo} with ${code(`${prefix}publish status ${postNo}`)}`
                : `The panel post is not confirmed yet, run ${code(`${prefix}publish reconcile ${postNo}`)}`); return }
            const current = yield* readSafetyAuthority(client, config.serverId, actor.userId)
            result = yield* manage({ type: "panel-bind", name: panel.name, expectedRevision: panel.revision, postNo: reserved.post.postNo, expectedPostGeneration: reserved.post.generation }, moderationActor(current))
        }
        if (command.type === "verify" || command.type === "choose") {
            const panel = yield* findPanel(command.type === "verify" ? "rules" : command.name)
            // The backend binds the published revision, so a command needs no panel message re-read
            if (panel.published?.revision !== panel.revision) return yield* Effect.fail(new RoleHandlingError({ stage: "panel" }))
            const choices = command.type === "verify" ? [{ type: "verify" as const, name: panel.name, revision: panel.revision }]
                : command.emoji === null ? panel.mappings.map((m) => ({ type: "choose" as const, name: panel.name, revision: panel.revision, roleId: m.roleId, selected: false }))
                    : panel.mappings.filter((m) => m.emoji === command.emoji).map((m) => ({ type: "choose" as const, name: panel.name, revision: panel.revision, roleId: m.roleId, selected: true }))
            if (!choices.length) { yield* reply(`That emoji gives no role on panel ${panel.name}`); return }
            for (let index = 0; index < choices.length; index++) {
                const applied = yield* evaluateCommand(actor.userId, choices[index]!, index)
                if (applied.result.duplicate) continue
                const done = requestText(applied.result, applied.outcome)
                yield* reply(command.type === "verify" && done !== "Rules accepted" ? `${done}. ${applied.result.acknowledgment.acknowledged ? "Rules accepted" : "Rules not accepted yet"}` : done)
                if (applied.outcome && applied.outcome.outcome !== "succeeded") break
            }
            return
        }
        if (command.type === "delete") {
            const panel = yield* findPanel(command.name)
            result = yield* manage({ type: "withdraw", name: panel.name, revision: panel.published?.revision ?? panel.revision, deletePanel: true })
        }
        if (command.type === "member") {
            const userId = command.userId ?? actor.userId, target = `${command.name ? ` ${command.name}` : ""} <@${userId}>`, start = `${prefix}${name} ${command.operation}${target}`
            const key = pageKey(config.serverId, message, name, command.operation, command.name, userId), cursor = command.next ? nextPosition<string>(key) : undefined
            if (command.next && cursor === undefined) { yield* reply(noNextPage(start)); return }
            const fresh = yield* roleMemberContext(client, config.serverId, userId, actor.userId)
            const claims = yield* query({ type: "claim-list", userId, joinedAt: fresh.context.joinedAt, ...(cursor ? { cursor } : {}) }, moderationActor(fresh.authority))
            if (claims.type !== "claims") return yield* Effect.fail(new RoleHandlingError({ stage: "identity" }))
            rememberPosition(key, claims.nextCursor)
            const lines: string[] = []
            if (command.operation === "withdraw") {
                const operations: Extract<C.RolesEvaluateOperation, { type: "withdraw-member" }>[] = []
                for (const claim of claims.claims) for (const consumerKey of claim.consumerKeys) {
                    if (command.name && !consumerKey.startsWith(`panel:${command.name}:`) || name === "verify" && !consumerKey.startsWith("panel:rules:")
                        || name === "autorole" && !consumerKey.startsWith("autorole:")) continue
                    operations.push({ type: "withdraw-member", consumerKey, roleId: claim.roleId })
                }
                const batch = operations.slice(0, 20)
                for (let index = 0; index < batch.length; index++) {
                    const applied = yield* evaluateCommand(userId, batch[index]!, index), outcome = applied.outcome
                    if (outcome && (outcome.outcome !== "succeeded" || !outcome.acknowledged)) {
                        yield* reply(`Removing ${format.roleMention(batch[index]!.roleId)} from ${format.userMention(userId)} ${outcome.outcome === "failed" ? "failed" : outcome.outcome === "succeeded" ? "worked, but NeonFlux could not record it yet" : "is not confirmed yet"}. Check it with ${code(`${prefix}${name} reconcile${target}`)}`)
                        return
                    }
                }
                if (operations.length > 20) lines.push("Removed 20 roles. More remain")
            }
            for (const claim of claims.claims) {
                const relevant = claim.consumerKeys.some((consumerKey) => name === "autorole" ? consumerKey.startsWith("autorole:")
                    : consumerKey.startsWith(`panel:${command.name ?? "rules"}:`))
                if (!relevant) continue
                if (command.operation === "reconcile" && claim.attempt) {
                    const recorded = yield* store.reconcile({ serverId: config.serverId, actor, messageId: message.id, createdAt: source.createdAt,
                        attemptId: claim.attempt.attemptId, generation: claim.generation, observation: { originServerId: config.serverId, observedAt: yield* Clock.currentTimeMillis,
                            userId, joinedAt: fresh.context.joinedAt, roleId: claim.roleId, present: fresh.context.roleIds.includes(claim.roleId) } })
                    lines.push(`${format.roleMention(recorded.claim.roleId)}: ${claimStates[recorded.claim.status]}, ${recorded.claim.owned ? "given by NeonFlux" : "not confirmed as given by NeonFlux"}`)
                }
            }
            yield* card({ title: command.operation === "reconcile" ? "Role check" : "Role removal", ...(lines.length ? { description: lines.join("\n") } : {}),
                fields: [["Member", format.userMention(userId)], ["Checked", `${claims.claims.length} role${claims.claims.length === 1 ? "" : "s"} NeonFlux manages`],
                    // A withdrawal's only line says more roles remain
                    ...(command.operation === "withdraw" && lines.length ? [["Continue", code(start)] as const] : []), ...(claims.nextCursor ? [["Next", code(`${start} next`)] as const] : [])],
                footer: "NeonFlux removes a role only when it confirmed that it gave it" })
            return
        }
        if (!result || result.duplicate) return
        // A new panel shows its whole card, and a change to one names what changed
        if (result.type === "panel") yield* command.type === "create" ? card(panelCard(result.panel, prefix)) : reply(panelChange(command, result.panel))
        if (result.type === "settings") {
            const s = result.settings
            yield* reply(command.type === "module" ? `${name === "roles" ? "Role panels" : name === "verify" ? "Rules verification" : "Autorole"} ${command.enabled ? "on" : "off"}`
                : command.type === "humans" ? `Autorole now gives roles to ${s.humansOnly ? "humans only" : "humans and bots"}`
                : command.type === "autorole" ? `${format.roleMention(command.roleId)} ${command.operation === "add" ? "added to" : "removed from"} autorole`
                : command.type === "reservation" ? command.roleIds.length ? `${format.userMention(command.userId)} gets ${roles(command.roleIds)} on joining` : `Reservation for ${format.userMention(command.userId)} removed`
                : "Role settings saved")
        }
        if (result.type === "withdrawal") {
            const { withdrawal: current, conflicts } = yield* processRoleWithdrawal(store, config.serverId, client, actor.userId, source, result.withdrawal,
                operation => manage(operation), (cursor) => query({ type: "withdrawal-show", withdrawalId: result.withdrawal.withdrawalId, ...(cursor === undefined ? {} : { cursor }) }))
            yield* reply(current.status === "complete" ? `${current.deletePanel ? "Deleted" : "Retired"}. The roles it gave are removed`
                : `${current.status === "blocked" ? "Stopped" : "Still removing roles"}, at least ${current.remainingAtLeast} left${conflicts ? `, ${conflicts} not confirmed` : ""}\nContinue: ${code(`${prefix}${name} next${name === "roles" ? ` ${current.consumerKey.split(":")[1]}` : ""}`)}`)
        }
    }).pipe(Effect.catch((error) => reply(error instanceof RolesStoreError ? rolesErrorMessage(error)
        : error instanceof RolePermissionError && rolePermissionFix(error) || "NeonFlux couldn't confirm the member's roles or the panel. Check them before you try again")))
    return !("error" in command) && ["verify", "choose", "member"].includes(command.type)
        ? withRoleMember(context.client, command.type === "member" ? command.userId ?? context.message.author.id : context.message.author.id, work, config.serverId) : work
}

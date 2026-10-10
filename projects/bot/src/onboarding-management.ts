import type * as C from "@neonflux/backend/contracts"
import { format, type BotEventContext } from "@neontechspace/fluxerly/effect"
import { Effect } from "effect"
import type { BotConfig } from "./config.ts"
import { replyPrefix, withPrefix } from "./general-settings.ts"
import { moderationActor } from "./moderation.ts"
import { sourceTimestamp } from "./responses.ts"
import { code, notSetUp, onOff, replyCard, replyText, type Card } from "./reply-style.ts"
import { readRoleAuthority, rolePermissionFix, RolePermissionError } from "./role-permissions.ts"
import { roleSnapshots } from "./roles.ts"
import { rolesErrorMessage } from "./roles-store.ts"
import { readSafetyAuthority, SafetyPermissionError } from "./safety-permissions.ts"
import { onboardingHelp, type OnboardingCommand } from "./onboarding-command.ts"
import { OnboardingStoreError, type OnboardingStore } from "./onboarding-store.ts"
import type { CompletionRole, OnboardingRuntime } from "./onboarding.ts"

const stepLabel = (step: C.OnboardingStep) => step.type === "rules" ? "Accept the server rules" : step.type === "panel" ? `Roles from the ${step.name} reaction panel`
    : step.type === "menu" ? `Roles from the ${step.name} role picker menu` : `${format.channelMention(step.channelId)} ${step.text}`
/** The checklist as staff configure it */
const onboardingCard = (view: C.OnboardingView, prefix: string): Card => {
    const { settings } = view
    return { title: "Newcomer checklist", fields: [["Status", onOff(settings.enabled)], ["Sent with", settings.delivery === "dm" ? "The DM greeting" : "The welcome greeting"],
        ["Steps", settings.steps.map((step, index) => `${index + 1}. ${stepLabel(step)}`).join("\n") || `None yet. Add one with ${code(`${prefix}onboarding add rules`)}`],
        ["Completion role", settings.completionRoleId ? format.roleMention(settings.completionRoleId) : "Not set"]] }
}
const marks: Record<C.OnboardingStepState, string> = { done: "Done", open: "To do", info: "Visit" }
/** A member's own checklist with what is left */
function progressReply(progress: C.OnboardingProgress, prefix: string, role?: CompletionRole): Card | string {
    if (!progress.enabled || !progress.steps.length) return "This server has no newcomer checklist"
    const notes: string[] = []
    if (progress.complete) notes.push("You finished the checklist. Welcome aboard")
    if (role === "added" && progress.grant) notes.push(`You now have ${format.roleMention(progress.grant.roleId)}`)
    if (role === "uncertain") notes.push("Fluxer did not confirm the completion role, and NeonFlux does not try again on its own. Ask a moderator to check your roles")
    if (role === "failed") notes.push(`The completion role could not be added. Run ${code(`${prefix}onboarding`)} again later`)
    if (role && typeof role === "object") notes.push(`The completion role could not be added. ${rolesErrorMessage(role.problem)}`)
    return { title: "Your newcomer checklist", description: progress.steps.map(step => `${marks[step.state]}: ${step.text}`).join("\n"), ...(notes.length ? { note: notes.join("\n") } : {}) }
}
function describe(error: unknown) {
    if (error instanceof OnboardingStoreError) {
        if (error.code === "ROLE_NOT_ELIGIBLE") return "Choose a completion role below the NeonFlux role and your own highest role, with only ordinary member permissions and not a staff role"
        if (error.status === 403) return "Only the server owner or an Administrator can change the newcomer checklist, and at DEFCON 1 only turning it off works"
        if (error.status === 404) return "That panel, menu or step was not found. Check !roles list, !rolepicker menu list or !onboarding status"
        if (error.status === 409) return "That step is already on the checklist, or the checklist changed on the website. Check !onboarding status"
        if (error.status === 400) return "A checklist has at most 5 steps. Check the values with !onboarding help"
        return "The newcomer checklist is unavailable right now. Try again shortly"
    }
    if (error instanceof RolePermissionError) return rolePermissionFix(error) ?? "Current role permissions could not be read. Try again shortly"
    if (error instanceof SafetyPermissionError) return "Current permissions could not be read. Try again shortly"
    return "The onboarding command could not be completed"
}

export function handleOnboardingCommand(store: OnboardingStore | undefined, runtime: OnboardingRuntime | undefined, config: BotConfig, command: OnboardingCommand | { error: string }, context: BotEventContext<"messageCreate">) {
    const prefix = replyPrefix(config.serverId, context.message.guildId)
    const reply = (content: string) => replyText(context, withPrefix(content, prefix)), card = (value: Card) => replyCard(context, config.serverId, value)
    return Effect.gen(function* () {
        const { message, client } = context, serverId = config.serverId
        if (message.guildId !== serverId) return
        if (!store || !runtime) { yield* reply(notSetUp("Newcomer checklist")); return }
        if ("error" in command) { yield* reply(command.error); return }
        if (command.type === "help") { yield* reply(onboardingHelp); return }
        if (command.type === "progress") {
            const checked = yield* runtime.check(client, message.author.id), progress = progressReply(checked.progress, prefix, checked.role)
            yield* typeof progress === "string" ? reply(progress) : card(progress)
            return
        }
        const authority = yield* readSafetyAuthority(client, serverId, message.author.id, command.type === "add" && command.step.type === "link" ? { channelId: command.step.channelId } : {})
        if (!authority.isOwner && !authority.isAdmin) { yield* reply("Only the server owner or an Administrator can change the newcomer checklist"); return }
        if (command.type === "status") { const view = yield* runtime.current; if (view) yield* card(onboardingCard(view, prefix)); return }
        let roles: C.RolesRoleSnapshot[] | undefined
        if (command.type === "role" && command.roleId) roles = roleSnapshots(yield* readRoleAuthority(client, serverId, message.author.id, { configuration: true, roleIds: [command.roleId] }))
        const operation: C.OnboardingOperation = command.type === "add" ? { type: "step-add", step: command.step } : command.type === "remove" ? { type: "step-remove", position: command.position } : command
        const view = yield* store.manage({ serverId, originServerId: authority.guild.id, messageId: message.id, createdAt: yield* sourceTimestamp(message), actor: moderationActor(authority),
            ...(roles ? { roles } : {}), operation })
        yield* runtime.updated(view)
        const { settings } = view, steps = `The checklist has ${settings.steps.length} step${settings.steps.length === 1 ? "" : "s"} now`
        // The line can quote a link step's text, so it is sent as it is
        yield* replyText(context, command.type === "module" ? `The newcomer checklist is ${onOff(settings.enabled).toLowerCase()}`
            : command.type === "delivery" ? `The newcomer checklist now goes with the ${settings.delivery === "dm" ? "DM" : "welcome"} greeting`
            : command.type === "add" ? `Step added: ${stepLabel(command.step)}. ${steps}` : command.type === "remove" ? `Step ${command.position} removed. ${steps}`
            : settings.completionRoleId ? `Members who finish the checklist now get ${format.roleMention(settings.completionRoleId)}` : "Members who finish the checklist get no role now")
    }).pipe(Effect.catch(error => reply(describe(error))), Effect.asVoid)
}

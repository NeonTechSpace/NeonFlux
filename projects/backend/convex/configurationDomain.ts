import { DashboardConfigurationOperationMap, type DashboardConfigurationFamily } from "@neonflux/contracts/dashboard"
import { rule } from "./moderationDomain.ts"
import { publishingContent } from "./publishingDomain.ts"
import { responseConfigurationOperation } from "./configurationResponses.ts"
import { levelMappings } from "./levelingDomain.ts"
import { milestoneCivil } from "./milestonesDomain.ts"
import { voicePatch } from "./voiceDomain.ts"
import { decode, fail } from "./validation.ts"
import { rolePickerOperation } from "./rolePickerDomain.ts"
import { StickyOperation } from "@neonflux/contracts/sticky"
import { HelpDeskOperation } from "@neonflux/contracts/helpdesk"
import { MemberListOperation } from "@neonflux/contracts/member-list"
import { OnboardingOperation } from "@neonflux/contracts/onboarding"
import { ProfileOperation } from "@neonflux/contracts/profiles"
import { RolePickerOperation } from "@neonflux/contracts/role-picker"
import { ShowcaseOperation } from "@neonflux/contracts/showcases"
import { dashboardSidebarOperation } from "./sidebarDomain.ts"
import { temporaryRoleConfigurationOperation } from "./temporaryRolesStore.ts"
import { alertsOperation } from "./alertsDomain.ts"
import { helpDeskOperation } from "./helpDeskDomain.ts"
import { onboardingOperation } from "./onboardingDomain.ts"
import { showcaseOperation } from "./showcasesDomain.ts"
import { profileOperation } from "./profilesDomain.ts"
import { youtubeOperation } from "./youtubeDomain.ts"
import { twitchOperation } from "./twitchDomain.ts"

export const CONFIGURATION_OPERATION_LENGTH = 524288
export function configurationOperation<F extends DashboardConfigurationFamily>(
    family: F,
    value: unknown,
): DashboardConfigurationOperationMap[F] {
    // A job stores its operation, so it stays well inside Convex's 1 MiB document. The largest lists the families allow, such as 1,000
    // automod patterns of 200 characters or 10,000 member IDs in access lists, fit with room for escaped characters
    if (JSON.stringify(value)?.length > CONFIGURATION_OPERATION_LENGTH) fail(400, "Configuration is too large")
    return operation(family, value) as DashboardConfigurationOperationMap[F]
}
// Each job stores its operation as the family applies it: decoded by the family's own helper where it has one, otherwise by its
// dashboard schema, with automod rules, draft content, level rewards and generator patches in their normalized form
function operation(family: DashboardConfigurationFamily, value: unknown) {
    switch (family) {
        case "responses":
            return responseConfigurationOperation(value)
        case "rolepicker":
            return rolePickerOperation(decode(RolePickerOperation, value), true)
        case "sticky":
            return decode(StickyOperation, value)
        case "sidebar":
            return dashboardSidebarOperation(value)
        case "memberlist":
            return decode(MemberListOperation, value)
        case "temproles":
            return temporaryRoleConfigurationOperation(value)
        case "alerts":
            return alertsOperation(value)
        case "helpdesk":
            return helpDeskOperation(decode(HelpDeskOperation, value))
        case "showcase":
            return showcaseOperation(decode(ShowcaseOperation, value), true)
        case "profile":
            return profileOperation(decode(ProfileOperation, value), true)
        case "youtube":
            return youtubeOperation(value)
        case "twitch":
            return twitchOperation(value)
        case "onboarding": {
            const op = onboardingOperation(decode(OnboardingOperation, value))
            if (op.type === "step-add" || op.type === "step-remove") fail(400, "Unsupported configuration operation")
            return op
        }
        case "moderation": {
            const op = decode(DashboardConfigurationOperationMap.moderation, value)
            return op.type === "rule-create" ? { ...op, rule: rule(op.rule) } : op
        }
        case "publishing": {
            const op = decode(DashboardConfigurationOperationMap.publishing, value)
            return op.type === "draft-set" || (op.type === "draft-create" && op.content)
                ? { ...op, content: publishingContent(op.content, true) }
                : op
        }
        case "leveling": {
            const op = decode(DashboardConfigurationOperationMap.leveling, value)
            return op.type === "mappings" ? { ...op, mappings: levelMappings(op.mappings) } : op
        }
        // A zone and time must also resolve on an ordinary day in the zone database
        case "milestones": {
            const op = decode(DashboardConfigurationOperationMap.milestones, value)
            if (op.type === "configure") milestoneCivil({ zone: op.zone, time: op.time, fold: op.fold })
            return op
        }
        case "voice": {
            const op = decode(DashboardConfigurationOperationMap.voice, value)
            return op.type === "generator-set" ? { ...op, patch: voicePatch(op.patch) } : op
        }
        default:
            return decode(DashboardConfigurationOperationMap[family], value)
    }
}
type Critical = { type: string; enabled?: unknown; patch?: Record<string, unknown>; mappings?: unknown[] }
// Takes a stored operation, which configurationOperation decoded when it was queued
export function configurationCritical(family: DashboardConfigurationFamily, value: unknown) {
    const op = (family === "responses" ? (value as { operation: unknown }).operation : value) as Critical,
        patch = Object.entries(op.patch ?? {})
    if (family === "leveling" && op.type === "mappings" && op.mappings?.length === 0) return true
    if (
        op.type === "settings" &&
        op.patch !== undefined &&
        patch.length &&
        patch.every(
            ([key, value]) =>
                ((key === "enabled" || key.endsWith("Enabled")) && value === false) ||
                (family === "moderation" && key === "defcon"),
        )
    )
        return true
    return (
        [
            "disable",
            "clear",
            "cancel",
            "delete",
            "rule-delete",
            "watchlist-remove",
            "draft-delete",
            "category-delete",
            "canned-remove",
            "policy-delete",
            "forget",
            "menu-remove",
        ].includes(op.type) || op.enabled === false
    )
}

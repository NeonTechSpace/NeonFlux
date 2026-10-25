import type { AuditLogChange } from "@neontechspace/fluxerly/effect"

// How security alerts and metadata logs read the before and after values of an audit entry's changes. Audit entries may
// name permissions as API constants such as MANAGE_GUILD, or as bitfields

/** A permission bitfield value, or undefined when the value is not one */
export const auditBits = (value: unknown) =>
    typeof value === "string" && /^\d{1,20}$/.test(value)
        ? BigInt(value)
        : typeof value === "number" && Number.isSafeInteger(value) && value >= 0
          ? BigInt(value)
          : undefined

/** The permission names a `{ added, removed }` value lists on one side, or undefined when the value has another shape */
export const auditNames = (value: unknown, side: "added" | "removed") => {
    const list =
        value !== null && typeof value === "object" && !Array.isArray(value)
            ? (value as Record<string, unknown>)[side]
            : undefined
    return Array.isArray(list) ? list.filter((item): item is string => typeof item === "string") : undefined
}

/** Compares permission names written as SDK names or as API constants */
export const sameAuditName = (a: string, b: string) =>
    a.replace(/_/g, "").toLowerCase() === b.replace(/_/g, "").toLowerCase()

const ids = (value: unknown) =>
    Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []

/** The role IDs a member's `roles` change added and removed: The full lists before and after, compared */
export function auditRoleChange(changes: readonly AuditLogChange[] | undefined) {
    const roles = changes?.find((item) => item.key === "roles")
    const before = ids(roles?.oldValue),
        after = ids(roles?.newValue)
    return {
        found: roles !== undefined,
        added: after.filter((id) => !before.includes(id)),
        removed: before.filter((id) => !after.includes(id)),
    }
}

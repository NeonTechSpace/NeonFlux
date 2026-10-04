import { fail, isId } from "./validation.ts"

export function afkReason(value: unknown): string | null {
    const reason = typeof value === "string" ? value.trim() : ""
    return reason && reason.length <= 200 ? reason : null
}

export function afkMentions(value: unknown): string[] | null {
    return Array.isArray(value) && value.length <= 5 && value.every(isId) ? value : null
}

export function requireAfkMember(userId: string) {
    if (!isId(userId)) fail(400, "Invalid member ID")
}

export function requireAfkReason(value: string): string {
    const reason = afkReason(value)
    if (reason === null) fail(400, "Away messages must contain 1 to 200 characters")
    return reason
}

export function requireAfkMentions(value: string[]): string[] {
    const mentions = afkMentions(value)
    if (mentions === null) fail(400, "Invalid mentions")
    return mentions
}

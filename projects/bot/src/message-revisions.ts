import type { Message } from "@neontechspace/fluxerly/effect"

// Link previews arrive as message updates that repeat everything else. Features read an update only for an edit, a pin
// change or a flag change, so an update whose edit time, pin status and flags all match the last observation is skipped.
// Absent values mean unknown and never match, and a message outside the bounded memory is always processed
const revision = (message: Pick<Message, "editedAt" | "pinned" | "flags">) => message.editedAt === undefined || message.pinned === undefined || message.flags === undefined
    ? undefined : `${message.editedAt ?? ""}|${message.pinned}|${message.flags}`

export const messageRevisionLimit = 10000

/** Recent messages' edit time, pin status and flags, shared by every server of the process */
export function createMessageRevisions(limit = messageRevisionLimit) {
    const seen = new Map<string, string>()
    const remember = (id: string, value: string | undefined) => {
        seen.delete(id)
        if (value === undefined) return
        seen.set(id, value)
        if (seen.size > limit) seen.delete(seen.keys().next().value!)
    }
    return {
        created: (message: Message) => remember(message.id, revision(message)),
        /** Records the update and reports whether a feature could need it */
        changed: (message: Message) => {
            const before = seen.get(message.id), after = revision(message)
            remember(message.id, after)
            return after === undefined || before !== after
        },
    }
}

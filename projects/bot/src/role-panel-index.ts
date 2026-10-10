import type { RolesPanel } from "@neonflux/contracts/roles"
import { Clock, Effect } from "effect"

/** How long a learned panel list answers reactions before a reaction reads the backend again */
export const panelIndexTtlMs = 600000

// The published role and verification panel messages of one server, learned from the complete panel list that role
// handling already reads from the backend. A reaction on any other message then needs no member, permission or backend
// read. Only the bot binds panel messages, through role management and dashboard publication, and both forget the list
// for their whole duration, so a reaction during or after one reads the backend again. Before the first list, after it
// expires and while a change runs, every reaction takes the full path
export function createPanelIndex(ttlMs = panelIndexTtlMs) {
    let messages: ReadonlySet<string> | undefined, learnedAt = 0, generation = 0, changing = 0
    const forget = () => { messages = undefined; generation++ }
    return {
        /** False only when a current list shows that the message is no published panel */
        mayBePanel: (messageId: string) => Clock.currentTimeMillis.pipe(Effect.map(now => !messages || now - learnedAt >= ttlMs || messages.has(messageId))),
        /** Learns the panel list of a backend read, unless a change began after the read started */
        learn: <A extends { readonly panels: readonly RolesPanel[] }, E, R>(read: Effect.Effect<A, E, R>) => Effect.suspend(() => {
            const started = generation
            return read.pipe(Effect.tap(result => Clock.currentTimeMillis.pipe(Effect.map(now => {
                if (started !== generation || changing > 0) return
                messages = new Set(result.panels.flatMap(panel => panel.published ? [panel.published.messageId] : []))
                learnedAt = now
            }))))
        }),
        /** Runs work that can publish or withdraw a panel */
        change: <A, E, R>(work: Effect.Effect<A, E, R>) => Effect.acquireUseRelease(Effect.sync(() => { changing++; forget() }), () => work,
            () => Effect.sync(() => { changing--; forget() })),
    }
}

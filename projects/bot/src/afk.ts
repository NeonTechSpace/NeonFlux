import { MessageType, type BotEventContext } from "@neontechspace/fluxerly/effect"
import { Effect } from "effect"
import type { AfkStore } from "./afk-store.ts"

export function handleAfk(store: AfkStore, serverId: string, context: BotEventContext<"messageCreate">, publicRepliesAllowed = true, prefix = "!") {
    return Effect.gen(function* () {
        const { message, reply } = context
        if (message.guildId !== serverId || message.webhookId
            || (message.type !== MessageType.Default && message.type !== MessageType.Reply)) return

        const content = message.content.trimStart()
        const command = content.startsWith(prefix) ? /^afk(?:\s+([\s\S]*))?$/i.exec(content.slice(prefix.length)) : null
        const respond = (content: string) => reply({
            content,
            allowedMentions: { users: [], roles: [], everyone: false, repliedUser: false },
        })
        if (command) {
            if (!publicRepliesAllowed) return
            const reason = command[1]?.trim() || "Away"
            if (reason.length > 200) {
                yield* respond("Keep your away message within 200 characters")
                return
            }
            const saved = yield* store.set(message.author.id, reason).pipe(
                Effect.match({ onFailure: () => false, onSuccess: () => true }),
            )
            yield* respond(saved
                ? "You are now AFK. Send a message to clear your status"
                : "I couldn't confirm your AFK status. Please try again")
            return
        }

        const mentionedUserIds = [...new Set((message.mentions ?? []).map((user) => user.id))]
            .filter((id) => id !== message.author.id)
            .slice(0, 5)
        const result = yield* store.observe(message.author.id, mentionedUserIds)
        const lines: string[] = []
        if (result.cleared) lines.push("Welcome back! Your AFK status has been cleared")
        for (const status of result.statuses) lines.push(`<@${status.userId}> is AFK: ${status.reason}`)
        if (lines.length && publicRepliesAllowed) yield* respond(lines.join("\n"))
    })
}

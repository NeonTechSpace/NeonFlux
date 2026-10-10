import type * as C from "@neonflux/backend/contracts"
import type { BotEventContext } from "@neontechspace/fluxerly/effect"
import { Effect } from "effect"
import { parseStatsCommand, statsHelp } from "./analytics-command.ts"
import type { AnalyticsStore } from "./analytics-store.ts"
import type { AnalyticsRecorder } from "./analytics-worker.ts"
import { readServerManagerAuthority, replyPrefix, withPrefix } from "./general-settings.ts"
import { noMentions } from "./responses.ts"

const number = (value: number) => value.toLocaleString("en-US")
const hour = (value: number) => `${String(value).padStart(2, "0")}:00`
export function statsSummary(summary: C.AnalyticsSummary, prefix: string) {
    const channels = summary.topChannels.map(row => `<#${row.channelId}> ${number(row.count)}`).join(", ")
    const hours = summary.busiestHours.map(row => `${hour(row.hour)} ${number(row.count)}`).join(", ")
    return [`Last 7 days, UTC, since ${new Date(summary.since).toISOString().slice(0, 10)}`,
        `Joins ${number(summary.joins)}, leaves ${number(summary.leaves)}, messages ${number(summary.messages)}`,
        ...(summary.onboarded ? [`Newcomer checklists finished ${number(summary.onboarded)}`] : []),
        `Top channels: ${channels || "None yet"}`,
        `Busiest hours, UTC: ${hours || "None yet"}`,
        summary.enabled ? "Analytics is on. The dashboard receives new counts about every five minutes"
            : withPrefix("Analytics is off. Existing counts stay until they age out. Use !stats on to resume", prefix)].join("\n")
}

export function handleStatsCommand(store: AnalyticsStore | undefined, recorder: AnalyticsRecorder | undefined, serverId: string, args: readonly string[], context: BotEventContext<"messageCreate">) {
    const respond = (content: string) => context.reply({ content, allowedMentions: noMentions })
    const prefix = replyPrefix(serverId, context.message.guildId)
    return Effect.gen(function* () {
        if (context.message.guildId !== serverId) return
        if (!store) { yield* respond("Analytics persistence is not configured"); return }
        const command = parseStatsCommand(args)
        if ("error" in command) { yield* respond(withPrefix(command.error, prefix)); return }
        if (command.type === "help") { yield* respond(withPrefix(statsHelp, prefix)); return }
        if (!(yield* readServerManagerAuthority(context.client, serverId, context.message.author.id))) {
            yield* respond("Only the server owner or members with Manage Server can use stats")
            return
        }
        if (command.type === "toggle") {
            const saved = yield* store.manage({ serverId, originServerId: serverId, actorId: context.message.author.id, managerAuthorized: true, enabled: command.enabled })
            if (recorder) yield* recorder.setEnabled(saved.enabled)
            yield* respond(saved.enabled ? "Analytics is on. The bot counts joins, leaves and messages for this server"
                : "Analytics is off. The bot stopped counting for this server. Existing counts stay until they age out")
            return
        }
        // Counts still in memory go first, so the summary is current
        if (recorder) yield* recorder.flush()
        const summary = yield* store.summary({ serverId })
        if (recorder) yield* recorder.setEnabled(summary.enabled)
        yield* respond(statsSummary(summary, prefix))
    }).pipe(Effect.catchTag("AnalyticsStoreError", () => respond("Analytics could not be read or saved. Try again shortly")), Effect.asVoid)
}

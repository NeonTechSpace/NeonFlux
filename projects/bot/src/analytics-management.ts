import type { AnalyticsSummary } from "@neonflux/contracts/analytics"
import { format, TimestampStyles, type BotEventContext } from "@neontechspace/fluxerly/effect"
import { Effect } from "effect"
import { parseStatsCommand, statsHelp } from "./analytics-command.ts"
import type { AnalyticsStore } from "./analytics-store.ts"
import type { AnalyticsRecorder } from "./analytics-worker.ts"
import { readServerManagerAuthority, replyPrefix, withPrefix } from "./general-settings.ts"
import { noMentions } from "./responses.ts"
import { at, code, notSetUp, replyCard, type Card } from "./reply-style.ts"

const number = (value: number) => value.toLocaleString("en-US")
/** The seven-day summary. Counts are kept in UTC days and hours, and the period starts at a UTC midnight, so each busiest hour
 *  shows as that hour of the first day in each reader's time */
export function statsSummary(summary: AnalyticsSummary, prefix: string): Card {
    const hour = (value: number) => format.timestamp(new Date(summary.since + value * 3600000), TimestampStyles.ShortTime)
    return { title: "Server activity, last 7 days", description: `Since ${at(summary.since)}`, fields: [
        ["Status", summary.enabled ? "On. The dashboard receives new counts about every five minutes" : `Off. Existing counts stay until they age out. Use ${code(`${prefix}stats on`)} to resume`],
        ["Joins", number(summary.joins)], ["Leaves", number(summary.leaves)], ["Messages", number(summary.messages)],
        ...(summary.onboarded ? [["Newcomer checklists finished", number(summary.onboarded)] as const] : []),
        ["Top channels", summary.topChannels.map(row => `${format.channelMention(row.channelId)} ${number(row.count)}`).join("\n") || "None yet"],
        ["Busiest hours", summary.busiestHours.map(row => `${hour(row.hour)} ${number(row.count)}`).join("\n") || "None yet"]] }
}

export function handleStatsCommand(store: AnalyticsStore | undefined, recorder: AnalyticsRecorder | undefined, serverId: string, args: readonly string[], context: BotEventContext<"messageCreate">) {
    const respond = (content: string) => context.reply({ content, allowedMentions: noMentions })
    const prefix = replyPrefix(serverId, context.message.guildId)
    return Effect.gen(function* () {
        if (context.message.guildId !== serverId) return
        if (!store) { yield* respond(notSetUp("Analytics")); return }
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
            yield* respond(saved.enabled ? "Analytics is on. NeonFlux counts joins, leaves and messages for this server"
                : "Analytics is off. NeonFlux stopped counting for this server. Existing counts stay until they age out")
            return
        }
        // Counts still in memory go first, so the summary is current
        if (recorder) yield* recorder.flush()
        const summary = yield* store.summary({ serverId })
        if (recorder) yield* recorder.setEnabled(summary.enabled)
        yield* replyCard(context, serverId, statsSummary(summary, prefix))
    }).pipe(Effect.catchTag("AnalyticsStoreError", () => respond("Analytics could not be read or saved. Try again shortly")), Effect.asVoid)
}

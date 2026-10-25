import type { BackupConfigFamily } from "@neonflux/contracts/backup"
import type { DashboardConfigurationFamily } from "@neonflux/contracts/dashboard"
import type { Client } from "@neontechspace/fluxerly/effect"
import { Effect } from "effect"
import { alertRuntimes } from "./alerts-worker.ts"
import { analyticsRuntimes } from "./analytics-worker.ts"
import { refreshPrefix } from "./general-settings.ts"
import { helpDeskRuntimes } from "./helpdesk-worker.ts"
import { levelingRechecks } from "./leveling.ts"
import { metadataRechecks } from "./metadata-log-events.ts"
import { onboardingRuntimes } from "./onboarding.ts"
import { stickyRuntimes } from "./sticky-worker.ts"
import { forgetSuggestionCards } from "./suggestion-reactions.ts"
import { voiceRuntimes } from "./voice-worker.ts"

/**
 * Brings what a server's running features keep in memory up to date after the backend changed the settings of one family
 * outside their own chat handlers, as an applied dashboard change or a restored backup item does. Families whose settings the
 * bot reads fresh each time need nothing
 */
export function reloadServerRuntime(
    client: Client,
    serverId: string,
    family: DashboardConfigurationFamily | BackupConfigFamily,
) {
    switch (family) {
        // Sticky messages run from memory, so a reload posts or removes copies at once
        case "sticky":
            return stickyRuntimes.get(serverId)?.reload() ?? Effect.void
        // Security alerts and their actions check in-memory settings
        case "alerts":
            return alertRuntimes.get(serverId)?.reload() ?? Effect.void
        case "helpdesk":
        case "helpdeskAnswer":
            return helpDeskRuntimes.get(serverId)?.reload() ?? Effect.void
        // The dashboard's voice jobs reload generators through their own native step
        case "voiceGenerator":
            return voiceRuntimes.get(serverId)?.reload() ?? Effect.void
        // Vote reactions count only on the cards the bot learned, which it learns again after a suggestions change, so turning
        // suggestions on makes the next reaction count
        case "suggestions":
            return Effect.sync(() => forgetSuggestionCards(client, serverId))
        // Leveling stops sending candidates while it is off and remembers each member's cooldown, so a change rechecks both
        case "leveling":
        case "presets":
            return levelingRechecks.get(serverId)?.() ?? Effect.void
        // The newcomer checklist is kept in memory too, so it is read again
        case "onboarding":
            return (onboardingRuntimes.get(serverId)?.reload() ?? Effect.void).pipe(Effect.catch(() => Effect.void))
        // Logging pauses after a disabled answer and message text is kept only while message events are logged
        case "metadata":
            return metadataRechecks.get(serverId)?.() ?? Effect.void
        // Counting stops while analytics is off, so the recorder reads the switch again and counts at once when it turned on
        case "analytics":
            return analyticsRuntimes.get(serverId)?.reload() ?? Effect.void
        // The prefix and reply style are read again by the next command
        case "general":
            return Effect.sync(() => refreshPrefix(serverId))
        default:
            return Effect.void
    }
}

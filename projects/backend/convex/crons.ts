import { cronJobs } from "convex/server"
import { internal } from "./_generated/api.js"

const crons = cronJobs()
crons.interval("Clean expired backup plans", { minutes: 1 }, internal.backupRetention.cleanup)
crons.interval("Clean expired metadata logs", { minutes: 1 }, internal.metadataLogsRetention.cleanup)
crons.interval("Clean expired cleanup metadata", { minutes: 1 }, internal.cleanupRetention.cleanup)
crons.interval("Clean expired response metadata", { minutes: 1 }, internal.responses.cleanup)
crons.interval("Clean expired moderation metadata", { minutes: 1 }, internal.moderation.cleanup)
crons.interval("Clean expired publishing metadata", { minutes: 1 }, internal.publishing.cleanup)
crons.interval("Clean expired role metadata", { minutes: 1 }, internal.roleLifecycle.cleanup)
crons.interval("Clean expired greeting metadata", { minutes: 1 }, internal.greetingLifecycle.cleanup)
crons.interval("Clean expired ticket metadata", { minutes: 1 }, internal.ticketLifecycle.cleanup)
crons.interval("Clean expired leveling metadata", { minutes: 1 }, internal.levelingCleanup.cleanup)
crons.interval("Clean expired event metadata", { minutes: 1 }, internal.eventsCleanup.cleanup)
crons.interval("Clean expired schedule metadata", { minutes: 1 }, internal.schedulesCleanup.cleanup)
crons.interval("Clean expired milestone metadata", { minutes: 1 }, internal.milestonesCleanup.cleanup)
crons.interval("Clean expired suggestion metadata", { minutes: 1 }, internal.suggestionsCleanup.cleanup)
crons.interval("Purge servers removed 30 days ago", { hours: 1 }, internal.installationsPurge.purge, {})
export default crons

import { cronJobs } from "convex/server"
import { internal } from "./_generated/api.js"

const crons = cronJobs()
crons.interval("Clean expired response metadata", { minutes: 1 }, internal.responses.cleanup)
crons.interval("Clean expired moderation metadata", { minutes: 1 }, internal.moderation.cleanup)
crons.interval("Clean expired publishing metadata", { minutes: 1 }, internal.publishing.cleanup)
crons.interval("Clean expired role metadata", { minutes: 1 }, internal.roleLifecycle.cleanup)
crons.interval("Clean expired schedule metadata", { minutes: 1 }, internal.schedulesCleanup.cleanup)
export default crons

import { cronJobs } from "convex/server"
import { internal } from "./_generated/api.js"
import { RETENTION_INTERVAL_MS } from "./retention.ts"

const crons = cronJobs()
// One retention chain visits every feature's cleanup and continues itself while expired rows remain
crons.interval("Clean expired data", { minutes: RETENTION_INTERVAL_MS / 60000 }, internal.retention.run, {})
crons.interval("Clean expired analytics counts", { hours: 1 }, internal.analytics.cleanup)
crons.interval("Purge servers removed 30 days ago", { hours: 1 }, internal.installationsPurge.purge, {})
export default crons

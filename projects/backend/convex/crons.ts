import { cronJobs } from "convex/server"
import { internal } from "./_generated/api.js"
import { RETENTION_INTERVAL_MS } from "./retention.ts"

const crons = cronJobs()
// One retention chain visits every feature's cleanup and continues itself while expired rows remain
crons.interval("Clean expired data", { minutes: RETENTION_INTERVAL_MS / 60000 }, internal.retention.run, {})
export default crons

import { cronJobs } from "convex/server"
import { internal } from "./_generated/api.js"

const crons = cronJobs()
crons.interval("Clean expired response metadata", { minutes: 1 }, internal.responses.cleanup)
export default crons

import { AntiNukeDashboardContext, AntiNukeDashboardOperation } from "@neonflux/contracts/anti-nuke"
import { decode } from "./validation.ts"

export const antiNukeOperation = (value: unknown): AntiNukeDashboardOperation =>
    decode(AntiNukeDashboardOperation, value)
/** What the bot read and did for a dashboard restore */
export const antiNukeRestoreContext = (value: unknown) => decode(AntiNukeDashboardContext, value).result
/** The stored fields of a setting that tell a record its response apart */
export const incidentRecordFields = (row: { mode: string; response: string; outcome: string }) => [
    row.mode === "dry-run" ? "anti-nuke-dry-run" : `anti-nuke-${row.response}`,
    ...(row.outcome === "succeeded" || row.outcome === "failed" || row.outcome === "uncertain" ? [row.outcome] : []),
]

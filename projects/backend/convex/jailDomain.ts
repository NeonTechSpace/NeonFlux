import { JailDashboardContext, JailDashboardOperation } from "@neonflux/contracts/jail"
import { decode } from "./validation.ts"

export const jailOperation = (value: unknown): JailDashboardOperation => decode(JailDashboardOperation, value)
/** The role and channel the bot found or made for a dashboard setup */
export const jailSetupContext = (value: unknown) => decode(JailDashboardContext, value).jailSetup

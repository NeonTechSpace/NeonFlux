import { isId } from "@neonflux/contracts/common"
import type { ServiceScope } from "@neonflux/contracts/service"

/** The deployment names its one server */
export type DeploymentScope = ServiceScope
export const validServerId = isId

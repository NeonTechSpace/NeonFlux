import { RightsOperation } from "@neonflux/contracts/rights"
import { decode } from "./validation.ts"

export const rightsOperation = (value: unknown): RightsOperation => decode(RightsOperation, value)

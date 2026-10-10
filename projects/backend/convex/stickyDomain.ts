import { StickyOperation } from "@neonflux/contracts/sticky"
import { decode } from "./validation.ts"

export { STICKY_DEFAULT_INTERVAL, STICKY_LIMIT } from "@neonflux/contracts/sticky"

// Dashboard configuration jobs carry the same operation as chat
export const stickyOperation = (value: unknown): StickyOperation => decode(StickyOperation, value)

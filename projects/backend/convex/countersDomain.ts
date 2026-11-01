import { CounterOperation } from "@neonflux/contracts/counters"
import { decode } from "./validation.ts"
export { COUNTER_LIMIT } from "@neonflux/contracts/counters"

export const counterOperation = (value: unknown): CounterOperation => decode(CounterOperation, value)

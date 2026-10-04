import { AfkObserveRequest, AfkSetRequest } from "@neonflux/contracts/afk"
import { decode } from "./validation.ts"

// The bot and trusted internal callers meet the same bounds. An away message is stored trimmed
export function afkSetRequest(value: unknown) {
    const input = decode(AfkSetRequest, value)
    return { ...input, reason: input.reason.trim() }
}

export const afkObserveRequest = (value: unknown) => decode(AfkObserveRequest, value)

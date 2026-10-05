import { ConvexError } from "convex/values"

/** The backend's own reason for refusing a request, or the fallback when the request failed some other way */
export function requestError(
    error: unknown,
    fallback = "The request could not be sent. Check your connection and try again",
) {
    const data =
        error instanceof ConvexError && typeof error.data === "object" && error.data !== null
            ? (error.data as { error?: unknown })
            : undefined
    return typeof data?.error === "string" ? data.error : fallback
}

// Every value in a page address is plain text. The router's default parser reads JSON, which turns a server ID into a rounded
// number and quotes the IDs it writes, so links the bot posts would lose their server
export function parseSearch(search: string): Record<string, string> {
    return Object.fromEntries(new URLSearchParams(search))
}
export function stringifySearch(search: Record<string, unknown>): string {
    const query = new URLSearchParams()
    for (const [key, value] of Object.entries(search))
        if (typeof value === "string" || typeof value === "number" || typeof value === "boolean")
            query.set(key, String(value))
    const text = query.toString()
    return text ? `?${text}` : ""
}

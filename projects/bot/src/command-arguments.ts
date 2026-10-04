import { commands } from "@neontechspace/fluxerly/effect"

/** The argument forms the commands share: An ID with only its own kind of mention */
export const argument = {
    role: { type: "id", mention: "role" },
    channel: { type: "id", mention: "channel" },
} as const
/** A whole number in a range. The SDK reads -0 as -0, which would show as "-0" in replies and stored records */
export const wholeNumber = (token: string | undefined, min: number, max: number) => {
    const value = commands.parseArgument(token, { type: "integer", min, max })
    return value === undefined ? undefined : value + 0
}

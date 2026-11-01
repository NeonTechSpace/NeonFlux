// Whether a board may repost a message from a channel, as a pure function of channel permissions, so evals/board-visibility can score it.
// board-permissions.ts converts real channels and roles to this shape from a fresh read

/** A role and the names of the permissions it holds across the server. The everyone role has the ID everyone */
export type BoardRole = { readonly id: string; readonly permissions: readonly string[] }
export type BoardOverwrite = {
    readonly id: string
    readonly type: "role" | "member"
    readonly allow: readonly string[]
    readonly deny: readonly string[]
}
export type BoardChannel = { readonly overwrites: readonly BoardOverwrite[]; readonly nsfw: boolean }

const VIEW = "ViewChannel",
    HISTORY = "ReadMessageHistory"
type Held = Set<string> | undefined
const roleOverwrites = (channel: BoardChannel) =>
    new Map(channel.overwrites.filter((row) => row.type === "role").map((row) => [row.id, row]))
/**
 * What the everyone role plus some roles hold in a channel: Base permissions, then the everyone overwrite, then the roles' overwrites, whose
 * allow beats any of their denials. undefined stands for Administrator, which sees everything and which an overwrite can neither grant nor
 * take away. historyAssumed counts history as held until an overwrite denies it
 */
function held(
    roles: ReadonlyMap<string, BoardRole>,
    overwrites: ReadonlyMap<string, BoardOverwrite>,
    roleIds: readonly string[],
    historyAssumed: boolean,
): Held {
    const names = new Set(historyAssumed ? [HISTORY] : [])
    for (const id of ["everyone", ...roleIds]) for (const name of roles.get(id)?.permissions ?? []) names.add(name)
    if (names.has("Administrator")) return undefined
    const everyone = overwrites.get("everyone")
    for (const name of everyone?.deny ?? []) names.delete(name)
    for (const name of everyone?.allow ?? []) names.add(name)
    for (const id of roleIds) for (const name of overwrites.get(id)?.deny ?? []) names.delete(name)
    for (const id of roleIds) for (const name of overwrites.get(id)?.allow ?? []) names.add(name)
    return names
}
const readsBoard = (names: Held) => !names || names.has(VIEW)
const readsSource = (names: Held) => !names || (names.has(VIEW) && names.has(HISTORY))

/**
 * True only when everyone who can read the board can already read the source, judged for the everyone role alone, for each role with
 * everyone and for each pair of roles. Pairs are enough for any set of roles: One role is all it takes to open the board, one to hide the
 * source, and another role only adds what could open the source. Roles that act alike are judged once, and a role an overwrite names counts
 * even when the role list lacks it. A member overwrite cannot be judged by role, since which roles that member holds is not read here, so
 * one that opens the board to a member blocks unless the source is open to everyone, and one that hides the source from a member blocks too.
 * An adult source never goes to a board that is not adult. Real servers are read literally, so without a role that holds history only an
 * Administrator can read a source. evalData is for the eval's cases, whose role lists leave history out unless a case is about it
 */
export function boardMayRepost(
    roles: readonly BoardRole[],
    source: BoardChannel,
    board: BoardChannel,
    evalData = false,
): boolean {
    if (source.nsfw && !board.nsfw) return false
    const known = new Map(roles.map((role) => [role.id, role])),
        fromSource = roleOverwrites(source),
        fromBoard = roleOverwrites(board),
        historyAssumed = evalData && !roles.some((role) => role.permissions.includes(HISTORY))
    const sees = (roleIds: readonly string[]) =>
        !readsBoard(held(known, fromBoard, roleIds, historyAssumed)) ||
        readsSource(held(known, fromSource, roleIds, historyAssumed))
    const alike = new Map<string, string>()
    for (const id of [...known.keys(), ...fromSource.keys(), ...fromBoard.keys()]) {
        const role = known.get(id)
        // An Administrator role never blocks, alone or beside another
        if (id === "everyone" || role?.permissions.includes("Administrator")) continue
        alike.set(JSON.stringify([role?.permissions ?? [], fromSource.get(id) ?? null, fromBoard.get(id) ?? null]), id)
    }
    const audience = [...alike.values()]
    if (!sees([])) return false
    for (let first = 0; first < audience.length; first++)
        for (let second = first; second < audience.length; second++)
            if (!sees([audience[first]!, audience[second]!])) return false
    const members = (channel: BoardChannel) => channel.overwrites.filter((row) => row.type === "member")
    // A member overwrite's own allow beats its denial
    const hides = (row: BoardOverwrite, name: string) => row.deny.includes(name) && !row.allow.includes(name)
    if (members(source).some((row) => hides(row, VIEW) || hides(row, HISTORY))) return false
    return (
        !members(board).some((row) => row.allow.includes(VIEW)) ||
        readsSource(held(known, fromSource, [], historyAssumed))
    )
}

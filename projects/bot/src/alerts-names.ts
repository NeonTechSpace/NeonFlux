// Characters that look alike in member names, each folded to the Latin letter it imitates. Accents are removed first,
// so this list holds only lookalikes that Unicode normalization keeps apart
const lookalikes: Record<string, string> = {
    "0": "o",
    "1": "l",
    "!": "l",
    "|": "l",
    i: "l",
    "3": "e",
    "4": "a",
    "@": "a",
    "5": "s",
    $: "s",
    "7": "t",
    "8": "b",
    "9": "g",
    а: "a",
    е: "e",
    о: "o",
    р: "p",
    с: "c",
    у: "y",
    х: "x",
    і: "l",
    ј: "j",
    ѕ: "s",
    ԁ: "d",
    к: "k",
    м: "m",
    т: "t",
    в: "b",
    н: "h",
    α: "a",
    β: "b",
    ε: "e",
    ι: "l",
    κ: "k",
    ν: "v",
    ο: "o",
    ρ: "p",
    τ: "t",
    υ: "u",
    χ: "x",
}

/** A name reduced to what it looks like: compatibility forms and accents removed, lowercase, lookalikes folded and only letters and digits kept */
export function nameSkeleton(name: string) {
    // oxlint-disable-next-line typescript/no-misused-spread -- Lookalikes fold one code point at a time
    const folded = [...name.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase()]
        .map((char) => lookalikes[char] ?? char)
        .join("")
    // rn and vv read as m and w in many fonts
    return folded
        .replace(/[^\p{L}\p{N}]/gu, "")
        .replace(/rn/g, "m")
        .replace(/vv/g, "w")
}

/**
 * Whether two names look alike. Names of fewer than three characters never match. The same skeleton always matches, one
 * edit matches names of at least five characters and two edits names of at least ten, so short common names stay quiet
 */
export function namesLookAlike(left: string, right: string) {
    const a = nameSkeleton(left),
        b = nameSkeleton(right),
        shorter = Math.min(a.length, b.length)
    if (shorter < 3) return false
    if (a === b) return true
    const limit = shorter >= 10 ? 2 : shorter >= 5 ? 1 : 0
    return limit > 0 && Math.abs(a.length - b.length) <= limit && editDistance(a, b) <= limit
}
/** Changed, added or removed characters between two strings, where swapping two neighboring characters counts as one */
function editDistance(left: string, right: string) {
    const rows = Array.from({ length: left.length + 1 }, (_, row) =>
        Array.from({ length: right.length + 1 }, (_, column) => (row ? (column ? 0 : row) : column)),
    )
    for (let row = 1; row <= left.length; row++)
        for (let column = 1; column <= right.length; column++) {
            const cost = left[row - 1] === right[column - 1] ? 0 : 1
            rows[row]![column] = Math.min(
                rows[row - 1]![column]! + 1,
                rows[row]![column - 1]! + 1,
                rows[row - 1]![column - 1]! + cost,
            )
            if (row > 1 && column > 1 && left[row - 1] === right[column - 2] && left[row - 2] === right[column - 1])
                rows[row]![column] = Math.min(rows[row]![column]!, rows[row - 2]![column - 2]! + 1)
        }
    return rows[left.length]![right.length]!
}

// A changed letter costs a little more than a missing, extra or swapped one, so helo is closer to hello than to help
const CHANGED_LETTER = 1.1
// Names and words shorter than this are one mistake from too many others to allow two
const TWO_MISTAKES_FROM = 7
// What English adds to a word to make another form of it, such as ticket and tickets or solve and solved
const FORM_ENDINGS = new Set(["s", "es", "d", "ed", "ing", "ings", "ion", "ions"])
const Y_ENDINGS = new Set(["ies", "ied", "ication", "ications"])
// A form of a word followed by this many words is a sentence rather than a command, such as tickets are sold out
const SENTENCE_WORDS = 2
const KEYBOARDS = [
    ["qwertyuiop", "asdfghjkl", "zxcvbnm"],
    ["qwertzuiop", "asdfghjkl", "yxcvbnm"],
]
const SIMILAR_SOUNDS = ["aeiouy", "cksq"]
const MOST_SUGGESTIONS = 5

/** Mistakes between two words, where swapping two neighboring letters is one mistake */
function mistakes(left: string, right: string) {
    let before: number[] = []
    let previous = Array.from({ length: right.length + 1 }, (_, index) => index)
    for (let row = 1; row <= left.length; row += 1) {
        const current = [row]
        for (let column = 1; column <= right.length; column += 1) {
            let value = Math.min(
                previous[column]! + 1,
                current[column - 1]! + 1,
                previous[column - 1]! + (left[row - 1] === right[column - 1] ? 0 : CHANGED_LETTER),
            )
            if (row > 1 && column > 1 && left[row - 1] === right[column - 2] && left[row - 2] === right[column - 1])
                value = Math.min(value, before[column - 2]! + 1)
            current.push(value)
        }
        before = previous
        previous = current
    }
    return previous[right.length]!
}

/** Whether one word is a form of the other, such as role and roles, reply and replies or suggest and suggestion. A doubled last letter is a typo */
function isFormOf(left: string, right: string) {
    const [short, long] = left.length < right.length ? [left, right] : [right, left]
    if (short.length < 3 || short === long) return false
    if (long.startsWith(short)) return FORM_ENDINGS.has(long.slice(short.length)) && long[short.length] !== short.at(-1)
    const root = short.slice(0, -1)
    return long.startsWith(root) && short.endsWith("y") && Y_ENDINGS.has(long.slice(root.length))
}

/** The place of a key on a keyboard, where each row starts half a key further right */
function keyPlace(keyboard: readonly string[], letter: string) {
    const row = keyboard.findIndex((keys) => keys.includes(letter))
    return row < 0 ? undefined : { row, column: keyboard[row]!.indexOf(letter) + row / 2 }
}
/** Whether two keys touch on a QWERTY or a QWERTZ keyboard */
const nextToEachOther = (left: string, right: string) =>
    KEYBOARDS.some((keyboard) => {
        const [one, other] = [keyPlace(keyboard, left), keyPlace(keyboard, right)]
        return !!one && !!other && Math.abs(one.row - other.row) <= 1 && Math.abs(one.column - other.column) <= 1
    })

/**
 * Whether a changed letter is a mistake people make: a key next to the right one or a letter that sounds alike, as in
 * oing for ping or halp for help. Any other change is usually a different word, as in pink for ping
 */
function plausibleChange(typed: string, name: string) {
    if (typed.length !== name.length) return true
    const changed = Array.from({ length: typed.length }, (_, index) => index).filter((i) => typed[i] !== name[i])
    if (changed.length !== 1) return true
    const [from, to] = [typed[changed[0]!]!, name[changed[0]!]!]
    return nextToEachOther(from, to) || SIMILAR_SOUNDS.some((sound) => sound.includes(from) && sound.includes(to))
}

/** How far a typed word is from a name, or undefined when it is too far */
function mistakesFrom(typed: string, name: string) {
    const allowTwo = Math.min(typed.length, name.length) >= TWO_MISTAKES_FROM && typed[0] === name[0]
    const limit = allowTwo ? 2 * CHANGED_LETTER : CHANGED_LETTER
    if (Math.abs(typed.length - name.length) > limit) return undefined
    const distance = mistakes(typed, name)
    return distance > limit || (distance <= CHANGED_LETTER && !plausibleChange(typed, name)) ? undefined : distance
}

/** What a typed word could mean, as the names to weigh it against and how many words follow it */
type Typed = {
    readonly word: string
    readonly builtIn: Iterable<string>
    readonly custom?: Iterable<string>
    readonly following?: number
}

/** The names a typed word might mean, each with how far it is. A form of a built-in command is the closest there is */
function candidates({ word, builtIn, custom = [], following = 0 }: Typed) {
    const typed = word.toLowerCase(),
        builtInNames = new Set(builtIn),
        names = new Map<string, number>()
    for (const name of new Set([...builtInNames, ...custom])) {
        if (typed === name) continue
        // Custom names are often real words themselves, so another form of one is more likely chat, such as pizza and pizzas
        const distance = !isFormOf(typed, name)
            ? mistakesFrom(typed, name)
            : builtInNames.has(name) && following < SENTENCE_WORDS
              ? 0
              : undefined
        if (distance !== undefined) names.set(name, distance)
    }
    return names
}

/** Whether a typed word is close enough to some name for a hint */
export const isCloseToAny = (typed: Typed) => candidates(typed).size > 0

/** The names a typed word may have meant, closest first and at most five, ignoring the word's case */
export function closestNames(typed: Typed) {
    return [...candidates(typed)]
        .sort(([, left], [, right]) => left - right)
        .slice(0, MOST_SUGGESTIONS)
        .map(([name]) => name)
}

/** Names for a sentence, such as !afk, !lfg or !logs */
export const anyOf = (names: readonly string[]) =>
    names.length < 2 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} or ${names.at(-1)}`

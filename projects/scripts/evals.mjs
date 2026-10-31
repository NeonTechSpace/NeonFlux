// Scores what has labeled eval cases: deceptive links in automod, lookalike names in security alerts and the bot's typo hints.
// Each set lists cases with the answer a careful moderator wants. The score is how many deceptive cases are caught and how
// many harmless ones are flagged, per family. The held-out sets are only for scoring and are never used to tune a detector.
// evals/baseline.json records which cases fail today, and evals.test.mjs fails when a case that passed starts to fail.
// Usage: node scripts/evals.mjs [--json] [--update], where --update rewrites the baseline to the current results
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { deceptiveLink, protectedDomains } from "../backend/convex/moderationLinks.ts"
import { namesLookAlike } from "../bot/src/alerts-names.ts"
import { suggestCommand } from "../bot/src/help.ts"

const folder = new URL("../evals/", import.meta.url)
const read = (name) => JSON.parse(readFileSync(new URL(name, folder), "utf8"))

export const detectors = {
    "deceptive-links": {
        key: (item) => item.message,
        expected: (item) => item.deceptive,
        actual: (item) => deceptiveLink(item.message, protectedDomains),
    },
    impersonation: {
        key: (item) => `${item.staff} | ${item.name}`,
        expected: (item) => item.lookalike,
        actual: (item) => namesLookAlike(item.staff, item.name),
    },
    "command-hints": {
        key: (item) => `${item.audience} ${item.custom.join(",")} | ${item.message}`,
        expected: (item) => item.hint,
        actual: (item) => commandHint(item),
    },
}
const hintAudiences = {
    member: new Set(["everyone"]),
    staff: new Set(["everyone", "staff", "manager", "admin"]),
}
// The first word after the prefix, read as the bot reads it
// A case counts as right when its command is among the suggestions
function commandHint({ message, audience, custom, hint }) {
    const name = /^!([a-z0-9][a-z0-9_-]*)(?:\s|$)/i.exec(message)?.[1]?.toLowerCase()
    const following = message.trim().split(/\s+/).length - 1
    const suggested = name ? suggestCommand(name, hintAudiences[audience], custom, following) : []
    return suggested.includes(hint) ? hint : (suggested[0] ?? null)
}
/** The sets present for a detector. The held-out set joins the repository only after a tuning round ends */
export const sets = (detector) =>
    ["train", "holdout"].filter((set) => existsSync(new URL(`${detector}/${set}.json`, folder)))

const byText = (a, b) => (a < b ? -1 : a > b ? 1 : 0)

/** The results of every case of one detector and set */
export function score(detector, set) {
    const { key, expected, actual } = detectors[detector]
    return read(`${detector}/${set}.json`).map((item) => ({
        key: key(item),
        family: item.family,
        expected: expected(item),
        actual: actual(item),
    }))
}

/** Caught and missed deceptive cases and flagged harmless cases, in total and per family */
export function summary(results) {
    const count = (list) => ({
        positives: list.filter((r) => r.expected).length,
        caught: list.filter((r) => r.expected && r.actual === r.expected).length,
        wrong: list.filter((r) => r.expected && r.actual && r.actual !== r.expected).length,
        negatives: list.filter((r) => !r.expected).length,
        flagged: list.filter((r) => !r.expected && r.actual).length,
    })
    const families = [...new Set(results.map((r) => r.family))].sort(byText)
    return {
        ...count(results),
        families: Object.fromEntries(families.map((f) => [f, count(results.filter((r) => r.family === f))])),
    }
}

export const failing = (results) =>
    results
        .filter((r) => r.expected !== r.actual)
        .map((r) => r.key)
        .sort(byText)

if (import.meta.main) {
    const json = process.argv.includes("--json"),
        update = process.argv.includes("--update")
    const report = {},
        baseline = {}
    for (const detector of Object.keys(detectors))
        for (const set of sets(detector)) {
            const results = score(detector, set)
            report[`${detector}/${set}`] = summary(results)
            baseline[`${detector}/${set}`] = failing(results)
        }
    if (update) writeFileSync(new URL("baseline.json", folder), `${JSON.stringify(baseline, null, 4)}\n`)
    if (json) console.log(JSON.stringify(report, null, 4))
    else
        for (const [name, s] of Object.entries(report)) {
            console.log(
                `${name}: caught ${s.caught}/${s.positives}${s.wrong ? ` with ${s.wrong} wrong` : ""}, flagged ${s.flagged}/${s.negatives} harmless`,
            )
            for (const [family, f] of Object.entries(s.families))
                console.log(
                    `    ${family}: ${f.positives ? `caught ${f.caught}/${f.positives}` : ""}${f.positives && f.negatives ? ", " : ""}${f.negatives ? `flagged ${f.flagged}/${f.negatives}` : ""}`,
                )
        }
}

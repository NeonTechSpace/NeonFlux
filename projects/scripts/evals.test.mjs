import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import { detectors, failing, score, sets } from "./evals.mjs"

// The cases each detector failed when the baseline was recorded. A case that passed then must still pass, so a change
// that makes a detector worse fails here. Run `node scripts/evals.mjs --update` after an improvement to tighten it
const baseline = JSON.parse(readFileSync(new URL("../evals/baseline.json", import.meta.url), "utf8"))

for (const detector of Object.keys(detectors))
    for (const set of sets(detector))
        test(`${detector} ${set} cases that passed still pass`, () => {
            const known = new Set(baseline[`${detector}/${set}`])
            assert.ok(Array.isArray(baseline[`${detector}/${set}`]), "Missing baseline entry")
            const now = failing(score(detector, set))
            assert.deepEqual(
                now.filter((key) => !known.has(key)),
                [],
                "These cases passed at the baseline and fail now",
            )
        })

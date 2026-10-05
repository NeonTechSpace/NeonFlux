import assert from "node:assert/strict"
import { test } from "node:test"
import { attackChallenge, captureShots, decodeCells, densityControlDrop, decodePng, encodePng, gradeAttempts, parseAttempts, prepareChallenge, rankPairs, seededRandom, wilson, type Cohort } from "../scripts/motion-screenshot-eval.ts"

const seeds = ["0f1e2d3c4b5a69788796a5b4c3d2e1f0", "1234567890abcdef1234567890abcdef", "deadbeefcafef00d0123456789abcdef"]
const challenge = (cohort: Cohort, seed: string) => prepareChallenge(cohort, seed, seededRandom(seed.split("").reverse().join("")))

test("pair grading needs both rounds and allows one retry through the verifier state machine", () => {
    assert.deepEqual(gradeAttempts([1, 4], [[1, 4]]), { first: true, passed: true })
    assert.deepEqual(gradeAttempts([1, 4], [[1, 3], [1, 4]]), { first: false, passed: true })
    assert.deepEqual(gradeAttempts([1, 4], [[1, 3], [0, 4]]), { first: false, passed: false })
    assert.deepEqual(gradeAttempts([1, 4], [[1, 3], [2, 3], [1, 4]]), { first: false, passed: false })
})

test("pair ranking makes the second attempt the next most likely pair and breaks ties randomly", () => {
    assert.deepEqual(rankPairs([0, 0, 5, 0, 0, 0], [0, 9, 0, 0, 0, 4], () => 0).slice(0, 2), [[2, 1], [2, 5]])
    // Jitter alone decides between tied pairs, so equal scores do not favor option A.
    const counter = (direction: number) => { let value = 0; return () => (value += direction) / 100 }
    assert.deepEqual(rankPairs([0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0], counter(1))[0], [5, 5])
    assert.deepEqual(rankPairs([0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0], counter(-1))[0], [0, 0])
})

test("Wilson intervals and answer parsing", () => {
    assert.ok(Math.abs(wilson(0, 10)[1] - 0.2775) < 1e-4)
    const [low, high] = wilson(5, 10)
    assert.ok(Math.abs(low - 0.2366) < 1e-4 && Math.abs(high - 0.7634) < 1e-4)
    assert.deepEqual(parseAttempts("B E"), [[1, 4]])
    assert.deepEqual(parseAttempts("b,e\nC E\n"), [[1, 4], [2, 4]])
    assert.deepEqual(parseAttempts(["BE", "cf"]), [[1, 4], [2, 5]])
    for (const invalid of ["Round 1: B", "A B\nC D\nE F", "", "G A", 42, [1, 2]]) assert.equal(parseAttempts(invalid), undefined)
})

test("positive control: shift correlation solves consecutive frames and recordings, single shots give no pair evidence", () => {
    for (const seed of seeds) {
        const rounds = challenge("PAIR33", seed), { evidence, outcomes } = attackChallenge("PAIR33", rounds)
        assert.ok(evidence.every(round => round.significantPairs === 1), seed)
        assert.equal(outcomes.shift?.first, true, seed)
        // Composites survive a PNG round trip unchanged, so in-memory attacks see the published pixels.
        const image = rounds[0]!.images[0]!, decoded = decodePng(encodePng(image))
        assert.equal(decoded.width, image.width); assert.ok(Buffer.from(decoded.data).equals(Buffer.from(image.data)))
    }
    const recording = attackChallenge("RECORDING", challenge("RECORDING", seeds[0]!))
    assert.equal(recording.outcomes.shift?.first, true)
    const single = attackChallenge("S1", challenge("S1", seeds[1]!))
    assert.equal(single.outcomes.shift, undefined); assert.ok(single.evidence.every(round => round.pairs === 0 && round.shift === undefined))
    assert.deepEqual([2, 4].map(frames => decodeCells(challenge(`EXPOSURE${frames}` as Cohort, seeds[2]!)[0]!.images[0]!).k), [2, 4])
})

test("aliased captures one loop plus one frame apart land on consecutive frames and are solved", () => {
    assert.deepEqual(captureShots("ALIAS", 30, 60), { shots: [[15], [16], [17]], timesMs: [500, 2533.34, 4566.67] })
    assert.equal(attackChallenge("ALIAS", challenge("ALIAS", seeds[0]!)).outcomes.shift?.first, true)
})

test("density control: the planted leak scales with the dot count and absolute contrast solves it", () => {
    // Fewer dots need a larger removal share for the same planted z, so the control keeps its strength under tuning.
    const drops = [1000, 700, 400].map(dots => densityControlDrop(dots, 0.25))
    assert.ok(drops[0]! > 0 && drops[0]! < drops[1]! && drops[1]! < drops[2]! && drops[2]! < 1, drops.join())
    assert.throws(() => densityControlDrop(10, 0.25), /cannot reach/)
    // 80 of 80 sampled rounds ranked the answer first at 700 dots, so 11 of 12 leaves margin without depending on one seed.
    let hits = 0
    for (let index = 0; index < 6; index++) hits += attackChallenge("DENSITY_CONTROL", challenge("DENSITY_CONTROL", `${String(index).padStart(2, "0")}${seeds[index % 3]!.slice(2)}`)).outcomes.contrast!.roundHits
    assert.ok(hits >= 11, `${hits} of 12 rounds`)
})

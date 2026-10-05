import assert from "node:assert/strict"
import { test } from "node:test"
import { evaluateCase, encodePng, wilson, screenshotScores, ROUTE_GUESSES } from "../scripts/motion-screenshot-eval.ts"

test("single-frame attacks use public raster pixels and controls expose planted density and motion", () => {
    let density = 0, motion = 0
    for (let i = 0; i < 16; i++) {
        const result = evaluateCase(i)
        assert.equal(result.pixels.length, 320 * 320)
        assert.ok(Object.values(result.guesses).every(guess => guess >= 0 && guess < ROUTE_GUESSES))
        assert.equal(result.accepted[result.answer], true)
        density += Number(result.control === result.answer); motion += Number(result.recording === result.answer)
        if (i === 0) { const image = encodePng(result.pixels); assert.equal(image.subarray(1, 4).toString(), "PNG"); assert.equal(image.readUInt32BE(16), 320) }
    }
    assert.ok(density >= 14, density + " density controls")
    assert.ok(motion >= 8, motion + " motion controls")
    assert.deepEqual(screenshotScores(new Uint8Array(320 * 320), [() => 128, () => 100]), [{ density: 0, contrast: 0, edges: 0 }, { density: 0, contrast: 0, edges: 0 }])
})
test("Wilson intervals retain sampling uncertainty", () => {
    const [low, high] = wilson(25, 200)
    assert.ok(low < 0.125 && high > 0.125)
})

import assert from "node:assert/strict"
import test from "node:test"
import { createFixtures } from "@neontechspace/fluxerly/effect/testing"
import { milestoneCritical, parseMilestoneCommand } from "../src/milestone-command.ts"

test("milestone grammar requires private exact destination consent and never accepts year, age, target or epoch", () => {
    const id = createFixtures().ids.channel
    assert.deepEqual(parseMilestoneCommand(["birthday", "set", "02-29", "confirm", `<#${id}>`]), { type: "enroll", route: "birthday", monthDay: "02-29", channel: `<#${id}>` })
    assert.deepEqual(parseMilestoneCommand(["birthday", "set", "02-29", "confirm", "#celebrations"]), { type: "enroll", route: "birthday", monthDay: "02-29", channel: "#celebrations" })
    assert.deepEqual(parseMilestoneCommand(["anniversary", "on", "confirm", id]), { type: "enroll", route: "anniversary", channel: id })
    for (const args of [["birthday", "set", "2000-02-29", "confirm", id], ["birthday", "set", "02-30", "confirm", id], ["birthday", "set", "02-29"], ["birthday", "set", "02-29", "confirm", id, "@target"], ["anniversary", "on", "2020-01-01", "confirm", id], ["birthday", "list"], ["anniversary", "list"]]) assert("error" in parseMilestoneCommand(args))
    for (const args of [["remove"], ["remove", "birthday"], ["me"]]) assert(milestoneCritical(parseMilestoneCommand(args)))
})
test("milestone staff grammar binds route revisions and selective settled recovery", () => {
    const f = createFixtures()
    assert.deepEqual(parseMilestoneCommand(["configure", "birthday", "2", f.ids.channel, "Europe/Berlin", "09:00", "reject", "template", "birthday", "3"]), {
        type: "configure", route: "birthday", expectedRevision: 2, channelId: f.ids.channel, zone: "Europe/Berlin", time: "09:00", fold: "reject", templateName: "birthday", templateRevision: 3,
    })
    assert.deepEqual(parseMilestoneCommand(["forget", "anniversary", "2", "confirm"]), { type: "forget", route: "anniversary", postNo: 2, confirmed: true })
    for (const args of [["forget", "birthday"], ["forget", "birthday", "2", "1", "1"], ["configure", "birthday", "2", f.ids.channel, "UTC", "24:00", "reject", "template", "birthday", "3"]]) assert("error" in parseMilestoneCommand(args))
    assert(milestoneCritical(parseMilestoneCommand(["module", "off", "1"])))
    assert(!milestoneCritical(parseMilestoneCommand(["module", "on", "1"])))
})

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
test("milestone staff grammar takes no revisions, pages status with next and keeps selective settled recovery", () => {
    const f = createFixtures()
    assert.deepEqual(parseMilestoneCommand(["configure", "birthday", f.ids.channel, "Europe/Berlin", "09:00", "reject", "template", "birthday"]), {
        type: "configure", route: "birthday", channelId: f.ids.channel, zone: "Europe/Berlin", time: "09:00", fold: "reject", templateName: "birthday",
    })
    assert.deepEqual(parseMilestoneCommand(["enable", "anniversary"]), { type: "enable", route: "anniversary" })
    assert.deepEqual(parseMilestoneCommand(["clear", "birthday"]), { type: "clear", route: "birthday" })
    assert.deepEqual(parseMilestoneCommand(["module", "on"]), { type: "module", enabled: true })
    assert.deepEqual(parseMilestoneCommand(["status"]), { type: "status", next: false })
    assert.deepEqual(parseMilestoneCommand(["status", "birthday", "next"]), { type: "status", route: "birthday", next: true })
    assert.deepEqual(parseMilestoneCommand(["forget", "anniversary", "2", "confirm"]), { type: "forget", route: "anniversary", postNo: 2, confirmed: true })
    for (const args of [["forget", "birthday"], ["forget", "birthday", "2", "1", "1"], ["configure", "birthday", f.ids.channel, "UTC", "24:00", "reject", "template", "birthday"],
        ["configure", "birthday", "2", f.ids.channel, "Europe/Berlin", "09:00", "reject", "template", "birthday", "3"], ["configure", "birthday", f.ids.channel, "UTC", "09:00", "reject", "template", "birthday", "3"],
        ["enable", "birthday", "2"], ["module", "on", "1"], ["status", "birthday", '"synthetic_cursor"'], ["status", "next"]]) assert("error" in parseMilestoneCommand(args), JSON.stringify(args))
    assert(milestoneCritical(parseMilestoneCommand(["module", "off"])))
    assert(!milestoneCritical(parseMilestoneCommand(["module", "on"])))
})

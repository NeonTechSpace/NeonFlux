import assert from "node:assert/strict"
import test from "node:test"
import { milestoneMonthDay } from "../src/milestone-calendar.ts"

test("birthday accepts month/day only", () => {
    for (const value of ["02-29", "01-01", "12-31"]) assert(milestoneMonthDay(value))
    for (const value of ["2000-02-29", "02-30", "13-01", "00-00", "2-29", "18"]) assert(!milestoneMonthDay(value))
})

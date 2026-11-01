import { v } from "convex/values"

// active waits for its time and claimed was handed to the worker, both due. uncertain and undelivered wait only for the member or retention
export const reminderState = v.union(
    v.literal("active"),
    v.literal("claimed"),
    v.literal("uncertain"),
    v.literal("undelivered"),
)

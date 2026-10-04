import { Schema } from "effect"

// Building blocks for the contracts between the bot and the backend. Each data shape is written once, the backend decodes
// requests with it and the bot decodes answers with it

const MAX_ID = 9223372036854775807n

/** Whether a value is a Fluxer ID: a positive 64-bit integer in decimal */
export const isId = (value: unknown): value is string => typeof value === "string" && /^[1-9]\d{0,18}$/.test(value) && BigInt(value) <= MAX_ID
/** Whether a value is a stored item name: 1 to 32 lowercase letters, digits, _ or -, starting with a letter or digit */
export const isName = (value: unknown): value is string => typeof value === "string" && /^[a-z0-9][a-z0-9_-]{0,31}$/.test(value)
/** Whether text has something left once form feeds, right-to-left overrides and surrounding space are removed */
export const hasText = (value: string) => value.replace(/[\u000c\u202e]/g, "").trim() !== ""

export const Id = Schema.String.check(Schema.makeFilter(isId))
/** A safe integer from min to max */
export const Int = (min = 0, max = Number.MAX_SAFE_INTEGER) => Schema.Number.check(Schema.makeFilter((value: number) => Number.isSafeInteger(value) && value >= min && value <= max))
/** Unix milliseconds */
export const Millis = Int()
/** A mutable list of at most max items */
export const List = <S extends Schema.Top>(item: S, max: number) => Schema.mutable(Schema.Array(item)).check(Schema.isMaxLength(max))
export const Ids = (max: number) => List(Id, max)
/** Up to max characters */
export const Str = (max: number) => Schema.String.check(Schema.isMaxLength(max))
/** 1 to max characters with something besides space and invisible formatting */
export const Text = (max: number) => Schema.String.check(Schema.isMaxLength(max), Schema.makeFilter(hasText))
/** A stored name, see isName */
export const Name = Schema.String.check(Schema.makeFilter(isName))

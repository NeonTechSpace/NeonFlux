import { Schema } from "effect"

// Building blocks for the contracts between the bot and the backend. Each data shape is written once, the backend decodes
// requests with it and the bot decodes answers with it

const MAX_ID = 9223372036854775807n

/** Whether a value is a Fluxer ID: a positive 64-bit integer in decimal */
export const isId = (value: unknown): value is string => typeof value === "string" && /^[1-9]\d{0,18}$/.test(value) && BigInt(value) <= MAX_ID
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
/** An opaque page cursor. Convex cursors can be several hundred characters long */
export const Cursor = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(16384))
/** A bot-generated token such as a source or job ID */
export const Token = Schema.String.check(Schema.isPattern(/^[a-zA-Z0-9_-]{1,128}$/))
/** A permission bitfield in decimal, at most 64 bits */
export const PermissionBits = Schema.String.check(Schema.makeFilter((value: string) => /^(0|[1-9]\d{0,19})$/.test(value) && BigInt(value) <= 18446744073709551615n))
/** An ISO 8601 timestamp with a zone, as Fluxer reports join and timeout times */
export const IsoTime = Schema.String.check(Schema.makeFilter((value: string) => value.length <= 64
    && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,9})?(?:Z|[+-]\d\d:\d\d)$/.test(value) && Number.isFinite(Date.parse(value))))

/**
 * The server a native read came from. The backend matches every originServerId in a request to the request's server before
 * any feature code runs, see requireOrigin in backend/convex/serverScope.ts
 */
export const origin = { originServerId: Schema.optionalKey(Schema.String) }
export const ServerOrigin = Schema.Struct(origin)
export type ServerOrigin = typeof ServerOrigin.Type

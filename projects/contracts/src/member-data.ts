import { Schema } from "effect"
import { Id, Int, List, Str } from "./common.ts"

// Member data rights through /service/member-data, see docs/BACKEND.md#member-data-rights. The bot vouches for the member's ID after
// verifying the private conversation, and these requests bind no server, because a member's data spans every server

/** Records in one export page */
export const MEMBER_DATA_EXPORT_RECORDS = 100
const text = Str(500)
const count = Int()

/** A cursor continues a server's export or deletion where a bounded call stopped. after is a creation time, which has fractions of a millisecond */
export const MemberDataCursor = Schema.Struct({ table: Int(), after: Schema.Number.check(Schema.makeFilter((value: number) => Number.isFinite(value) && value >= 0)) })
export type MemberDataCursor = typeof MemberDataCursor.Type
/** kept names the rule that keeps a feature's data through deletion, or is null when deletion removes it */
export const MemberDataFeatureCount = Schema.Struct({ feature: text, count, kept: Schema.NullOr(text) })
export type MemberDataFeatureCount = typeof MemberDataFeatureCount.Type
/** complete is false when a feature held more rows than one read counts, so some counts are lower bounds and servers may be missing */
export const MemberDataList = Schema.Struct({ servers: Schema.mutable(Schema.Array(Schema.Struct({ serverId: Id, features: Schema.mutable(Schema.Array(MemberDataFeatureCount)) }))), complete: Schema.Boolean })
export type MemberDataList = typeof MemberDataList.Type
export const MemberDataExportPage = Schema.Struct({ records: List(Schema.Struct({ feature: text, data: Schema.Record(Schema.String, Schema.mutableKey(Schema.Unknown)) }), MEMBER_DATA_EXPORT_RECORDS),
    cursor: Schema.NullOr(MemberDataCursor) })
export type MemberDataExportPage = typeof MemberDataExportPage.Type
/** Where a bounded search for the servers that hold a member's data stopped: the table and the last server found in it, or null at its start */
export const MemberDataServerCursor = Schema.Struct({ table: Int(), after: Schema.NullOr(Id) })
export type MemberDataServerCursor = typeof MemberDataServerCursor.Type
/** Servers found by one call of /service/member-data/servers. A later page can repeat a server. cursor is null once every table was searched */
export const MemberDataServerPage = Schema.Struct({ serverIds: Schema.mutable(Schema.Array(Id)), cursor: Schema.NullOr(MemberDataServerCursor) })
export type MemberDataServerPage = typeof MemberDataServerPage.Type
export const MemberDataDeletePage = Schema.Struct({ deleted: Schema.mutable(Schema.Array(Schema.Struct({ feature: text, count }))),
    kept: Schema.mutable(Schema.Array(Schema.Struct({ feature: text, count, reason: text }))), cursor: Schema.NullOr(MemberDataCursor) })
export type MemberDataDeletePage = typeof MemberDataDeletePage.Type

export const MemberDataListRequest = Schema.Struct({ userId: Id })
export type MemberDataListRequest = typeof MemberDataListRequest.Type
export const MemberDataServersRequest = Schema.Struct({ userId: Id, cursor: Schema.NullOr(MemberDataServerCursor) })
export type MemberDataServersRequest = typeof MemberDataServersRequest.Type
export const MemberDataExportRequest = Schema.Struct({ userId: Id, serverId: Id, cursor: Schema.NullOr(MemberDataCursor) })
export type MemberDataExportRequest = typeof MemberDataExportRequest.Type
/** The server's audit log names the member by userName when it has 1 to 100 characters */
export const MemberDataDeleteRequest = Schema.Struct({ userId: Id, userName: Schema.String, serverId: Id, cursor: Schema.NullOr(MemberDataCursor) })
export type MemberDataDeleteRequest = typeof MemberDataDeleteRequest.Type

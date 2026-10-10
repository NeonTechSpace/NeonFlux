import { Schema } from "effect"
import { Id, Int, List, Millis, Str, Text, origin } from "./common.ts"
import { ModerationActor, ModerationSource } from "./shared.ts"
import { ModerationCase } from "./moderation.ts"

// Appeals, see docs/BOT.md#appeals

export const Appeal = Schema.Struct({ appealNo: Int(1), caseNo: Int(1), userId: Id, text: Str(2000), createdAt: Millis, status: Schema.Literals(["open", "accepted", "rejected", "withdrawn"]),
    decisionReason: Schema.optionalKey(Str(512)), decidedAt: Schema.optionalKey(Millis), erased: Schema.Boolean })
export type Appeal = typeof Appeal.Type
const { caseNo, action, createdAt, outcome, reason } = ModerationCase.fields
export const AppealCaseSummary = Schema.Struct({ caseNo, action, createdAt, outcome, reason })
export type AppealCaseSummary = typeof AppealCaseSummary.Type
const op = <const T extends string, F extends Schema.Struct.Fields>(type: T, fields: F) => Schema.Struct({ type: Schema.Literal(type), ...fields })
const appealNo = { appealNo: Int(1) }, page = { page: Schema.optionalKey(Int(1, 100)) }
const request = { ...origin, ...ModerationSource.fields, serverId: Id, privateChannelVerified: Schema.Boolean }
export const AppealMemberRequest = Schema.Struct({ ...request, requesterId: Id, operation: Schema.Union([
    op("submit", { caseNo: Int(1), text: Text(2000) }), op("show", appealNo), op("withdraw", appealNo), op("list", page), op("cases", { beforeCaseNo: Schema.optionalKey(Int(1)) }),
]) })
export type AppealMemberRequest = typeof AppealMemberRequest.Type
const duplicate = Schema.Struct({ duplicate: Schema.Literal(true) })
const one = Schema.Struct({ duplicate: Schema.Literal(false), type: Schema.Literal("appeal"), appeal: Appeal })
const many = Schema.Struct({ duplicate: Schema.Literal(false), type: Schema.Literal("appeals"), appeals: List(Appeal, 10), page: Int(1), totalPages: Int(1) })
export const AppealMemberResult = Schema.Union([duplicate, one, many,
    Schema.Struct({ duplicate: Schema.Literal(false), type: Schema.Literal("cases"), cases: List(AppealCaseSummary, 10), nextBeforeCaseNo: Schema.optionalKey(Int(1)) })])
export type AppealMemberResult = typeof AppealMemberResult.Type
export const AppealStaffRequest = Schema.Struct({ ...request, actor: ModerationActor, operation: Schema.Union([
    op("list", page), op("show", appealNo), op("decide", { ...appealNo, decision: Schema.Literals(["accepted", "rejected"]), reason: Text(512) }),
]) })
export type AppealStaffRequest = typeof AppealStaffRequest.Type
export const AppealStaffResult = Schema.Union([duplicate, one, many])
export type AppealStaffResult = typeof AppealStaffResult.Type

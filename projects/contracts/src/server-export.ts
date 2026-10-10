import { Schema } from "effect"
import { Id, Int, List, Millis, Str } from "./common.ts"
import { BackupContext } from "./backup.ts"

// The readable server export, documented field by field in docs/EXPORT.md. Times are Unix milliseconds

export const SERVER_EXPORT_VERSION = 1
/** The most records of each list in one page, so a page that is larger was not built by the backend */
export const EXPORT_LEVELS = 500, EXPORT_SHOWCASES = 200, EXPORT_PROFILES = 500, EXPORT_CASES = 100, EXPORT_APPEALS = 200
const text = Str(4000)
const optional = Schema.optionalKey
const data = Schema.Record(Schema.String, Schema.mutableKey(Schema.Unknown))
const cursor = Schema.NullOr(Str(4096))

export const ServerExportLevel = Schema.Struct({ userId: Id, xp: Int(), level: Int() })
export type ServerExportLevel = typeof ServerExportLevel.Type
/** reason is null when the server owner erased the case. Erasure also removes its corrections */
export const ServerExportCase = Schema.Struct({ caseNo: Int(), action: text, origin: text, incident: optional(text), actorId: optional(Id), targetId: optional(Id), channelId: optional(Id),
    ruleName: optional(text), linkedCaseNo: optional(Int()), reason: Schema.NullOr(text), outcome: text, voided: Schema.Boolean, erased: Schema.Boolean, createdAt: Millis,
    corrections: List(Schema.Struct({ type: Schema.Literals(["reason", "void"]), actorId: Id, previousReason: text, reason: text, createdAt: Millis }), 21) })
export type ServerExportCase = typeof ServerExportCase.Type
/** text and decisionReason are null when the server owner erased the appeal's case */
export const ServerExportAppeal = Schema.Struct({ appealNo: Int(), caseNo: Int(), userId: Id, status: text, text: Schema.NullOr(text), decisionReason: optional(Schema.NullOr(text)), decidedBy: optional(Id),
    decidedAt: optional(Millis), erased: Schema.Boolean, createdAt: Millis })
export type ServerExportAppeal = typeof ServerExportAppeal.Type
/** A member's showcase as stored, with its text as the member wrote it. messageId is the bot's post once Fluxer confirmed it */
export const ServerExportShowcase = Schema.Struct({ showcaseNo: Int(), authorId: Id, title: text, text, links: List(text, 3), channelId: Id, messageId: optional(Id), createdAt: Millis, updatedAt: Millis })
export type ServerExportShowcase = typeof ServerExportShowcase.Type
/** A member's profile. color is an RGB number, or null for the default */
export const ServerExportProfile = Schema.Struct({ userId: Id, bio: text, links: List(text, 3), color: Schema.NullOr(Int()), updatedAt: Millis })
export type ServerExportProfile = typeof ServerExportProfile.Type
/** One bounded page of the export. A settings page after the first of its family holds only the lists that continue. cursor is null after the last page */
export const ServerExportPage = Schema.Union([
    Schema.Struct({ cursor, section: Schema.Literal("settings"), family: Schema.String.check(Schema.isPattern(/^[a-z]{1,32}$/)), data }),
    Schema.Struct({ cursor, section: Schema.Literal("levels"), levels: List(ServerExportLevel, EXPORT_LEVELS) }),
    Schema.Struct({ cursor, section: Schema.Literal("showcases"), showcases: List(ServerExportShowcase, EXPORT_SHOWCASES) }),
    Schema.Struct({ cursor, section: Schema.Literal("profiles"), profiles: List(ServerExportProfile, EXPORT_PROFILES) }),
    Schema.Struct({ cursor, section: Schema.Literal("cases"), cases: List(ServerExportCase, EXPORT_CASES) }),
    Schema.Struct({ cursor, section: Schema.Literal("appeals"), appeals: List(ServerExportAppeal, EXPORT_APPEALS) }),
])
export type ServerExportPage = typeof ServerExportPage.Type
/** One export file. A large export from chat arrives in parts, each a file of this shape, and lastPart is true on the final one */
export const ServerExportFile = Schema.Struct({ format: Schema.Literal("neonflux-server-export"), version: Schema.Literal(SERVER_EXPORT_VERSION), serverId: Id, exportedAt: Millis, part: Int(1),
    lastPart: Schema.Boolean, settings: Schema.Record(Schema.String, Schema.mutableKey(data)), levels: Schema.mutable(Schema.Array(ServerExportLevel)),
    showcases: Schema.mutable(Schema.Array(ServerExportShowcase)), profiles: Schema.mutable(Schema.Array(ServerExportProfile)), cases: Schema.mutable(Schema.Array(ServerExportCase)),
    appeals: Schema.mutable(Schema.Array(ServerExportAppeal)) })
export type ServerExportFile = typeof ServerExportFile.Type

/** !export in a verified DM. context is the bot's fresh evidence that the server owner asked in a private one-to-one conversation, which the backend checks with backupContext */
export const ServerExportStartRequest = Schema.Struct({ serverId: Id, context: BackupContext })
export type ServerExportStartRequest = typeof ServerExportStartRequest.Type
export const ServerExportStartResult = Schema.Struct({ version: Schema.Literal(SERVER_EXPORT_VERSION) })
export type ServerExportStartResult = typeof ServerExportStartResult.Type
/** cursor is null for the first page and otherwise the previous page's cursor */
export const ServerExportPageRequest = Schema.Struct({ serverId: Id, context: BackupContext, cursor })
export type ServerExportPageRequest = typeof ServerExportPageRequest.Type

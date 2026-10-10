import { Schema } from "effect"
import { Id, Ids, Int, List, Millis, Str, Token } from "./common.ts"
import { MemberAccessOperation } from "./member-content.ts"
import { MemberAccessLists, ModerationActor, RolesMemberContext, RolesRoleSnapshot } from "./shared.ts"

// Role picker menus and member requests, see docs/BOT.md#role-picker

/** A server has at most 10 menus of at most 25 roles. Each member access list holds at most 100 entries */
export const ROLE_PICKER_MENUS = 10, ROLE_PICKER_MENU_ROLES = 25, MEMBER_ACCESS_LIMIT = 100
const name = Schema.String.check(Schema.isPattern(/^[a-z0-9][a-z0-9_-]{0,31}$/))
const unique = (values: readonly unknown[]) => new Set(values).size === values.length
const roleIds = (min: number) => Ids(ROLE_PICKER_MENU_ROLES).check(Schema.isMinLength(min), Schema.makeFilter(unique))
// One line of plain text, without control or text direction characters
const hidden = (code: number) => code < 32 || code === 127 || code >= 0x202a && code <= 0x202e || code >= 0x2066 && code <= 0x2069 || code === 0xfeff
const description = Str(200).check(Schema.isMinLength(1))
const line = description.check(Schema.makeFilter((value: string) => value === value.trim() && ![...value].some(char => hidden(char.codePointAt(0)!))))

export const RolePickerMode = Schema.Literals(["single", "multi"])
export type RolePickerMode = typeof RolePickerMode.Type
/** A server role's name and RGB color as the bot read it, zero meaning no color */
export const RolePickerRoleDisplay = Schema.Struct({ roleId: Id, name: Str(100), color: Int(0, 0xffffff) })
export type RolePickerRoleDisplay = typeof RolePickerRoleDisplay.Type
// The server's role names the bot read, each role once
const display = List(RolePickerRoleDisplay, 1000).check(Schema.makeFilter((rows: readonly RolePickerRoleDisplay[]) => unique(rows.map(row => row.roleId))))
/** At most 25 roles. Single mode lets a member hold one role of the menu at a time. Display keeps the role names the bot read at the last save */
export const RolePickerMenu = Schema.Struct({ name, description: Schema.optionalKey(description), mode: RolePickerMode, roleIds: roleIds(0),
    display: Schema.optionalKey(List(RolePickerRoleDisplay, ROLE_PICKER_MENU_ROLES)) })
export type RolePickerMenu = typeof RolePickerMenu.Type
/** At most 10 menus per server, and a role belongs to at most one menu */
export const RolePickerSettings = Schema.Struct({ enabled: Schema.Boolean,
    menus: List(RolePickerMenu, ROLE_PICKER_MENUS).check(Schema.makeFilter((menus: readonly RolePickerMenu[]) => unique(menus.map(menu => menu.name)))) })
export type RolePickerSettings = typeof RolePickerSettings.Type
export const RolePickerOperation = Schema.Union([
    Schema.Struct({ type: Schema.Literal("module"), enabled: Schema.Boolean }),
    Schema.Struct({ type: Schema.Literal("menu-set"), name, description: Schema.optionalKey(line), mode: RolePickerMode, roleIds: roleIds(0) }),
    Schema.Struct({ type: Schema.Literal("menu-add"), name, mode: RolePickerMode, description: Schema.optionalKey(line) }),
    Schema.Struct({ type: Schema.Literal("menu-update"), name, mode: Schema.optionalKey(RolePickerMode), description: Schema.optionalKey(Schema.NullOr(line)) })
        .check(Schema.makeFilter(value => value.mode !== undefined || value.description !== undefined)),
    Schema.Struct({ type: Schema.Literals(["menu-role-add", "menu-role-remove"]), name, roleIds: roleIds(1) }),
    Schema.Struct({ type: Schema.Literal("menu-remove"), name }),
    ...MemberAccessOperation.members,
])
export type RolePickerOperation = typeof RolePickerOperation.Type
export const RolePickerState = Schema.Struct({ revision: Int(), settings: RolePickerSettings, access: MemberAccessLists })
export type RolePickerState = typeof RolePickerState.Type
/** Display carries the server's current role names, which refresh the names stored with the menus */
export const RolePickerManageRequest = Schema.Struct({ serverId: Id, messageId: Id, createdAt: Millis, actor: ModerationActor, roles: Schema.optionalKey(List(RolesRoleSnapshot, 1000)),
    display: Schema.optionalKey(display), operation: RolePickerOperation })
export type RolePickerManageRequest = typeof RolePickerManageRequest.Type
export const RolePickerQueryRequest = Schema.Struct({ serverId: Id, actor: ModerationActor })
export type RolePickerQueryRequest = typeof RolePickerQueryRequest.Type
export const RolePickerMemberOperation = Schema.Union([Schema.Struct({ type: Schema.Literals(["claim", "drop"]), menu: name, roleId: Id }), Schema.Struct({ type: Schema.Literal("lookup") })])
export type RolePickerMemberOperation = typeof RolePickerMemberOperation.Type
export const RolePickerJob = Schema.Struct({ id: Token, actorId: Id, operation: RolePickerMemberOperation, state: Schema.Literals(["queued", "applied", "failed"]), createdAt: Millis, expiresAt: Millis,
    error: Schema.optionalKey(Str(512)) })
export type RolePickerJob = typeof RolePickerJob.Type
export const RolePickerReadyRequest = Schema.Struct({ serverId: Id })
export type RolePickerReadyRequest = typeof RolePickerReadyRequest.Type
export const RolePickerReadyResult = Schema.Struct({ jobs: List(RolePickerJob, 4) })
export type RolePickerReadyResult = typeof RolePickerReadyResult.Type
/**
 * The member's fresh native read and the server's role names. Lookups finish here, and claims and drops continue only when proceed is true.
 * The backend keeps names for menu roles only
 */
export const RolePickerStartRequest = Schema.Struct({ serverId: Id, jobId: Schema.String, actorId: Schema.String, context: RolesMemberContext, display: Schema.optionalKey(display) })
export type RolePickerStartRequest = typeof RolePickerStartRequest.Type
export const RolePickerStartResult = Schema.Struct({ proceed: Schema.Boolean, job: RolePickerJob })
export type RolePickerStartResult = typeof RolePickerStartResult.Type
/** The member's roles read after the role change. The backend decides applied or failed from them and the recorded attempts */
export const RolePickerCompleteRequest = RolePickerStartRequest
export type RolePickerCompleteRequest = typeof RolePickerCompleteRequest.Type
export const RolePickerCompleteResult = Schema.Struct({ job: RolePickerJob })
export type RolePickerCompleteResult = typeof RolePickerCompleteResult.Type
export const RolePickerFailRequest = Schema.Struct({ serverId: Id, jobId: Schema.String })
export type RolePickerFailRequest = typeof RolePickerFailRequest.Type
export const RolePickerFailResult = Schema.Null
export type RolePickerFailResult = typeof RolePickerFailResult.Type

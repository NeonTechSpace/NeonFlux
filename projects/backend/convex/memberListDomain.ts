import type { MemberListOperation } from "@neonflux/contracts/member-list"
import { fail } from "./validation.ts"

// Chat passes its server, whose everyone role has no place in the member list. Dashboard jobs carry the same operation
export function memberListOperation(op: MemberListOperation, serverId?: string): MemberListOperation {
    if (op.type === "set" && serverId !== undefined && op.roleIds.includes(serverId)) fail(400, "List each role once, without the everyone role")
    return op
}

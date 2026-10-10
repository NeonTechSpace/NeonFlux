import type { MemberListOperation } from "@neonflux/contracts/member-list"
import { fail } from "./validation.ts"

// The server's everyone role has no place in the member list
export function memberListOperation(op: MemberListOperation, serverId: string): MemberListOperation {
    if (op.type === "set" && op.roleIds.includes(serverId)) fail(400, "List each role once, without the everyone role")
    return op
}

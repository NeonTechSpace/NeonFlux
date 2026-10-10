import { v } from "convex/values"
import { serviceMutation } from "./installations.ts"
import type { MemberListManageResult } from "../contracts.js"
import { configurationRevision } from "./configurationRevision.ts"
import { changeConfiguration } from "./configurationChange.ts"
import { actor, administrator } from "./moderationDomain.ts"
import { shape } from "./publishingDomain.ts"
import { fail, source } from "./validation.ts"
import { memberListOperation } from "./memberListDomain.ts"

// The member-list order lives in Fluxer. The bot applies it natively first, and this records the change for the
// settings history. Reset clears every role's display position, including roles above the actor, so it needs the owner or an Administrator
export const manage = serviceMutation({ args: { request: v.any() }, handler: async (ctx, { request }): Promise<MemberListManageResult> => {
    const input = shape(request, ["serverId", "messageId", "createdAt", "actor", "managerAuthorized", "operation"], ["serverId", "messageId", "createdAt", "actor", "managerAuthorized", "operation"])
    const identity = source(input, Date.now()), who = actor(input.actor), op = memberListOperation(input.operation, identity.serverId)
    if (input.managerAuthorized !== true || !who.nativePermissionAuthorized) fail(403, "Manage Server permission required")
    if (op.type === "reset" && !administrator(who)) fail(403, "Owner or Administrator permission required")
    await changeConfiguration(ctx, identity.serverId, "memberlist", { kind: "chat", createdAt: identity.createdAt, actor: { userId: who.userId, source: "command" }, operation: op }, async () => ({}))
    return { revision: await configurationRevision(ctx, identity.serverId, "memberlist") }
} })

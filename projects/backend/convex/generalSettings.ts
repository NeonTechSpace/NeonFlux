import { v } from "convex/values"
import { serviceMutation, serviceQuery } from "./serviceGuard.ts"
import type { MutationCtx, QueryCtx } from "./_generated/server.js"
import type { Doc } from "./_generated/dataModel.js"
import {
    GeneralGetRequest,
    GeneralManageRequest,
    GeneralNicknameRequest,
    GeneralNicknameResultRequest,
    validPrefix,
    type GeneralGetResult,
    type GeneralManageResult,
    type GeneralNickname,
    type GeneralNicknameRecordResult,
    type GeneralNicknameSetResult,
} from "@neonflux/contracts/general"
import { configurationRevision } from "./configurationRevision.ts"
import { changeConfiguration } from "./configurationChange.ts"
import { decode, fail, fresh } from "./validation.ts"

export const readGeneral = (ctx: QueryCtx | MutationCtx, serverId: string) =>
    ctx.db
        .query("generalSettings")
        .withIndex("by_server", (q) => q.eq("serverId", serverId))
        .unique()
export const generalView = (row: Doc<"generalSettings"> | null) => ({
    prefix: row?.prefix ?? "!",
})
// Chat and the website both save the prefix here
export async function writeGeneral(
    ctx: MutationCtx,
    serverId: string,
    actorId: string,
    change: { prefix: unknown },
    expectedRevision: number,
) {
    if (!validPrefix(change.prefix)) fail(400, "Use one to five punctuation characters for the prefix")
    const old = await readGeneral(ctx, serverId),
        revision = old?.revision ?? 0
    if (revision !== expectedRevision) return { saved: false as const, conflict: true as const, revision }
    if (revision >= Number.MAX_SAFE_INTEGER) fail(429, "Settings revision exhausted")
    const next = { prefix: change.prefix, revision: revision + 1, updatedAt: Date.now(), updatedBy: actorId }
    if (old) await ctx.db.patch(old._id, next)
    else await ctx.db.insert("generalSettings", { serverId, ...next })
    return { saved: true as const, revision: next.revision }
}

export function publicNickname(row: Doc<"generalSettings"> | null, revision: number): GeneralNickname {
    const result = row?.nicknameResult
    return {
        nickname: row?.nickname ?? null,
        revision,
        result: result
            ? {
                  state: result.state,
                  nickname: result.nickname,
                  at: result.at,
                  ...(result.error ? { error: result.error } : {}),
              }
            : null,
    }
}
/** Record an explicit set or reset. The bot applies it natively and then reports the result for this revision */
export async function writeNickname(
    ctx: MutationCtx,
    serverId: string,
    actorId: string,
    nickname: string | null,
    revision: number,
) {
    const old = await readGeneral(ctx, serverId),
        now = Date.now()
    const nicknameResult = { state: "pending" as const, nickname, revision, at: now, actorId }
    if (old) await ctx.db.patch(old._id, { nickname: nickname ?? undefined, nicknameResult })
    else
        await ctx.db.insert("generalSettings", {
            serverId,
            prefix: "!",
            revision: 0,
            updatedAt: now,
            updatedBy: actorId,
            ...(nickname === null ? {} : { nickname }),
            nicknameResult,
        })
}
export const get = serviceQuery({
    args: { request: v.any() },
    handler: async (ctx, { request }): Promise<GeneralGetResult> => {
        const { serverId } = decode(GeneralGetRequest, request),
            row = await readGeneral(ctx, serverId)
        return {
            ...generalView(row),
            revision: row?.revision ?? 0,
            nickname: publicNickname(row, await configurationRevision(ctx, serverId, "nickname")),
        }
    },
})
export const manage = serviceMutation({
    args: { request: v.any() },
    handler: async (ctx, { request }): Promise<GeneralManageResult> => {
        const input = decode(GeneralManageRequest, request)
        if (!input.managerAuthorized) fail(403, "Manage community permission required")
        return writeGeneral(ctx, input.serverId, input.actorId, { prefix: input.prefix }, input.expectedRevision)
    },
})
export const nickname = serviceMutation({
    args: { request: v.any() },
    handler: async (ctx, { request }): Promise<GeneralNicknameSetResult> => {
        const {
            serverId,
            actorId,
            managerAuthorized,
            createdAt,
            nickname: value,
        } = decode(GeneralNicknameRequest, request)
        if (!managerAuthorized) fail(403, "Manage community permission required")
        fresh(createdAt, Date.now())
        // The change records the revision it is about to take, which the revision bump after it confirms
        const revision = await changeConfiguration(
            ctx,
            serverId,
            "nickname",
            {
                kind: "chat",
                createdAt,
            },
            async () => {
                const next = (await configurationRevision(ctx, serverId, "nickname")) + 1
                await writeNickname(ctx, serverId, actorId, value, next)
                return next
            },
        )
        return { revision }
    },
})
/** Only the result for the latest explicit change is kept. A late result for an older change is ignored */
export const nicknameResult = serviceMutation({
    args: { request: v.any() },
    handler: async (ctx, { request }): Promise<GeneralNicknameRecordResult> => {
        const {
            serverId,
            revision,
            nickname: value,
            state,
            error,
        } = decode(GeneralNicknameResultRequest, request, "Invalid nickname result")
        const row = await readGeneral(ctx, serverId),
            pending = row?.nicknameResult
        if (
            !row ||
            !pending ||
            pending.revision !== revision ||
            pending.nickname !== value ||
            (await configurationRevision(ctx, serverId, "nickname")) !== revision
        )
            return { recorded: false }
        const { error: _previous, ...rest } = pending
        await ctx.db.patch(row._id, {
            nicknameResult: {
                ...rest,
                state,
                at: Date.now(),
                ...(state === "failed" ? { error: error ?? "Fluxer did not confirm the nickname" } : {}),
            },
        })
        return { recorded: true }
    },
})

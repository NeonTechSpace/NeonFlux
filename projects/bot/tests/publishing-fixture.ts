import type { PublishingDraft, PublishingManageResult, PublishingSettings } from "@neonflux/contracts/publishing"
import { canonicalPublishingContent, type PublishingGrant, type PublishingPost } from "@neonflux/contracts/publishing-base"
import { Clock, Effect } from "effect"
import { PublishingStoreError, type PublishingStore } from "../src/publishing-store.ts"

/** The shared types are read-only. The fixture and its tests change stored drafts and posts in place */
export type Writable<T> = { -readonly [K in keyof T]: Writable<T[K]> }
export function publishingBoundary(overrides: Partial<PublishingStore> = {}) {
    const calls: { method: string, input: unknown }[] = []
    const drafts = new Map<string, Writable<PublishingDraft>>()
    const posts = new Map<number, Writable<PublishingPost>>()
    const current: Writable<PublishingSettings> = { enabled: true }
    const key = (kind: string, name: string) => `${kind}:${name}`
    const missing = (operation: string) => Effect.fail(new PublishingStoreError({ operation, status: 404 }))
    let nextPostNo = 0
    const store: PublishingStore = {
        observe: (input) => { calls.push({ method: "observe", input }); return Effect.succeed({ uncertainAttempts: 0 }) },
        query: (input) => {
            calls.push({ method: "query", input })
            const op = input.operation
            if (op.type === "settings") return Effect.succeed({ type: "settings", settings: { ...current } })
            if (op.type === "draft-show") { const draft = drafts.get(key(op.kind, op.name)); return draft ? Effect.succeed({ type: "draft", draft: structuredClone(draft) }) : missing("query") }
            if (op.type === "post-show") { const post = posts.get(op.postNo); return post ? Effect.succeed({ type: "post", post: structuredClone(post) }) : missing("query") }
            if (op.type === "draft-list") return Effect.succeed({ type: "drafts", kind: op.kind, page: op.page ?? 1, totalPages: 1, drafts: [...drafts.values()].filter((d) => d.kind === op.kind).map((d) => structuredClone(d)) })
            return Effect.succeed({ type: "posts", posts: [...posts.values()].reverse().map((p) => structuredClone(p)) })
        },
        manage: (input) => Clock.currentTimeMillis.pipe(Effect.flatMap((now): Effect.Effect<PublishingManageResult, PublishingStoreError> => {
            calls.push({ method: "manage", input })
            const op = input.operation
            if (op.type === "settings") { Object.assign(current, op.patch); return Effect.succeed({ duplicate: false, type: "settings", settings: { ...current } }) }
            if (op.type === "forget") { posts.delete(op.postNo); return Effect.succeed({ duplicate: false, type: "forgotten", postNo: op.postNo }) }
            if (op.type === "resolve") {
                const post = posts.get(op.postNo)
                if (!post) return missing("manage")
                post.outcome = op.outcome; post.attempt.outcome = op.outcome
                if (op.outcome === "sent") {
                    post.messageId = op.messageId; post.attempt.messageId = op.messageId
                    post.confirmedContent = post.attempt.content; post.confirmedCanonicalContent = post.attempt.canonicalContent
                }
                return Effect.succeed({ duplicate: false, type: "resolved", post: structuredClone(post) })
            }
            if (op.type === "draft-create") {
                const content = structuredClone(op.content ?? { content: "" })
                const draft: Writable<PublishingDraft> = { kind: op.kind, name: op.name, revision: 1, content, canonicalContent: canonicalPublishingContent(content), createdAt: input.createdAt, updatedAt: input.createdAt }
                drafts.set(key(op.kind, op.name), draft)
                return Effect.succeed({ duplicate: false, type: "draft", draft: structuredClone(draft) })
            }
            const draft = drafts.get(key(op.kind, op.name))
            if (!draft) return missing("manage")
            if (draft.revision !== op.expectedRevision) return Effect.fail(new PublishingStoreError({ operation: "manage", status: 409 }))
            if (op.type === "draft-delete") { drafts.delete(key(op.kind, op.name)); return Effect.succeed({ duplicate: false, type: "deleted", kind: op.kind, name: op.name }) }
            if (op.type === "draft-clone") {
                const clone = { ...structuredClone(draft), kind: op.toKind, name: op.toName, revision: 1 }
                drafts.set(key(op.toKind, op.toName), clone)
                return Effect.succeed({ duplicate: false, type: "draft", draft: clone })
            }
            if (op.type === "draft-set") {
                draft.content = structuredClone(op.content)
                draft.revision++; draft.updatedAt = input.createdAt; draft.canonicalContent = canonicalPublishingContent(draft.content)
                return Effect.succeed({ duplicate: false, type: "draft", draft: structuredClone(draft) })
            }
            if (op.type === "draft-update") {
                const edit = op.edit
                if (edit.type === "content") draft.content.content = edit.content
                else if (edit.type === "embed") draft.content.embed = edit.embed
                else if (edit.type === "embed-clear") delete draft.content.embed
                else {
                    const e = draft.content.embed ??= {}
                    if (edit.type === "embed-property") { if (edit.value === null) delete e[edit.field]; else Object.assign(e, { [edit.field]: edit.value }) }
                    else if (edit.type === "fields-clear") delete e.fields
                    else if (edit.type === "field-add") (e.fields ??= []).push(edit.field)
                    else if (edit.type === "field-set") (e.fields ??= [])[edit.index - 1] = edit.field
                    else e.fields?.splice(edit.index - 1, 1)
                }
                draft.revision++; draft.updatedAt = input.createdAt; draft.canonicalContent = canonicalPublishingContent(draft.content)
                return Effect.succeed({ duplicate: false, type: "draft", draft: structuredClone(draft) })
            }
            if (op.type === "preview") return Effect.succeed({ duplicate: false, type: "preview", draft: structuredClone(draft) })
            const previous = op.type === "edit" ? posts.get(op.postNo) : undefined
            const postNo = previous?.postNo ?? ++nextPostNo
            const grant: PublishingGrant = { attemptId: `synthetic_attempt_${postNo}_${previous ? previous.generation + 1 : 1}`, postNo, generation: previous ? previous.generation + 1 : 1,
                sourceId: input.messageId, actorId: input.actor.userId, botId: op.context.botId, action: op.type, channelId: op.context.channelId, dispatchExpiresAt: now + 180000, nativeDeadlineMs: 5000,
                draftKind: op.kind, draftName: op.name, draftRevision: draft.revision, content: structuredClone(draft.content), canonicalContent: structuredClone(draft.canonicalContent),
                ...(previous?.messageId ? { messageId: previous.messageId, expectedContent: previous.confirmedCanonicalContent! } : {}) }
            const post: Writable<PublishingPost> = { postNo, generation: grant.generation, channelId: grant.channelId, botId: grant.botId, outcome: "pending",
                createdAt: previous?.createdAt ?? now, updatedAt: now, attempt: { ...grant, outcome: "pending", createdAt: now },
                ...(previous?.messageId ? { messageId: previous.messageId } : {}), ...(previous?.confirmedContent ? { confirmedContent: previous.confirmedContent, confirmedCanonicalContent: previous.confirmedCanonicalContent!, confirmedDraftRevision: previous.confirmedDraftRevision! } : {}) }
            posts.set(postNo, post)
            return Effect.succeed({ duplicate: false, type: "post", post: structuredClone(post), grant: structuredClone(grant) })
        })),
        dispatch: (input) => {
            calls.push({ method: "dispatch", input })
            const post = posts.get(input.postNo)
            return Effect.succeed({ claimed: !post || post.generation === input.generation && post.attempt.attemptId === input.attemptId && post.outcome === "pending" && post.attempt.dispatchedAt === undefined,
                dispatchExpiresAt: post?.attempt.dispatchExpiresAt ?? Number.MAX_SAFE_INTEGER, nativeDeadlineMs: 5000 })
        },
        outcome: (input) => {
            calls.push({ method: "outcome", input }); const post = posts.get(input.postNo)!
            if (post && post.generation === input.generation && post.attempt.attemptId === input.attemptId) {
                post.outcome = input.outcome; post.attempt.outcome = input.outcome
                if (input.messageId) { post.messageId = input.messageId; post.attempt.messageId = input.messageId }
                if (input.outcome === "sent") { post.confirmedContent = post.attempt.content; post.confirmedCanonicalContent = post.attempt.canonicalContent; if (post.attempt.draftRevision !== undefined) post.confirmedDraftRevision = post.attempt.draftRevision }
            }
            return Effect.succeed({ recorded: true })
        },
        reconcile: (input) => { calls.push({ method: "reconcile", input }); return Effect.succeed({ recorded: true, post: structuredClone(posts.get(input.postNo)!) }) },
        ...overrides,
    }
    return { store, calls, drafts, posts, current }
}

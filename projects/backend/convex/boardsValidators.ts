import { v } from "convex/values"

export const boardProblem = v.union(v.literal("channel"), v.literal("permission"))
// queued waits for the bot, reserved holds a publishing attempt, and sent, failed and uncertain follow its outcome. remove waits for the bot to
// delete the post, and removing means the delete was claimed: An unfinished claim stays unknown and is never sent again
export const boardEntryState = v.union(
    v.literal("queued"),
    v.literal("reserved"),
    v.literal("sent"),
    v.literal("failed"),
    v.literal("uncertain"),
    v.literal("remove"),
    v.literal("removing"),
)
/** A post is its own source, provenance and consumer in the publisher */
export const publishingBoardConsumer = v.object({
    type: v.literal("board"),
    boardId: v.string(),
    messageId: v.string(),
})

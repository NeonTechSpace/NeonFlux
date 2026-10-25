import { format } from "@neontechspace/fluxerly/effect"
import { levelStartXp, type LevelingProfile, type LevelingRank } from "@neonflux/contracts/leveling"
import type { Card } from "./reply-style.ts"

// Equal XP shares a rank, so a member with company says how many others share it
const formatRank = (rank: LevelingRank) =>
    rank.type === "unranked"
        ? "Unranked"
        : rank.type === "counting"
          ? "Counting, try again in a minute"
          : rank.tied
            ? `#${rank.position}, tied with ${rank.tied} ${rank.tied === 1 ? "other" : "others"}`
            : `#${rank.position}`

/** The level and the next level's start come from the decoded profile */
export function rankCard(
    { userId, xp, level, nextLevelXp }: Pick<LevelingProfile, "userId" | "xp" | "level" | "nextLevelXp">,
    rank: LevelingRank,
): Card {
    const floor = levelStartXp(level),
        next = nextLevelXp ?? floor
    const fraction = next === floor ? 1 : (xp - floor) / (next - floor)
    const filled = Math.max(0, Math.min(10, Math.floor(fraction * 10)))
    return {
        title: "Message rank",
        description: format.userMention(userId),
        fields: [
            ["Level", String(level)],
            ["Lifetime XP", xp.toLocaleString("en-US")],
            ["Server rank", formatRank(rank)],
            [
                "Progress",
                `${"▰".repeat(filled)}${"▱".repeat(10 - filled)} ${level === 1000 ? "Maximum level" : `${xp - floor} of ${next - floor} XP to level ${level + 1}`}`,
            ],
        ],
    }
}

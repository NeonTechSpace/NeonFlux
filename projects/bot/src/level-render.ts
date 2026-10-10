import { format } from "@neontechspace/fluxerly/effect"
import { levelStartXp, type LevelingProfile } from "@neonflux/contracts/leveling"
import type { Card } from "./reply-style.ts"

// A range is reported when more than 100 members of the same level score higher, so only the level's bounds are known
export type RankPosition = number | { from: number, to: number } | "unranked"
const formatRank = (rank: RankPosition) => rank === "unranked" ? "Unranked" : typeof rank === "number" ? `#${rank}` : `#${rank.from} to #${rank.to}`

/** The level and the next level's start come from the decoded profile */
export function rankCard({ userId, xp, level, nextLevelXp }: Pick<LevelingProfile, "userId" | "xp" | "level" | "nextLevelXp">, rank: RankPosition): Card {
    const floor = levelStartXp(level), next = nextLevelXp ?? floor
    const fraction = next === floor ? 1 : (xp - floor) / (next - floor)
    const filled = Math.max(0, Math.min(10, Math.floor(fraction * 10)))
    return { title: "Message rank", description: format.userMention(userId), fields: [["Level", String(level)], ["Lifetime XP", xp.toLocaleString("en-US")], ["Server rank", formatRank(rank)],
        ["Progress", `${"▰".repeat(filled)}${"▱".repeat(10 - filled)} ${level === 1000 ? "Maximum level" : `${xp - floor} of ${next - floor} XP to level ${level + 1}`}`]] }
}

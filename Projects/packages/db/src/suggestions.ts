import { and, eq } from 'drizzle-orm';
import { err, ok, type Result } from 'neverthrow';

import {
    normalizeOptionalText,
    normalizeRequiredText,
    type GuildFeatureRepositoryDatabase,
    type GuildFeatureRepositoryError,
} from './feature-repository-types.js';
import { suggestionBoards, suggestionVotes, suggestions } from './schema.js';

export type SuggestionBoardRecord = typeof suggestionBoards.$inferSelect;
export type SuggestionRecord = typeof suggestions.$inferSelect;
export type SuggestionVoteRecord = typeof suggestionVotes.$inferSelect;
export type SuggestionsRepositoryError = GuildFeatureRepositoryError;

export async function createSuggestionBoard(
    db: GuildFeatureRepositoryDatabase,
    input: { guildId: string; channelId: string; name: string; config?: Record<string, unknown> }
): Promise<Result<SuggestionBoardRecord, SuggestionsRepositoryError>> {
    const guildId = normalizeRequiredText(input.guildId, 'guildId');
    const channelId = normalizeRequiredText(input.channelId, 'channelId');
    const name = normalizeRequiredText(input.name, 'name');

    if (guildId.isErr()) return err(guildId.error);
    if (channelId.isErr()) return err(channelId.error);
    if (name.isErr()) return err(name.error);

    try {
        const rows = await db
            .insert(suggestionBoards)
            .values({
                guildId: guildId.value,
                channelId: channelId.value,
                name: name.value,
                config: input.config ?? {},
            })
            .returning();
        const row = rows[0];

        return row ? ok(row) : err({ type: 'database-error' });
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function createSuggestion(
    db: GuildFeatureRepositoryDatabase,
    input: {
        guildId: string;
        authorUserId: string;
        content: string;
        boardId?: string;
        messageId?: string;
    }
): Promise<Result<SuggestionRecord, SuggestionsRepositoryError>> {
    const guildId = normalizeRequiredText(input.guildId, 'guildId');
    const authorUserId = normalizeRequiredText(input.authorUserId, 'authorUserId');
    const content = normalizeRequiredText(input.content, 'content');

    if (guildId.isErr()) return err(guildId.error);
    if (authorUserId.isErr()) return err(authorUserId.error);
    if (content.isErr()) return err(content.error);

    try {
        const rows = await db
            .insert(suggestions)
            .values({
                guildId: guildId.value,
                authorUserId: authorUserId.value,
                content: content.value,
                boardId: normalizeOptionalText(input.boardId),
                messageId: normalizeOptionalText(input.messageId),
            })
            .returning();
        const row = rows[0];

        return row ? ok(row) : err({ type: 'database-error' });
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function upsertSuggestionVote(
    db: GuildFeatureRepositoryDatabase,
    input: { suggestionId: string; userId: string; vote: string }
): Promise<Result<SuggestionVoteRecord, SuggestionsRepositoryError>> {
    const suggestionId = normalizeRequiredText(input.suggestionId, 'suggestionId');
    const userId = normalizeRequiredText(input.userId, 'userId');
    const vote = normalizeRequiredText(input.vote, 'vote');

    if (suggestionId.isErr()) return err(suggestionId.error);
    if (userId.isErr()) return err(userId.error);
    if (vote.isErr()) return err(vote.error);

    try {
        const rows = await db
            .insert(suggestionVotes)
            .values({
                suggestionId: suggestionId.value,
                userId: userId.value,
                vote: vote.value,
            })
            .onConflictDoUpdate({
                target: [suggestionVotes.suggestionId, suggestionVotes.userId],
                set: {
                    vote: vote.value,
                    updatedAt: new Date(),
                },
            })
            .returning();
        const row = rows[0];

        return row ? ok(row) : err({ type: 'database-error' });
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function findSuggestionVote(
    db: GuildFeatureRepositoryDatabase,
    input: { suggestionId: string; userId: string }
): Promise<Result<SuggestionVoteRecord, SuggestionsRepositoryError>> {
    const suggestionId = normalizeRequiredText(input.suggestionId, 'suggestionId');
    const userId = normalizeRequiredText(input.userId, 'userId');

    if (suggestionId.isErr()) return err(suggestionId.error);
    if (userId.isErr()) return err(userId.error);

    try {
        const rows = await db
            .select()
            .from(suggestionVotes)
            .where(and(eq(suggestionVotes.suggestionId, suggestionId.value), eq(suggestionVotes.userId, userId.value)))
            .limit(1);
        const row = rows[0];

        return row ? ok(row) : err({ type: 'not-found' });
    } catch {
        return err({ type: 'database-error' });
    }
}

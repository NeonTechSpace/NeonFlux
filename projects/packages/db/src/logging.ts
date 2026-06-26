import { and, desc, eq } from 'drizzle-orm';
import { err, ok, type Result } from 'neverthrow';

import {
    normalizeOptionalText,
    normalizeRequiredText,
    type GuildFeatureRepositoryDatabase,
    type GuildFeatureRepositoryError,
} from './feature-repository-types.js';
import { botActionEvents } from './schema.js';

export type BotActionEventRecord = typeof botActionEvents.$inferSelect;
export type LoggingRepositoryError = GuildFeatureRepositoryError;

export async function recordBotActionEvent(
    db: GuildFeatureRepositoryDatabase,
    input: {
        guildId?: string | null;
        feature: string;
        action: string;
        actorUserId?: string;
        targetId?: string;
        metadata?: Record<string, unknown>;
    }
): Promise<Result<BotActionEventRecord, LoggingRepositoryError>> {
    const feature = normalizeRequiredText(input.feature, 'feature');
    const action = normalizeRequiredText(input.action, 'action');

    if (feature.isErr()) return err(feature.error);
    if (action.isErr()) return err(action.error);

    try {
        const rows = await db
            .insert(botActionEvents)
            .values({
                guildId: normalizeOptionalText(input.guildId) ?? null,
                feature: feature.value,
                action: action.value,
                actorUserId: normalizeOptionalText(input.actorUserId),
                targetId: normalizeOptionalText(input.targetId),
                metadata: input.metadata ?? {},
            })
            .returning();
        const row = rows[0];

        return row ? ok(row) : err({ type: 'database-error' });
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function listBotActionEventsByGuildId(
    db: GuildFeatureRepositoryDatabase,
    input: { guildId: string; feature?: string }
): Promise<Result<BotActionEventRecord[], LoggingRepositoryError>> {
    const guildId = normalizeRequiredText(input.guildId, 'guildId');

    if (guildId.isErr()) return err(guildId.error);

    try {
        const rows = await db
            .select()
            .from(botActionEvents)
            .where(
                input.feature
                    ? and(eq(botActionEvents.guildId, guildId.value), eq(botActionEvents.feature, input.feature))
                    : eq(botActionEvents.guildId, guildId.value)
            )
            .orderBy(desc(botActionEvents.createdAt));

        return ok(rows);
    } catch {
        return err({ type: 'database-error' });
    }
}

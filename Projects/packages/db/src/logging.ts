import { and, desc, eq, lt, or, sql } from 'drizzle-orm';
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
export type BotActionEventCursor = {
    createdAt: Date;
    id: string;
};
export type BotActionEventPage = {
    records: BotActionEventRecord[];
    nextCursor?: BotActionEventCursor;
};

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
    input: { guildId: string; feature?: string; limit?: number }
): Promise<Result<BotActionEventRecord[], LoggingRepositoryError>> {
    const guildId = normalizeRequiredText(input.guildId, 'guildId');
    const feature = normalizeOptionalText(input.feature);
    const limit = normalizeBotActionEventLimit(input.limit);

    if (guildId.isErr()) return err(guildId.error);

    try {
        const rows = await db
            .select()
            .from(botActionEvents)
            .where(
                feature
                    ? and(eq(botActionEvents.guildId, guildId.value), eq(botActionEvents.feature, feature))
                    : eq(botActionEvents.guildId, guildId.value)
            )
            .orderBy(desc(botActionEvents.createdAt))
            .limit(limit);

        return ok(rows);
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function listBotActionEventPageByGuildId(
    db: GuildFeatureRepositoryDatabase,
    input: { guildId: string; feature?: string; limit?: number; cursor?: BotActionEventCursor; search?: string }
): Promise<Result<BotActionEventPage, LoggingRepositoryError>> {
    const guildId = normalizeRequiredText(input.guildId, 'guildId');
    const feature = normalizeOptionalText(input.feature);
    const cursor = normalizeBotActionEventCursor(input.cursor);
    const limit = normalizeBotActionEventLimit(input.limit);
    const searchTokens = normalizeBotActionEventSearch(input.search);

    if (guildId.isErr()) return err(guildId.error);
    if (cursor.isErr()) return err(cursor.error);

    try {
        const conditions = [
            eq(botActionEvents.guildId, guildId.value),
            ...(feature ? [eq(botActionEvents.feature, feature)] : []),
            ...(cursor.value
                ? [
                      or(
                          lt(botActionEvents.createdAt, cursor.value.createdAt),
                          and(
                              eq(botActionEvents.createdAt, cursor.value.createdAt),
                              lt(botActionEvents.id, cursor.value.id)
                          )
                      ),
                  ]
                : []),
            ...searchTokens.map((token) => matchesBotActionEventSearchToken(token)),
        ];
        const rows = await db
            .select()
            .from(botActionEvents)
            .where(and(...conditions))
            .orderBy(desc(botActionEvents.createdAt), desc(botActionEvents.id))
            .limit(limit + 1);
        const records = rows.slice(0, limit);
        const extraRow = rows.at(limit);

        return ok({
            records,
            ...(extraRow ? { nextCursor: toBotActionEventCursor(records.at(-1) ?? extraRow) } : {}),
        });
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function listAllBotActionEventsByGuildId(
    db: GuildFeatureRepositoryDatabase,
    input: { guildId: string; feature?: string }
): Promise<Result<BotActionEventRecord[], LoggingRepositoryError>> {
    const guildId = normalizeRequiredText(input.guildId, 'guildId');
    const feature = normalizeOptionalText(input.feature);

    if (guildId.isErr()) return err(guildId.error);

    try {
        const rows = await db
            .select()
            .from(botActionEvents)
            .where(
                feature
                    ? and(eq(botActionEvents.guildId, guildId.value), eq(botActionEvents.feature, feature))
                    : eq(botActionEvents.guildId, guildId.value)
            )
            .orderBy(desc(botActionEvents.createdAt));

        return ok(rows);
    } catch {
        return err({ type: 'database-error' });
    }
}

function toBotActionEventCursor(record: BotActionEventRecord): BotActionEventCursor {
    return {
        createdAt: record.createdAt,
        id: record.id,
    };
}

function normalizeBotActionEventLimit(limit: number | undefined): number {
    if (limit === undefined || !Number.isFinite(limit)) {
        return 25;
    }

    return Math.min(Math.max(Math.trunc(limit), 1), 100);
}

function normalizeBotActionEventCursor(
    cursor: BotActionEventCursor | undefined
): Result<BotActionEventCursor | undefined, LoggingRepositoryError> {
    if (!cursor) {
        return ok(undefined);
    }

    if (!(cursor.createdAt instanceof Date) || Number.isNaN(cursor.createdAt.getTime())) {
        return err({ type: 'invalid-value', field: 'cursor' });
    }

    const id = normalizeRequiredText(cursor.id, 'cursor');

    if (id.isErr()) return err(id.error);

    return ok({
        createdAt: cursor.createdAt,
        id: id.value,
    });
}

function normalizeBotActionEventSearch(search: string | undefined): string[] {
    return (
        search
            ?.trim()
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, ' ')
            .split(/\s+/)
            .filter(Boolean)
            .slice(0, 8) ?? []
    );
}

function matchesBotActionEventSearchToken(token: string) {
    const fuzzyPattern = token.split('').join('.*');
    const fieldMatches = [
        botActionEvents.feature,
        botActionEvents.action,
        botActionEvents.actorUserId,
        botActionEvents.targetId,
        botActionEvents.metadata,
        botActionEvents.createdAt,
    ].map((field) => sql`regexp_replace(lower(coalesce(${field}::text, '')), '[^a-z0-9]+', '', 'g') ~ ${fuzzyPattern}`);

    return or(...fieldMatches) ?? sql`false`;
}

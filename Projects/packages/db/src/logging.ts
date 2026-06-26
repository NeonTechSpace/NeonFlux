import { and, desc, eq, lt, or, sql, type AnyColumn, type SQL } from 'drizzle-orm';
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
export type BotActionEventSearchScope = 'all' | 'event' | 'actor' | 'channel' | 'message' | 'time' | 'metadata';
type BotActionEventSearchField = AnyColumn | SQL;

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
    input: {
        guildId: string;
        feature?: string;
        limit?: number;
        cursor?: BotActionEventCursor;
        search?: string;
        searchScope?: BotActionEventSearchScope;
        searchOffsetMinutes?: number;
    }
): Promise<Result<BotActionEventPage, LoggingRepositoryError>> {
    const guildId = normalizeRequiredText(input.guildId, 'guildId');
    const feature = normalizeOptionalText(input.feature);
    const cursor = normalizeBotActionEventCursor(input.cursor);
    const limit = normalizeBotActionEventLimit(input.limit);
    const searchTokens = normalizeBotActionEventSearch(input.search);
    const searchScope = normalizeBotActionEventSearchScope(input.searchScope);
    const searchOffsetMinutes = normalizeBotActionEventSearchOffset(input.searchOffsetMinutes);

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
            ...searchTokens.map((token) => matchesBotActionEventSearchToken(token, searchScope, searchOffsetMinutes)),
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
            .split(/\s+/)
            .map((token) => token.replace(/[^a-z0-9]+/g, ''))
            .filter(Boolean)
            .slice(0, 8) ?? []
    );
}

function normalizeBotActionEventSearchScope(scope: BotActionEventSearchScope | undefined): BotActionEventSearchScope {
    switch (scope) {
        case 'event':
        case 'actor':
        case 'channel':
        case 'message':
        case 'time':
        case 'metadata':
            return scope;

        case 'all':
        case undefined:
            return 'all';
    }
}

function normalizeBotActionEventSearchOffset(offsetMinutes: number | undefined): number | undefined {
    if (offsetMinutes === undefined || !Number.isFinite(offsetMinutes)) {
        return undefined;
    }

    return Math.min(Math.max(Math.trunc(offsetMinutes), -1440), 1440);
}

function matchesBotActionEventSearchToken(
    token: string,
    scope: BotActionEventSearchScope,
    searchOffsetMinutes: number | undefined
) {
    const fields = getBotActionEventSearchFields(scope, searchOffsetMinutes);
    const fieldMatches = fields.map((field) => normalizedFieldContains(field, token));

    return or(...fieldMatches) ?? sql`false`;
}

function getBotActionEventSearchFields(
    scope: BotActionEventSearchScope,
    searchOffsetMinutes: number | undefined
): BotActionEventSearchField[] {
    const eventFields = [botActionEvents.feature, botActionEvents.action];
    const actorFields = [
        botActionEvents.actorUserId,
        sql`${botActionEvents.metadata}->>'actorUsername'`,
        sql`${botActionEvents.metadata}->>'actorDisplayName'`,
        sql`${botActionEvents.metadata}->>'actorGlobalName'`,
    ];
    const channelFields = [
        sql`${botActionEvents.metadata}->>'channelName'`,
        sql`${botActionEvents.metadata}->>'channelId'`,
    ];
    const messageFields = [botActionEvents.targetId, sql`${botActionEvents.metadata}->>'messageId'`];
    const timeFields = [
        botActionEvents.createdAt,
        sql`to_char(${botActionEvents.createdAt}, 'YYYY-MM-DD HH24:MI:SS AM MM/DD/YYYY HH12:MI:SS AM')`,
        ...(searchOffsetMinutes === undefined
            ? []
            : [
                  sql`to_char(${botActionEvents.createdAt} - (${searchOffsetMinutes} * interval '1 minute'), 'YYYY-MM-DD HH24:MI:SS AM MM/DD/YYYY HH12:MI:SS AM')`,
              ]),
    ];
    const metadataFields = [botActionEvents.metadata];

    switch (scope) {
        case 'event':
            return eventFields;

        case 'actor':
            return actorFields;

        case 'channel':
            return channelFields;

        case 'message':
            return messageFields;

        case 'time':
            return timeFields;

        case 'metadata':
            return metadataFields;

        case 'all':
            return [
                ...eventFields,
                ...actorFields,
                ...channelFields,
                ...messageFields,
                ...timeFields,
                ...metadataFields,
            ];
    }
}

function normalizedFieldContains(field: BotActionEventSearchField, token: string) {
    return sql`regexp_replace(lower(coalesce(${field}::text, '')), '[^a-z0-9]+', '', 'g') like ${`%${token}%`}`;
}

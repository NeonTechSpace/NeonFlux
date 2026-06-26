import { asc, eq } from 'drizzle-orm';
import type { PgDatabase } from 'drizzle-orm/pg-core/db';
import type { PgQueryResultHKT } from 'drizzle-orm/pg-core/session';
import { err, ok, type Result } from 'neverthrow';

import type * as schema from './schema.js';
import { guilds } from './schema.js';

export type GuildRecord = {
    guildId: string;
    firstSeenAt: Date;
    updatedAt: Date;
};

export type GuildRepositoryError = 'missing-guild-id' | 'not-found' | 'database-error';

type GuildDatabase = PgDatabase<PgQueryResultHKT, typeof schema>;
type GuildRow = typeof guilds.$inferSelect;

export async function upsertGuild(
    db: GuildDatabase,
    input: { guildId: string }
): Promise<Result<GuildRecord, GuildRepositoryError>> {
    const guildIdResult = normalizeGuildId(input.guildId);

    if (guildIdResult.isErr()) {
        return err(guildIdResult.error);
    }

    const updatedAt = new Date();

    try {
        const rows = await db
            .insert(guilds)
            .values({
                guildId: guildIdResult.value,
                updatedAt,
            })
            .onConflictDoUpdate({
                target: guilds.guildId,
                set: {
                    updatedAt,
                },
            })
            .returning();
        const row = rows[0];

        return row ? ok(toGuildRecord(row)) : err('database-error');
    } catch {
        return err('database-error');
    }
}

export async function findGuildById(
    db: GuildDatabase,
    input: { guildId: string }
): Promise<Result<GuildRecord, GuildRepositoryError>> {
    const guildIdResult = normalizeGuildId(input.guildId);

    if (guildIdResult.isErr()) {
        return err(guildIdResult.error);
    }

    try {
        const rows = await db.select().from(guilds).where(eq(guilds.guildId, guildIdResult.value)).limit(1);
        const row = rows[0];

        return row ? ok(toGuildRecord(row)) : err('not-found');
    } catch {
        return err('database-error');
    }
}

export async function listGuildIds(db: GuildDatabase): Promise<Result<string[], GuildRepositoryError>> {
    try {
        const rows = await db.select({ guildId: guilds.guildId }).from(guilds).orderBy(asc(guilds.guildId));

        return ok(rows.map((row) => row.guildId));
    } catch {
        return err('database-error');
    }
}

function normalizeGuildId(guildId: string): Result<string, 'missing-guild-id'> {
    const normalizedGuildId = guildId.trim();

    return normalizedGuildId ? ok(normalizedGuildId) : err('missing-guild-id');
}

function toGuildRecord(row: GuildRow): GuildRecord {
    return {
        guildId: row.guildId,
        firstSeenAt: row.firstSeenAt,
        updatedAt: row.updatedAt,
    };
}

import { asc, eq } from 'drizzle-orm';
import type { PgDatabase } from 'drizzle-orm/pg-core/db';
import type { PgQueryResultHKT } from 'drizzle-orm/pg-core/session';
import { err, ok, type Result } from 'neverthrow';

import type * as schema from './schema.js';
import { botInstallations } from './schema.js';
import { upsertGuild } from './guilds.js';

export type BotInstallationRecord = {
    guildId: string;
    installedAt: Date;
    updatedAt: Date;
};

export type BotInstallationRepositoryError = 'missing-guild-id' | 'not-found' | 'database-error';

type BotInstallationDatabase = PgDatabase<PgQueryResultHKT, typeof schema>;
type BotInstallationRow = typeof botInstallations.$inferSelect;

export async function upsertBotInstallation(
    db: BotInstallationDatabase,
    input: { guildId: string }
): Promise<Result<BotInstallationRecord, BotInstallationRepositoryError>> {
    const guildIdResult = normalizeGuildId(input.guildId);

    if (guildIdResult.isErr()) {
        return err(guildIdResult.error);
    }

    const updatedAt = new Date();

    try {
        const guildResult = await upsertGuild(db, { guildId: guildIdResult.value });

        if (guildResult.isErr()) {
            return err('database-error');
        }

        const installations = await db
            .insert(botInstallations)
            .values({
                guildId: guildIdResult.value,
                updatedAt,
            })
            .onConflictDoUpdate({
                target: botInstallations.guildId,
                set: {
                    updatedAt,
                },
            })
            .returning();
        const installation = installations[0];

        if (!installation) {
            return err('database-error');
        }

        return ok(toBotInstallationRecord(installation));
    } catch {
        return err('database-error');
    }
}

export async function listBotInstallationGuildIds(
    db: BotInstallationDatabase
): Promise<Result<string[], BotInstallationRepositoryError>> {
    try {
        const installations = await db
            .select({ guildId: botInstallations.guildId })
            .from(botInstallations)
            .orderBy(asc(botInstallations.guildId));

        return ok(installations.map((installation) => installation.guildId));
    } catch {
        return err('database-error');
    }
}

export async function deleteBotInstallation(
    db: BotInstallationDatabase,
    input: { guildId: string }
): Promise<Result<BotInstallationRecord, BotInstallationRepositoryError>> {
    const guildIdResult = normalizeGuildId(input.guildId);

    if (guildIdResult.isErr()) {
        return err(guildIdResult.error);
    }

    try {
        const installations = await db
            .delete(botInstallations)
            .where(eq(botInstallations.guildId, guildIdResult.value))
            .returning();
        const installation = installations[0];

        if (!installation) {
            return err('not-found');
        }

        return ok(toBotInstallationRecord(installation));
    } catch {
        return err('database-error');
    }
}

function normalizeGuildId(guildId: string): Result<string, 'missing-guild-id'> {
    const normalizedGuildId = guildId.trim();

    if (normalizedGuildId.length === 0) {
        return err('missing-guild-id');
    }

    return ok(normalizedGuildId);
}

function toBotInstallationRecord(installation: BotInstallationRow): BotInstallationRecord {
    return {
        guildId: installation.guildId,
        installedAt: installation.installedAt,
        updatedAt: installation.updatedAt,
    };
}

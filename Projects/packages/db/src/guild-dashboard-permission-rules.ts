import { asc, eq, inArray } from 'drizzle-orm';
import type { PgDatabase } from 'drizzle-orm/pg-core/db';
import type { PgQueryResultHKT } from 'drizzle-orm/pg-core/session';
import { err, ok, type Result } from 'neverthrow';

import type * as schema from './schema.js';
import { guildDashboardPermissionRules } from './schema.js';

export type GuildDashboardPermissionRuleRecord = {
    guildId: string;
    userIds: string[];
    roleIds: string[];
    createdAt: Date;
    updatedAt: Date;
};

export type GuildDashboardPermissionRuleRepositoryError = 'missing-guild-id' | 'not-found' | 'database-error';

type GuildDashboardPermissionRuleDatabase = PgDatabase<PgQueryResultHKT, typeof schema>;
type GuildDashboardPermissionRuleRow = typeof guildDashboardPermissionRules.$inferSelect;

export async function upsertGuildDashboardPermissionRule(
    db: GuildDashboardPermissionRuleDatabase,
    input: {
        guildId: string;
        userIds?: readonly string[];
        roleIds?: readonly string[];
    }
): Promise<Result<GuildDashboardPermissionRuleRecord, GuildDashboardPermissionRuleRepositoryError>> {
    const guildIdResult = normalizeGuildId(input.guildId);

    if (guildIdResult.isErr()) {
        return err(guildIdResult.error);
    }

    const userIds = normalizeIds(input.userIds);
    const roleIds = normalizeIds(input.roleIds);
    const updatedAt = new Date();

    try {
        const rules = await db
            .insert(guildDashboardPermissionRules)
            .values({
                guildId: guildIdResult.value,
                userIds,
                roleIds,
                updatedAt,
            })
            .onConflictDoUpdate({
                target: guildDashboardPermissionRules.guildId,
                set: {
                    userIds,
                    roleIds,
                    updatedAt,
                },
            })
            .returning();
        const rule = rules[0];

        if (!rule) {
            return err('database-error');
        }

        return ok(toGuildDashboardPermissionRuleRecord(rule));
    } catch {
        return err('database-error');
    }
}

export async function findGuildDashboardPermissionRule(
    db: GuildDashboardPermissionRuleDatabase,
    input: { guildId: string }
): Promise<Result<GuildDashboardPermissionRuleRecord, GuildDashboardPermissionRuleRepositoryError>> {
    const guildIdResult = normalizeGuildId(input.guildId);

    if (guildIdResult.isErr()) {
        return err(guildIdResult.error);
    }

    try {
        const rules = await db
            .select()
            .from(guildDashboardPermissionRules)
            .where(eq(guildDashboardPermissionRules.guildId, guildIdResult.value))
            .limit(1);
        const rule = rules[0];

        if (!rule) {
            return err('not-found');
        }

        return ok(toGuildDashboardPermissionRuleRecord(rule));
    } catch {
        return err('database-error');
    }
}

export async function listGuildDashboardPermissionRulesByGuildIds(
    db: GuildDashboardPermissionRuleDatabase,
    input: { guildIds: readonly string[] }
): Promise<Result<GuildDashboardPermissionRuleRecord[], GuildDashboardPermissionRuleRepositoryError>> {
    const guildIds = normalizeIds(input.guildIds);

    if (guildIds.length === 0) {
        return ok([]);
    }

    try {
        const rules = await db
            .select()
            .from(guildDashboardPermissionRules)
            .where(inArray(guildDashboardPermissionRules.guildId, guildIds))
            .orderBy(asc(guildDashboardPermissionRules.guildId));

        return ok(rules.map(toGuildDashboardPermissionRuleRecord));
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

function normalizeIds(ids: readonly string[] | undefined): string[] {
    return ids?.map((id) => id.trim()).filter((id) => id.length > 0) ?? [];
}

function toGuildDashboardPermissionRuleRecord(
    rule: GuildDashboardPermissionRuleRow
): GuildDashboardPermissionRuleRecord {
    return {
        guildId: rule.guildId,
        userIds: normalizeIds(rule.userIds),
        roleIds: normalizeIds(rule.roleIds),
        createdAt: rule.createdAt,
        updatedAt: rule.updatedAt,
    };
}

import { and, asc, eq, inArray } from 'drizzle-orm';
import type { PgDatabase } from 'drizzle-orm/pg-core/db';
import type { PgQueryResultHKT } from 'drizzle-orm/pg-core/session';
import { err, ok, type Result } from 'neverthrow';

import type * as schema from './schema.js';
import { guildDefconExemptions, guildSecurityPolicies } from './schema.js';

export {
    findGuildDashboardPermissionRule,
    listGuildDashboardPermissionRulesByGuildIds,
    upsertGuildDashboardPermissionRule,
    type GuildDashboardPermissionRuleRecord,
} from './guild-dashboard-permission-rules.js';

export type GuildDefconLevel = 1 | 2 | 3;

export type GuildSecurityPolicyRecord = {
    guildId: string;
    defconLevel: GuildDefconLevel;
    createdAt: Date;
    updatedAt: Date;
};

export type GuildDefconExemptionRecord = {
    guildId: string;
    category: string;
    createdAt: Date;
};

export type GuildSecurityPolicyRepositoryError =
    | 'missing-guild-id'
    | 'invalid-defcon-level'
    | 'missing-category'
    | 'not-found'
    | 'database-error';

type GuildSecurityPolicyDatabase = PgDatabase<PgQueryResultHKT, typeof schema>;
type GuildSecurityPolicyRow = typeof guildSecurityPolicies.$inferSelect;
type GuildDefconExemptionRow = typeof guildDefconExemptions.$inferSelect;

export async function upsertGuildSecurityPolicy(
    db: GuildSecurityPolicyDatabase,
    input: { guildId: string; defconLevel: number }
): Promise<Result<GuildSecurityPolicyRecord, GuildSecurityPolicyRepositoryError>> {
    const guildIdResult = normalizeGuildId(input.guildId);

    if (guildIdResult.isErr()) {
        return err(guildIdResult.error);
    }

    const defconLevelResult = normalizeDefconLevel(input.defconLevel);

    if (defconLevelResult.isErr()) {
        return err(defconLevelResult.error);
    }

    const updatedAt = new Date();

    try {
        const policies = await db
            .insert(guildSecurityPolicies)
            .values({
                guildId: guildIdResult.value,
                defconLevel: defconLevelResult.value,
                updatedAt,
            })
            .onConflictDoUpdate({
                target: guildSecurityPolicies.guildId,
                set: {
                    defconLevel: defconLevelResult.value,
                    updatedAt,
                },
            })
            .returning();
        const policy = policies[0];

        if (!policy) {
            return err('database-error');
        }

        return toGuildSecurityPolicyRecord(policy);
    } catch {
        return err('database-error');
    }
}

export async function findGuildSecurityPolicyByGuildId(
    db: GuildSecurityPolicyDatabase,
    input: { guildId: string }
): Promise<Result<GuildSecurityPolicyRecord, GuildSecurityPolicyRepositoryError>> {
    const guildIdResult = normalizeGuildId(input.guildId);

    if (guildIdResult.isErr()) {
        return err(guildIdResult.error);
    }

    try {
        const policies = await db
            .select()
            .from(guildSecurityPolicies)
            .where(eq(guildSecurityPolicies.guildId, guildIdResult.value))
            .limit(1);
        const policy = policies[0];

        if (!policy) {
            return err('not-found');
        }

        return toGuildSecurityPolicyRecord(policy);
    } catch {
        return err('database-error');
    }
}

export async function listGuildSecurityPoliciesByGuildIds(
    db: GuildSecurityPolicyDatabase,
    input: { guildIds: readonly string[] }
): Promise<Result<GuildSecurityPolicyRecord[], GuildSecurityPolicyRepositoryError>> {
    const guildIds = normalizeIds(input.guildIds);

    if (guildIds.length === 0) {
        return ok([]);
    }

    try {
        const policies = await db
            .select()
            .from(guildSecurityPolicies)
            .where(inArray(guildSecurityPolicies.guildId, guildIds))
            .orderBy(asc(guildSecurityPolicies.guildId));
        const records: GuildSecurityPolicyRecord[] = [];

        for (const policy of policies) {
            const record = toGuildSecurityPolicyRecord(policy);

            if (record.isErr()) {
                return err(record.error);
            }

            records.push(record.value);
        }

        return ok(records);
    } catch {
        return err('database-error');
    }
}

export async function upsertGuildDefconExemption(
    db: GuildSecurityPolicyDatabase,
    input: { guildId: string; category: string }
): Promise<Result<GuildDefconExemptionRecord, GuildSecurityPolicyRepositoryError>> {
    const normalizedInput = normalizeRuleLookupInput(input);

    if (normalizedInput.isErr()) {
        return err(normalizedInput.error);
    }

    try {
        const exemptions = await db
            .insert(guildDefconExemptions)
            .values({
                guildId: normalizedInput.value.guildId,
                category: normalizedInput.value.category,
            })
            .onConflictDoNothing({
                target: [guildDefconExemptions.guildId, guildDefconExemptions.category],
            })
            .returning();
        const exemption = exemptions[0];

        if (exemption) {
            return ok(toGuildDefconExemptionRecord(exemption));
        }

        const existingExemption = await findGuildDefconExemption(db, normalizedInput.value);

        if (existingExemption.isErr()) {
            return err(existingExemption.error);
        }

        return ok(existingExemption.value);
    } catch {
        return err('database-error');
    }
}

export async function listGuildDefconExemptionCategories(
    db: GuildSecurityPolicyDatabase,
    input: { guildId: string }
): Promise<Result<string[], GuildSecurityPolicyRepositoryError>> {
    const guildIdResult = normalizeGuildId(input.guildId);

    if (guildIdResult.isErr()) {
        return err(guildIdResult.error);
    }

    try {
        const exemptions = await db
            .select({ category: guildDefconExemptions.category })
            .from(guildDefconExemptions)
            .where(eq(guildDefconExemptions.guildId, guildIdResult.value))
            .orderBy(asc(guildDefconExemptions.category));

        return ok(exemptions.map((exemption) => exemption.category));
    } catch {
        return err('database-error');
    }
}

export async function deleteGuildDefconExemption(
    db: GuildSecurityPolicyDatabase,
    input: { guildId: string; category: string }
): Promise<Result<GuildDefconExemptionRecord, GuildSecurityPolicyRepositoryError>> {
    const normalizedInput = normalizeRuleLookupInput(input);

    if (normalizedInput.isErr()) {
        return err(normalizedInput.error);
    }

    try {
        const exemptions = await db
            .delete(guildDefconExemptions)
            .where(
                and(
                    eq(guildDefconExemptions.guildId, normalizedInput.value.guildId),
                    eq(guildDefconExemptions.category, normalizedInput.value.category)
                )
            )
            .returning();
        const exemption = exemptions[0];

        if (!exemption) {
            return err('not-found');
        }

        return ok(toGuildDefconExemptionRecord(exemption));
    } catch {
        return err('database-error');
    }
}

async function findGuildDefconExemption(
    db: GuildSecurityPolicyDatabase,
    input: { guildId: string; category: string }
): Promise<Result<GuildDefconExemptionRecord, GuildSecurityPolicyRepositoryError>> {
    try {
        const exemptions = await db
            .select()
            .from(guildDefconExemptions)
            .where(
                and(
                    eq(guildDefconExemptions.guildId, input.guildId),
                    eq(guildDefconExemptions.category, input.category)
                )
            )
            .limit(1);
        const exemption = exemptions[0];

        if (!exemption) {
            return err('not-found');
        }

        return ok(toGuildDefconExemptionRecord(exemption));
    } catch {
        return err('database-error');
    }
}

function normalizeRuleLookupInput(input: {
    guildId: string;
    category: string;
}): Result<{ guildId: string; category: string }, GuildSecurityPolicyRepositoryError> {
    const guildIdResult = normalizeGuildId(input.guildId);

    if (guildIdResult.isErr()) {
        return err(guildIdResult.error);
    }

    const categoryResult = normalizeCategory(input.category);

    if (categoryResult.isErr()) {
        return err(categoryResult.error);
    }

    return ok({
        guildId: guildIdResult.value,
        category: categoryResult.value,
    });
}

function normalizeGuildId(guildId: string): Result<string, 'missing-guild-id'> {
    const normalizedGuildId = guildId.trim();

    if (normalizedGuildId.length === 0) {
        return err('missing-guild-id');
    }

    return ok(normalizedGuildId);
}

function normalizeCategory(category: string): Result<string, 'missing-category'> {
    const normalizedCategory = category.trim();

    if (normalizedCategory.length === 0) {
        return err('missing-category');
    }

    return ok(normalizedCategory);
}

function normalizeDefconLevel(defconLevel: number): Result<GuildDefconLevel, 'invalid-defcon-level'> {
    switch (defconLevel) {
        case 1:
        case 2:
        case 3:
            return ok(defconLevel);

        default:
            return err('invalid-defcon-level');
    }
}

function normalizeIds(ids: readonly string[] | undefined): string[] {
    return ids?.map((id) => id.trim()).filter((id) => id.length > 0) ?? [];
}

function toGuildSecurityPolicyRecord(
    policy: GuildSecurityPolicyRow
): Result<GuildSecurityPolicyRecord, GuildSecurityPolicyRepositoryError> {
    const defconLevelResult = normalizeDefconLevel(policy.defconLevel);

    if (defconLevelResult.isErr()) {
        return err('database-error');
    }

    return ok({
        guildId: policy.guildId,
        defconLevel: defconLevelResult.value,
        createdAt: policy.createdAt,
        updatedAt: policy.updatedAt,
    });
}

function toGuildDefconExemptionRecord(exemption: GuildDefconExemptionRow): GuildDefconExemptionRecord {
    return {
        guildId: exemption.guildId,
        category: exemption.category,
        createdAt: exemption.createdAt,
    };
}

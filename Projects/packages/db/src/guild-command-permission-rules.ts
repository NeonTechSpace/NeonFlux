import { and, asc, eq } from 'drizzle-orm';
import type { PgDatabase } from 'drizzle-orm/pg-core/db';
import type { PgQueryResultHKT } from 'drizzle-orm/pg-core/session';
import { err, ok, type Result } from 'neverthrow';

import type * as schema from './schema.js';
import { guildCommandPermissionRules } from './schema.js';

export type GuildCommandPermissionRuleTargetType = 'category' | 'command';

export type GuildCommandPermissionRuleRecord = {
    guildId: string;
    targetType: GuildCommandPermissionRuleTargetType;
    targetId: string;
    userIds: string[];
    roleIds: string[];
    createdAt: Date;
    updatedAt: Date;
};

export type GuildCommandPermissionRuleRepositoryError =
    | 'missing-guild-id'
    | 'invalid-target-type'
    | 'missing-target-id'
    | 'not-found'
    | 'database-error';

type GuildCommandPermissionRuleDatabase = PgDatabase<PgQueryResultHKT, typeof schema>;
type GuildCommandPermissionRuleRow = typeof guildCommandPermissionRules.$inferSelect;

export async function upsertGuildCommandPermissionRule(
    db: GuildCommandPermissionRuleDatabase,
    input: {
        guildId: string;
        targetType: GuildCommandPermissionRuleTargetType;
        targetId: string;
        userIds?: readonly string[];
        roleIds?: readonly string[];
    }
): Promise<Result<GuildCommandPermissionRuleRecord, GuildCommandPermissionRuleRepositoryError>> {
    const normalizedInput = normalizePermissionRuleInput(input);

    if (normalizedInput.isErr()) {
        return err(normalizedInput.error);
    }

    const updatedAt = new Date();

    try {
        const rules = await db
            .insert(guildCommandPermissionRules)
            .values({
                guildId: normalizedInput.value.guildId,
                targetType: normalizedInput.value.targetType,
                targetId: normalizedInput.value.targetId,
                userIds: normalizedInput.value.userIds,
                roleIds: normalizedInput.value.roleIds,
                updatedAt,
            })
            .onConflictDoUpdate({
                target: [
                    guildCommandPermissionRules.guildId,
                    guildCommandPermissionRules.targetType,
                    guildCommandPermissionRules.targetId,
                ],
                set: {
                    userIds: normalizedInput.value.userIds,
                    roleIds: normalizedInput.value.roleIds,
                    updatedAt,
                },
            })
            .returning();
        const rule = rules[0];

        if (!rule) {
            return err('database-error');
        }

        return ok(toGuildCommandPermissionRuleRecord(rule));
    } catch {
        return err('database-error');
    }
}

export async function findGuildCommandPermissionRule(
    db: GuildCommandPermissionRuleDatabase,
    input: { guildId: string; targetType: GuildCommandPermissionRuleTargetType; targetId: string }
): Promise<Result<GuildCommandPermissionRuleRecord, GuildCommandPermissionRuleRepositoryError>> {
    const normalizedInput = normalizeRuleLookupInput(input);

    if (normalizedInput.isErr()) {
        return err(normalizedInput.error);
    }

    try {
        const rules = await db
            .select()
            .from(guildCommandPermissionRules)
            .where(
                and(
                    eq(guildCommandPermissionRules.guildId, normalizedInput.value.guildId),
                    eq(guildCommandPermissionRules.targetType, normalizedInput.value.targetType),
                    eq(guildCommandPermissionRules.targetId, normalizedInput.value.targetId)
                )
            )
            .limit(1);
        const rule = rules[0];

        if (!rule) {
            return err('not-found');
        }

        return ok(toGuildCommandPermissionRuleRecord(rule));
    } catch {
        return err('database-error');
    }
}

export async function listGuildCommandPermissionRulesByGuildId(
    db: GuildCommandPermissionRuleDatabase,
    input: { guildId: string }
): Promise<Result<GuildCommandPermissionRuleRecord[], GuildCommandPermissionRuleRepositoryError>> {
    const guildIdResult = normalizeGuildId(input.guildId);

    if (guildIdResult.isErr()) {
        return err(guildIdResult.error);
    }

    try {
        const rules = await db
            .select()
            .from(guildCommandPermissionRules)
            .where(eq(guildCommandPermissionRules.guildId, guildIdResult.value))
            .orderBy(asc(guildCommandPermissionRules.targetType), asc(guildCommandPermissionRules.targetId));

        return ok(rules.map(toGuildCommandPermissionRuleRecord));
    } catch {
        return err('database-error');
    }
}

export async function deleteGuildCommandPermissionRule(
    db: GuildCommandPermissionRuleDatabase,
    input: { guildId: string; targetType: GuildCommandPermissionRuleTargetType; targetId: string }
): Promise<Result<GuildCommandPermissionRuleRecord, GuildCommandPermissionRuleRepositoryError>> {
    const normalizedInput = normalizeRuleLookupInput(input);

    if (normalizedInput.isErr()) {
        return err(normalizedInput.error);
    }

    try {
        const rules = await db
            .delete(guildCommandPermissionRules)
            .where(
                and(
                    eq(guildCommandPermissionRules.guildId, normalizedInput.value.guildId),
                    eq(guildCommandPermissionRules.targetType, normalizedInput.value.targetType),
                    eq(guildCommandPermissionRules.targetId, normalizedInput.value.targetId)
                )
            )
            .returning();
        const rule = rules[0];

        if (!rule) {
            return err('not-found');
        }

        return ok(toGuildCommandPermissionRuleRecord(rule));
    } catch {
        return err('database-error');
    }
}

type NormalizedPermissionRuleInput = {
    guildId: string;
    targetType: GuildCommandPermissionRuleTargetType;
    targetId: string;
    userIds: string[];
    roleIds: string[];
};

function normalizePermissionRuleInput(input: {
    guildId: string;
    targetType: GuildCommandPermissionRuleTargetType;
    targetId: string;
    userIds?: readonly string[];
    roleIds?: readonly string[];
}): Result<NormalizedPermissionRuleInput, GuildCommandPermissionRuleRepositoryError> {
    const lookupInputResult = normalizeRuleLookupInput(input);

    if (lookupInputResult.isErr()) {
        return err(lookupInputResult.error);
    }

    return ok({
        ...lookupInputResult.value,
        userIds: normalizeIds(input.userIds),
        roleIds: normalizeIds(input.roleIds),
    });
}

function normalizeRuleLookupInput(input: {
    guildId: string;
    targetType: GuildCommandPermissionRuleTargetType;
    targetId: string;
}): Result<
    { guildId: string; targetType: GuildCommandPermissionRuleTargetType; targetId: string },
    GuildCommandPermissionRuleRepositoryError
> {
    const guildIdResult = normalizeGuildId(input.guildId);

    if (guildIdResult.isErr()) {
        return err(guildIdResult.error);
    }

    const targetTypeResult = normalizeTargetType(input.targetType);

    if (targetTypeResult.isErr()) {
        return err(targetTypeResult.error);
    }

    const targetIdResult = normalizeTargetId(input.targetId);

    if (targetIdResult.isErr()) {
        return err(targetIdResult.error);
    }

    return ok({
        guildId: guildIdResult.value,
        targetType: targetTypeResult.value,
        targetId: targetIdResult.value,
    });
}

function normalizeGuildId(guildId: string): Result<string, 'missing-guild-id'> {
    const normalizedGuildId = guildId.trim();

    if (normalizedGuildId.length === 0) {
        return err('missing-guild-id');
    }

    return ok(normalizedGuildId);
}

function normalizeTargetType(targetType: string): Result<GuildCommandPermissionRuleTargetType, 'invalid-target-type'> {
    if (targetType === 'category' || targetType === 'command') {
        return ok(targetType);
    }

    return err('invalid-target-type');
}

function normalizeTargetId(targetId: string): Result<string, 'missing-target-id'> {
    const normalizedTargetId = targetId.trim();

    if (normalizedTargetId.length === 0) {
        return err('missing-target-id');
    }

    return ok(normalizedTargetId);
}

function normalizeIds(ids: readonly string[] | undefined): string[] {
    return ids?.map((id) => id.trim()).filter((id) => id.length > 0) ?? [];
}

function toGuildCommandPermissionRuleRecord(rule: GuildCommandPermissionRuleRow): GuildCommandPermissionRuleRecord {
    return {
        guildId: rule.guildId,
        targetType: toKnownTargetType(rule.targetType),
        targetId: rule.targetId,
        userIds: normalizeIds(rule.userIds),
        roleIds: normalizeIds(rule.roleIds),
        createdAt: rule.createdAt,
        updatedAt: rule.updatedAt,
    };
}

function toKnownTargetType(targetType: string): GuildCommandPermissionRuleTargetType {
    if (targetType === 'category' || targetType === 'command') {
        return targetType;
    }

    throw new Error(`Invalid command permission rule target type: ${targetType}`);
}

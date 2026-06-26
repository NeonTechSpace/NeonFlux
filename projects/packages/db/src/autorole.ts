import { asc, eq } from 'drizzle-orm';
import { err, ok, type Result } from 'neverthrow';

import {
    normalizeOptionalText,
    normalizeRequiredText,
    type GuildFeatureRepositoryDatabase,
    type GuildFeatureRepositoryError,
} from './feature-repository-types.js';
import { autoroleRules } from './schema.js';

export type AutoroleRuleRecord = typeof autoroleRules.$inferSelect;
export type AutoroleRepositoryError = GuildFeatureRepositoryError;

export async function upsertAutoroleRule(
    db: GuildFeatureRepositoryDatabase,
    input: {
        guildId: string;
        roleId: string;
        name?: string;
        enabled?: boolean;
    }
): Promise<Result<AutoroleRuleRecord, AutoroleRepositoryError>> {
    const guildId = normalizeRequiredText(input.guildId, 'guildId');
    const roleId = normalizeRequiredText(input.roleId, 'roleId');
    const updatedAt = new Date();

    if (guildId.isErr()) return err(guildId.error);
    if (roleId.isErr()) return err(roleId.error);

    try {
        const rows = await db
            .insert(autoroleRules)
            .values({
                guildId: guildId.value,
                roleId: roleId.value,
                name: normalizeOptionalText(input.name),
                enabled: input.enabled ?? true,
                updatedAt,
            })
            .onConflictDoUpdate({
                target: [autoroleRules.guildId, autoroleRules.roleId],
                set: {
                    name: normalizeOptionalText(input.name),
                    enabled: input.enabled ?? true,
                    updatedAt,
                },
            })
            .returning();
        const row = rows[0];

        return row ? ok(row) : err({ type: 'database-error' });
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function listAutoroleRulesByGuildId(
    db: GuildFeatureRepositoryDatabase,
    input: { guildId: string }
): Promise<Result<AutoroleRuleRecord[], AutoroleRepositoryError>> {
    const guildId = normalizeRequiredText(input.guildId, 'guildId');

    if (guildId.isErr()) return err(guildId.error);

    try {
        const rows = await db
            .select()
            .from(autoroleRules)
            .where(eq(autoroleRules.guildId, guildId.value))
            .orderBy(asc(autoroleRules.roleId));

        return ok(rows);
    } catch {
        return err({ type: 'database-error' });
    }
}

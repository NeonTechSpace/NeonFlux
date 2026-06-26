import { eq } from 'drizzle-orm';
import { err, ok, type Result } from 'neverthrow';

import {
    normalizeOptionalText,
    normalizeRequiredText,
    type GuildFeatureRepositoryDatabase,
    type GuildFeatureRepositoryError,
} from './feature-repository-types.js';
import { generatedVoiceChannels, vcGeneratorRules } from './schema.js';

export type VcGeneratorRuleRecord = typeof vcGeneratorRules.$inferSelect;
export type GeneratedVoiceChannelRecord = typeof generatedVoiceChannels.$inferSelect;
export type VcGeneratorRepositoryError = GuildFeatureRepositoryError;

export async function upsertVcGeneratorRule(
    db: GuildFeatureRepositoryDatabase,
    input: {
        guildId: string;
        sourceChannelId: string;
        nameTemplate: string;
        categoryId?: string;
        enabled?: boolean;
        config?: Record<string, unknown>;
    }
): Promise<Result<VcGeneratorRuleRecord, VcGeneratorRepositoryError>> {
    const guildId = normalizeRequiredText(input.guildId, 'guildId');
    const sourceChannelId = normalizeRequiredText(input.sourceChannelId, 'sourceChannelId');
    const nameTemplate = normalizeRequiredText(input.nameTemplate, 'nameTemplate');
    const updatedAt = new Date();

    if (guildId.isErr()) return err(guildId.error);
    if (sourceChannelId.isErr()) return err(sourceChannelId.error);
    if (nameTemplate.isErr()) return err(nameTemplate.error);

    try {
        const rows = await db
            .insert(vcGeneratorRules)
            .values({
                guildId: guildId.value,
                sourceChannelId: sourceChannelId.value,
                nameTemplate: nameTemplate.value,
                categoryId: normalizeOptionalText(input.categoryId),
                enabled: input.enabled ?? true,
                config: input.config ?? {},
                updatedAt,
            })
            .onConflictDoUpdate({
                target: [vcGeneratorRules.guildId, vcGeneratorRules.sourceChannelId],
                set: {
                    nameTemplate: nameTemplate.value,
                    categoryId: normalizeOptionalText(input.categoryId),
                    enabled: input.enabled ?? true,
                    config: input.config ?? {},
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

export async function upsertGeneratedVoiceChannel(
    db: GuildFeatureRepositoryDatabase,
    input: {
        guildId: string;
        channelId: string;
        ruleId?: string;
        ownerUserId?: string;
        status?: string;
    }
): Promise<Result<GeneratedVoiceChannelRecord, VcGeneratorRepositoryError>> {
    const guildId = normalizeRequiredText(input.guildId, 'guildId');
    const channelId = normalizeRequiredText(input.channelId, 'channelId');
    const updatedAt = new Date();

    if (guildId.isErr()) return err(guildId.error);
    if (channelId.isErr()) return err(channelId.error);

    try {
        const rows = await db
            .insert(generatedVoiceChannels)
            .values({
                guildId: guildId.value,
                channelId: channelId.value,
                ruleId: normalizeOptionalText(input.ruleId),
                ownerUserId: normalizeOptionalText(input.ownerUserId),
                status: normalizeOptionalText(input.status) ?? 'active',
                updatedAt,
                lastSeenAt: updatedAt,
            })
            .onConflictDoUpdate({
                target: generatedVoiceChannels.channelId,
                set: {
                    ownerUserId: normalizeOptionalText(input.ownerUserId),
                    status: normalizeOptionalText(input.status) ?? 'active',
                    updatedAt,
                    lastSeenAt: updatedAt,
                },
            })
            .returning();
        const row = rows[0];

        return row ? ok(row) : err({ type: 'database-error' });
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function findGeneratedVoiceChannelByChannelId(
    db: GuildFeatureRepositoryDatabase,
    input: { channelId: string }
): Promise<Result<GeneratedVoiceChannelRecord, VcGeneratorRepositoryError>> {
    const channelId = normalizeRequiredText(input.channelId, 'channelId');

    if (channelId.isErr()) return err(channelId.error);

    try {
        const rows = await db
            .select()
            .from(generatedVoiceChannels)
            .where(eq(generatedVoiceChannels.channelId, channelId.value))
            .limit(1);
        const row = rows[0];

        return row ? ok(row) : err({ type: 'not-found' });
    } catch {
        return err({ type: 'database-error' });
    }
}

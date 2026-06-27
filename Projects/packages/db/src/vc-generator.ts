import { and, eq } from 'drizzle-orm';
import { err, ok, type Result } from 'neverthrow';

import {
    normalizeNonNegativeInteger,
    normalizeOptionalText,
    normalizeRequiredText,
    type GuildFeatureRepositoryDatabase,
    type GuildFeatureRepositoryError,
} from './feature-repository-types.js';
import { generatedVoiceChannels, vcGeneratorControlPanels, vcGeneratorRules } from './schema.js';

export type VcGeneratorRuleRecord = typeof vcGeneratorRules.$inferSelect;
export type GeneratedVoiceChannelRecord = typeof generatedVoiceChannels.$inferSelect;
export type VcGeneratorControlPanelRecord = typeof vcGeneratorControlPanels.$inferSelect;
export type VcGeneratorRepositoryError = GuildFeatureRepositoryError;
export type GeneratedVoiceChannelStatus = 'active' | 'deleted' | 'orphaned';
export type VcGeneratorControlPanelStatus = 'active' | 'stale' | 'disabled';
export type VcGeneratorControlMode = 'reaction';

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
                    ruleId: normalizeOptionalText(input.ruleId),
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

export async function listVcGeneratorRulesByGuildId(
    db: GuildFeatureRepositoryDatabase,
    input: { guildId: string; enabledOnly?: boolean }
): Promise<Result<VcGeneratorRuleRecord[], VcGeneratorRepositoryError>> {
    const guildId = normalizeRequiredText(input.guildId, 'guildId');

    if (guildId.isErr()) return err(guildId.error);

    try {
        const rows = await db
            .select()
            .from(vcGeneratorRules)
            .where(
                input.enabledOnly
                    ? and(eq(vcGeneratorRules.guildId, guildId.value), eq(vcGeneratorRules.enabled, true))
                    : eq(vcGeneratorRules.guildId, guildId.value)
            )
            .orderBy(vcGeneratorRules.createdAt);

        return ok(rows);
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function findVcGeneratorRuleBySourceChannelId(
    db: GuildFeatureRepositoryDatabase,
    input: { guildId: string; sourceChannelId: string; enabledOnly?: boolean }
): Promise<Result<VcGeneratorRuleRecord, VcGeneratorRepositoryError>> {
    const guildId = normalizeRequiredText(input.guildId, 'guildId');
    const sourceChannelId = normalizeRequiredText(input.sourceChannelId, 'sourceChannelId');

    if (guildId.isErr()) return err(guildId.error);
    if (sourceChannelId.isErr()) return err(sourceChannelId.error);

    try {
        const rows = await db
            .select()
            .from(vcGeneratorRules)
            .where(
                and(
                    eq(vcGeneratorRules.guildId, guildId.value),
                    eq(vcGeneratorRules.sourceChannelId, sourceChannelId.value),
                    ...(input.enabledOnly ? [eq(vcGeneratorRules.enabled, true)] : [])
                )
            )
            .limit(1);
        const row = rows[0];

        return row ? ok(row) : err({ type: 'not-found' });
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function deleteVcGeneratorRule(
    db: GuildFeatureRepositoryDatabase,
    input: { guildId: string; sourceChannelId: string }
): Promise<Result<VcGeneratorRuleRecord, VcGeneratorRepositoryError>> {
    const guildId = normalizeRequiredText(input.guildId, 'guildId');
    const sourceChannelId = normalizeRequiredText(input.sourceChannelId, 'sourceChannelId');

    if (guildId.isErr()) return err(guildId.error);
    if (sourceChannelId.isErr()) return err(sourceChannelId.error);

    try {
        const rows = await db
            .delete(vcGeneratorRules)
            .where(
                and(
                    eq(vcGeneratorRules.guildId, guildId.value),
                    eq(vcGeneratorRules.sourceChannelId, sourceChannelId.value)
                )
            )
            .returning();
        const row = rows[0];

        return row ? ok(row) : err({ type: 'not-found' });
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

export async function listGeneratedVoiceChannelsByGuildId(
    db: GuildFeatureRepositoryDatabase,
    input: { guildId: string; ruleId?: string; status?: string }
): Promise<Result<GeneratedVoiceChannelRecord[], VcGeneratorRepositoryError>> {
    const guildId = normalizeRequiredText(input.guildId, 'guildId');

    if (guildId.isErr()) return err(guildId.error);
    if (input.status && !isGeneratedVoiceChannelStatus(input.status)) {
        return err({ type: 'invalid-value', field: 'status' });
    }

    try {
        const rows = await db
            .select()
            .from(generatedVoiceChannels)
            .where(
                and(
                    eq(generatedVoiceChannels.guildId, guildId.value),
                    ...(input.ruleId ? [eq(generatedVoiceChannels.ruleId, input.ruleId)] : []),
                    ...(input.status ? [eq(generatedVoiceChannels.status, input.status)] : [])
                )
            )
            .orderBy(generatedVoiceChannels.createdAt);

        return ok(rows);
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function updateGeneratedVoiceChannelStatus(
    db: GuildFeatureRepositoryDatabase,
    input: { guildId: string; channelId: string; status: string }
): Promise<Result<GeneratedVoiceChannelRecord, VcGeneratorRepositoryError>> {
    const guildId = normalizeRequiredText(input.guildId, 'guildId');
    const channelId = normalizeRequiredText(input.channelId, 'channelId');
    const updatedAt = new Date();

    if (guildId.isErr()) return err(guildId.error);
    if (channelId.isErr()) return err(channelId.error);
    if (!isGeneratedVoiceChannelStatus(input.status)) {
        return err({ type: 'invalid-value', field: 'status' });
    }

    try {
        const rows = await db
            .update(generatedVoiceChannels)
            .set({
                status: input.status,
                updatedAt,
                lastSeenAt: updatedAt,
            })
            .where(
                and(
                    eq(generatedVoiceChannels.guildId, guildId.value),
                    eq(generatedVoiceChannels.channelId, channelId.value)
                )
            )
            .returning();
        const row = rows[0];

        return row ? ok(row) : err({ type: 'not-found' });
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function upsertVcGeneratorControlPanel(
    db: GuildFeatureRepositoryDatabase,
    input: {
        guildId: string;
        ruleId: string;
        channelId: string;
        messageId?: string;
        controlMode?: string;
        status?: string;
        config?: Record<string, unknown>;
        synced?: boolean;
    }
): Promise<Result<VcGeneratorControlPanelRecord, VcGeneratorRepositoryError>> {
    const guildId = normalizeRequiredText(input.guildId, 'guildId');
    const ruleId = normalizeRequiredText(input.ruleId, 'ruleId');
    const channelId = normalizeRequiredText(input.channelId, 'channelId');
    const updatedAt = new Date();
    const status = input.status ?? 'active';
    const controlMode = input.controlMode ?? 'reaction';

    if (guildId.isErr()) return err(guildId.error);
    if (ruleId.isErr()) return err(ruleId.error);
    if (channelId.isErr()) return err(channelId.error);
    if (!isControlPanelStatus(status)) return err({ type: 'invalid-value', field: 'status' });
    if (controlMode !== 'reaction') return err({ type: 'invalid-value', field: 'controlMode' });

    try {
        const rows = await db
            .insert(vcGeneratorControlPanels)
            .values({
                guildId: guildId.value,
                ruleId: ruleId.value,
                channelId: channelId.value,
                messageId: normalizeOptionalText(input.messageId),
                controlMode,
                status,
                config: input.config ?? {},
                updatedAt,
                ...(input.synced ? { lastSyncedAt: updatedAt } : {}),
                ...(status === 'stale' ? { staleAt: updatedAt } : { staleAt: null }),
            })
            .onConflictDoUpdate({
                target: [vcGeneratorControlPanels.guildId, vcGeneratorControlPanels.ruleId],
                set: {
                    channelId: channelId.value,
                    messageId: normalizeOptionalText(input.messageId),
                    controlMode,
                    status,
                    config: input.config ?? {},
                    updatedAt,
                    ...(input.synced ? { lastSyncedAt: updatedAt } : {}),
                    ...(status === 'stale' ? { staleAt: updatedAt } : { staleAt: null }),
                },
            })
            .returning();
        const row = rows[0];

        return row ? ok(row) : err({ type: 'database-error' });
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function findVcGeneratorControlPanelByMessageId(
    db: GuildFeatureRepositoryDatabase,
    input: { guildId: string; messageId: string }
): Promise<Result<VcGeneratorControlPanelRecord, VcGeneratorRepositoryError>> {
    const guildId = normalizeRequiredText(input.guildId, 'guildId');
    const messageId = normalizeRequiredText(input.messageId, 'messageId');

    if (guildId.isErr()) return err(guildId.error);
    if (messageId.isErr()) return err(messageId.error);

    try {
        const rows = await db
            .select()
            .from(vcGeneratorControlPanels)
            .where(
                and(
                    eq(vcGeneratorControlPanels.guildId, guildId.value),
                    eq(vcGeneratorControlPanels.messageId, messageId.value)
                )
            )
            .limit(1);
        const row = rows[0];

        return row ? ok(row) : err({ type: 'not-found' });
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function findVcGeneratorControlPanelByRuleId(
    db: GuildFeatureRepositoryDatabase,
    input: { guildId: string; ruleId: string }
): Promise<Result<VcGeneratorControlPanelRecord, VcGeneratorRepositoryError>> {
    const guildId = normalizeRequiredText(input.guildId, 'guildId');
    const ruleId = normalizeRequiredText(input.ruleId, 'ruleId');

    if (guildId.isErr()) return err(guildId.error);
    if (ruleId.isErr()) return err(ruleId.error);

    try {
        const rows = await db
            .select()
            .from(vcGeneratorControlPanels)
            .where(
                and(
                    eq(vcGeneratorControlPanels.guildId, guildId.value),
                    eq(vcGeneratorControlPanels.ruleId, ruleId.value)
                )
            )
            .limit(1);
        const row = rows[0];

        return row ? ok(row) : err({ type: 'not-found' });
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function listVcGeneratorControlPanelsByGuildId(
    db: GuildFeatureRepositoryDatabase,
    input: { guildId: string; status?: string; limit?: number }
): Promise<Result<VcGeneratorControlPanelRecord[], VcGeneratorRepositoryError>> {
    const guildId = normalizeRequiredText(input.guildId, 'guildId');
    const limit = normalizeNonNegativeInteger(input.limit ?? 100, 'limit');

    if (guildId.isErr()) return err(guildId.error);
    if (limit.isErr()) return err(limit.error);
    if (input.status && !isControlPanelStatus(input.status)) return err({ type: 'invalid-value', field: 'status' });

    try {
        const rows = await db
            .select()
            .from(vcGeneratorControlPanels)
            .where(
                input.status
                    ? and(
                          eq(vcGeneratorControlPanels.guildId, guildId.value),
                          eq(vcGeneratorControlPanels.status, input.status)
                      )
                    : eq(vcGeneratorControlPanels.guildId, guildId.value)
            )
            .orderBy(vcGeneratorControlPanels.createdAt)
            .limit(limit.value);

        return ok(rows);
    } catch {
        return err({ type: 'database-error' });
    }
}

function isControlPanelStatus(status: string): status is VcGeneratorControlPanelStatus {
    return status === 'active' || status === 'stale' || status === 'disabled';
}

function isGeneratedVoiceChannelStatus(status: string): status is GeneratedVoiceChannelStatus {
    return status === 'active' || status === 'deleted' || status === 'orphaned';
}

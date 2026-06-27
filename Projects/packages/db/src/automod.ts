import { and, desc, eq } from 'drizzle-orm';
import { err, ok, type Result } from 'neverthrow';

import {
    normalizeOptionalText,
    normalizeRequiredText,
    type GuildFeatureRepositoryDatabase,
    type GuildFeatureRepositoryError,
} from './feature-repository-types.js';
import { automodEvents, automodRules } from './schema.js';

export const automodTriggerTypes = ['blocked_terms', 'invite_links'] as const;
export type AutomodTriggerType = (typeof automodTriggerTypes)[number];

export const automodActionTypes = ['record', 'delete_message', 'timeout', 'warn'] as const;
export type AutomodActionType = (typeof automodActionTypes)[number];

export type AutomodRuleConfig = {
    terms?: string[];
    timeoutDurationSeconds?: number;
    ignoredChannelIds?: string[];
    ignoredRoleIds?: string[];
    ignoredUserIds?: string[];
};

export type AutomodRuleRecord = Omit<typeof automodRules.$inferSelect, 'triggerType' | 'actionType' | 'config'> & {
    triggerType: AutomodTriggerType;
    actionType: AutomodActionType;
    config: AutomodRuleConfig;
};

export type AutomodEventRecord = Omit<typeof automodEvents.$inferSelect, 'triggerType' | 'actionType' | 'details'> & {
    triggerType: AutomodTriggerType;
    actionType: AutomodActionType;
    details: Record<string, unknown>;
};

export type SaveAutomodRuleInput = {
    guildId: string;
    ruleId?: string;
    name: string;
    triggerType: string;
    actionType?: string;
    enabled?: boolean;
    config?: Record<string, unknown>;
};

export type RecordAutomodEventInput = {
    guildId: string;
    ruleId?: string | null;
    messageId: string;
    channelId: string;
    authorUserId: string;
    triggerType: string;
    actionType?: string;
    status?: string;
    details?: Record<string, unknown>;
};

export type UpdateAutomodEventStatusInput = {
    eventId: string;
    status: string;
    details?: Record<string, unknown>;
};

export type AutomodRepositoryError = GuildFeatureRepositoryError | { type: 'invalid-config' };

export async function listAutomodRulesByGuildId(
    db: GuildFeatureRepositoryDatabase,
    input: { guildId: string }
): Promise<Result<AutomodRuleRecord[], AutomodRepositoryError>> {
    return listAutomodRules(db, input);
}

export async function listEnabledAutomodRulesByGuildId(
    db: GuildFeatureRepositoryDatabase,
    input: { guildId: string }
): Promise<Result<AutomodRuleRecord[], AutomodRepositoryError>> {
    return listAutomodRules(db, { ...input, enabled: true });
}

export async function saveAutomodRule(
    db: GuildFeatureRepositoryDatabase,
    input: SaveAutomodRuleInput
): Promise<Result<AutomodRuleRecord, AutomodRepositoryError>> {
    const normalized = normalizeAutomodRuleInput(input);

    if (normalized.isErr()) {
        return err(normalized.error);
    }

    const updatedAt = new Date();

    try {
        const rows = normalized.value.ruleId
            ? await db
                  .update(automodRules)
                  .set({
                      name: normalized.value.name,
                      triggerType: normalized.value.triggerType,
                      actionType: normalized.value.actionType,
                      enabled: normalized.value.enabled,
                      config: normalized.value.config,
                      updatedAt,
                  })
                  .where(
                      and(
                          eq(automodRules.guildId, normalized.value.guildId),
                          eq(automodRules.id, normalized.value.ruleId)
                      )
                  )
                  .returning()
            : await db
                  .insert(automodRules)
                  .values({
                      guildId: normalized.value.guildId,
                      name: normalized.value.name,
                      triggerType: normalized.value.triggerType,
                      actionType: normalized.value.actionType,
                      enabled: normalized.value.enabled,
                      config: normalized.value.config,
                      updatedAt,
                  })
                  .onConflictDoUpdate({
                      target: [automodRules.guildId, automodRules.name],
                      set: {
                          triggerType: normalized.value.triggerType,
                          actionType: normalized.value.actionType,
                          enabled: normalized.value.enabled,
                          config: normalized.value.config,
                          updatedAt,
                      },
                  })
                  .returning();
        const row = rows[0];

        if (!row) {
            return err(normalized.value.ruleId ? { type: 'not-found' } : { type: 'database-error' });
        }

        return toAutomodRuleRecord(row);
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function deleteAutomodRule(
    db: GuildFeatureRepositoryDatabase,
    input: { guildId: string; ruleId: string }
): Promise<Result<AutomodRuleRecord, AutomodRepositoryError>> {
    const guildId = normalizeRequiredText(input.guildId, 'guildId');
    const ruleId = normalizeRequiredText(input.ruleId, 'ruleId');

    if (guildId.isErr()) return err(guildId.error);
    if (ruleId.isErr()) return err(ruleId.error);

    try {
        const rows = await db
            .delete(automodRules)
            .where(and(eq(automodRules.guildId, guildId.value), eq(automodRules.id, ruleId.value)))
            .returning();
        const row = rows[0];

        return row ? toAutomodRuleRecord(row) : err({ type: 'not-found' });
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function recordAutomodEvent(
    db: GuildFeatureRepositoryDatabase,
    input: RecordAutomodEventInput
): Promise<Result<AutomodEventRecord, AutomodRepositoryError>> {
    const normalized = normalizeAutomodEventInput(input);

    if (normalized.isErr()) {
        return err(normalized.error);
    }

    try {
        const rows = await db
            .insert(automodEvents)
            .values({
                guildId: normalized.value.guildId,
                ruleId: normalized.value.ruleId,
                messageId: normalized.value.messageId,
                channelId: normalized.value.channelId,
                authorUserId: normalized.value.authorUserId,
                triggerType: normalized.value.triggerType,
                actionType: normalized.value.actionType,
                status: normalized.value.status,
                details: normalized.value.details,
            })
            .returning();
        const row = rows[0];

        return row ? toAutomodEventRecord(row) : err({ type: 'database-error' });
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function updateAutomodEventStatus(
    db: GuildFeatureRepositoryDatabase,
    input: UpdateAutomodEventStatusInput
): Promise<Result<AutomodEventRecord, AutomodRepositoryError>> {
    const eventId = normalizeRequiredText(input.eventId, 'eventId');
    const status = normalizeRequiredText(input.status, 'status');

    if (eventId.isErr()) return err(eventId.error);
    if (status.isErr()) return err(status.error);

    try {
        const existingRows = await db.select().from(automodEvents).where(eq(automodEvents.id, eventId.value)).limit(1);
        const existing = existingRows[0];

        if (!existing) return err({ type: 'not-found' });

        const rows = await db
            .update(automodEvents)
            .set({
                status: status.value,
                details: input.details ?? existing.details,
            })
            .where(eq(automodEvents.id, eventId.value))
            .returning();
        const row = rows[0];

        return row ? toAutomodEventRecord(row) : err({ type: 'database-error' });
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function listAutomodEventsByGuildId(
    db: GuildFeatureRepositoryDatabase,
    input: { guildId: string; limit?: number }
): Promise<Result<AutomodEventRecord[], AutomodRepositoryError>> {
    const guildId = normalizeRequiredText(input.guildId, 'guildId');

    if (guildId.isErr()) {
        return err(guildId.error);
    }

    const limit = input.limit ?? 50;

    if (!Number.isInteger(limit) || limit < 1 || limit > 200) {
        return err({ type: 'invalid-value', field: 'limit' });
    }

    try {
        const rows = await db
            .select()
            .from(automodEvents)
            .where(eq(automodEvents.guildId, guildId.value))
            .orderBy(desc(automodEvents.createdAt))
            .limit(limit);
        const records: AutomodEventRecord[] = [];

        for (const row of rows) {
            const record = toAutomodEventRecord(row);

            if (record.isErr()) {
                return err(record.error);
            }

            records.push(record.value);
        }

        return ok(records);
    } catch {
        return err({ type: 'database-error' });
    }
}

async function listAutomodRules(
    db: GuildFeatureRepositoryDatabase,
    input: { guildId: string; enabled?: boolean }
): Promise<Result<AutomodRuleRecord[], AutomodRepositoryError>> {
    const guildId = normalizeRequiredText(input.guildId, 'guildId');

    if (guildId.isErr()) {
        return err(guildId.error);
    }

    try {
        const rows = await db
            .select()
            .from(automodRules)
            .where(
                and(
                    eq(automodRules.guildId, guildId.value),
                    ...(input.enabled === undefined ? [] : [eq(automodRules.enabled, input.enabled)])
                )
            )
            .orderBy(desc(automodRules.createdAt));
        const records: AutomodRuleRecord[] = [];

        for (const row of rows) {
            const record = toAutomodRuleRecord(row);

            if (record.isErr()) {
                return err(record.error);
            }

            records.push(record.value);
        }

        return ok(records);
    } catch {
        return err({ type: 'database-error' });
    }
}

function normalizeAutomodRuleInput(input: SaveAutomodRuleInput): Result<
    {
        guildId: string;
        ruleId?: string;
        name: string;
        triggerType: AutomodTriggerType;
        actionType: AutomodActionType;
        enabled: boolean;
        config: AutomodRuleConfig;
    },
    AutomodRepositoryError
> {
    const guildId = normalizeRequiredText(input.guildId, 'guildId');
    const ruleId = input.ruleId ? normalizeRequiredText(input.ruleId, 'ruleId') : ok(undefined);
    const name = normalizeRequiredText(input.name, 'name');
    const triggerType = normalizeAutomodTriggerType(input.triggerType);
    const actionType = normalizeAutomodActionType(input.actionType ?? 'record');

    if (guildId.isErr()) return err(guildId.error);
    if (ruleId.isErr()) return err(ruleId.error);
    if (name.isErr()) return err(name.error);
    if (!triggerType) return err({ type: 'invalid-value', field: 'triggerType' });
    if (!actionType) return err({ type: 'invalid-value', field: 'actionType' });

    const config = normalizeRuleConfig(triggerType, input.config ?? {});

    if (config.isErr()) {
        return err(config.error);
    }

    return ok({
        guildId: guildId.value,
        ...(ruleId.value ? { ruleId: ruleId.value } : {}),
        name: name.value,
        triggerType,
        actionType,
        enabled: input.enabled ?? true,
        config: config.value,
    });
}

function normalizeAutomodEventInput(input: RecordAutomodEventInput): Result<
    {
        guildId: string;
        ruleId: string | null;
        messageId: string;
        channelId: string;
        authorUserId: string;
        triggerType: AutomodTriggerType;
        actionType: AutomodActionType;
        status: string;
        details: Record<string, unknown>;
    },
    AutomodRepositoryError
> {
    const guildId = normalizeRequiredText(input.guildId, 'guildId');
    const ruleId = input.ruleId ? normalizeRequiredText(input.ruleId, 'ruleId') : ok(undefined);
    const messageId = normalizeRequiredText(input.messageId, 'messageId');
    const channelId = normalizeRequiredText(input.channelId, 'channelId');
    const authorUserId = normalizeRequiredText(input.authorUserId, 'authorUserId');
    const triggerType = normalizeAutomodTriggerType(input.triggerType);
    const actionType = normalizeAutomodActionType(input.actionType ?? 'record');
    const status = normalizeOptionalText(input.status) ?? 'recorded';

    if (guildId.isErr()) return err(guildId.error);
    if (ruleId.isErr()) return err(ruleId.error);
    if (messageId.isErr()) return err(messageId.error);
    if (channelId.isErr()) return err(channelId.error);
    if (authorUserId.isErr()) return err(authorUserId.error);
    if (!triggerType) return err({ type: 'invalid-value', field: 'triggerType' });
    if (!actionType) return err({ type: 'invalid-value', field: 'actionType' });

    return ok({
        guildId: guildId.value,
        ruleId: ruleId.value ?? null,
        messageId: messageId.value,
        channelId: channelId.value,
        authorUserId: authorUserId.value,
        triggerType,
        actionType,
        status,
        details: input.details ?? {},
    });
}

function normalizeRuleConfig(
    triggerType: AutomodTriggerType,
    config: Record<string, unknown>
): Result<AutomodRuleConfig, AutomodRepositoryError> {
    const timeoutDurationSeconds = normalizeTimeoutDurationSeconds(config.timeoutDurationSeconds);
    const ignoredChannelIds = normalizeTextArray(config.ignoredChannelIds);
    const ignoredRoleIds = normalizeTextArray(config.ignoredRoleIds);
    const ignoredUserIds = normalizeTextArray(config.ignoredUserIds);

    if (timeoutDurationSeconds === 'invalid') {
        return err({ type: 'invalid-value', field: 'config.timeoutDurationSeconds' });
    }
    if (!ignoredChannelIds || !ignoredRoleIds || !ignoredUserIds) {
        return err({ type: 'invalid-value', field: 'config.ignoredIds' });
    }

    const sharedConfig = {
        ...(timeoutDurationSeconds ? { timeoutDurationSeconds } : {}),
        ...(ignoredChannelIds.length > 0 ? { ignoredChannelIds } : {}),
        ...(ignoredRoleIds.length > 0 ? { ignoredRoleIds } : {}),
        ...(ignoredUserIds.length > 0 ? { ignoredUserIds } : {}),
    };

    if (triggerType === 'invite_links') {
        return ok(sharedConfig);
    }

    const terms = config.terms;

    if (!Array.isArray(terms)) {
        return err({ type: 'invalid-value', field: 'config.terms' });
    }

    const normalizedTerms = [
        ...new Set(
            terms
                .filter((term): term is string => typeof term === 'string')
                .map((term) => term.trim())
                .filter(Boolean)
        ),
    ];

    if (normalizedTerms.length === 0) {
        return err({ type: 'invalid-value', field: 'config.terms' });
    }

    return ok({
        terms: normalizedTerms,
        ...sharedConfig,
    });
}

function toAutomodRuleRecord(row: typeof automodRules.$inferSelect): Result<AutomodRuleRecord, AutomodRepositoryError> {
    const triggerType = normalizeAutomodTriggerType(row.triggerType);
    const actionType = normalizeAutomodActionType(row.actionType);

    if (!triggerType || !actionType) {
        return err({ type: 'invalid-config' });
    }

    const config = normalizeRuleConfig(triggerType, row.config);

    if (config.isErr()) {
        return err({ type: 'invalid-config' });
    }

    return ok({
        ...row,
        triggerType,
        actionType,
        config: config.value,
    });
}

function toAutomodEventRecord(
    row: typeof automodEvents.$inferSelect
): Result<AutomodEventRecord, AutomodRepositoryError> {
    const triggerType = normalizeAutomodTriggerType(row.triggerType);
    const actionType = normalizeAutomodActionType(row.actionType);

    if (!triggerType || !actionType) {
        return err({ type: 'invalid-config' });
    }

    return ok({
        ...row,
        triggerType,
        actionType,
        details: row.details,
    });
}

function normalizeAutomodTriggerType(value: string): AutomodTriggerType | undefined {
    return automodTriggerTypes.find((triggerType) => triggerType === value);
}

function normalizeAutomodActionType(value: string): AutomodActionType | undefined {
    return automodActionTypes.find((actionType) => actionType === value);
}

function normalizeTimeoutDurationSeconds(value: unknown): number | undefined | 'invalid' {
    if (value === undefined) return undefined;
    if (!Number.isInteger(value) || typeof value !== 'number') return 'invalid';
    if (value < 60 || value > 2_419_200) return 'invalid';

    return value;
}

function normalizeTextArray(value: unknown): string[] | undefined {
    if (value === undefined) return [];
    if (!Array.isArray(value)) return undefined;

    return [
        ...new Set(
            value
                .filter((item): item is string => typeof item === 'string')
                .map((item) => item.trim())
                .filter(Boolean)
        ),
    ];
}

import { api } from '@neonflux/convex/api';
import { err, ok, type Result } from 'neverthrow';

import {
    automodActionTypes,
    automodTriggerTypes,
    type AutomodActionType,
    type AutomodEventRecord,
    type AutomodRepositoryError,
    type AutomodRuleConfig,
    type AutomodRuleRecord,
    type AutomodTriggerType,
    type GuildFeatureRepositoryError,
    type RecordAutomodEventInput,
    type SaveAutomodRuleInput,
    type UpdateAutomodEventStatusInput,
} from './contracts.js';

import type { ConvexDatabase } from './convex.js';

type ConvexQueryReference = Parameters<ConvexDatabase['client']['query']>[0];
type ConvexMutationReference = Parameters<ConvexDatabase['client']['mutation']>[0];

const convexApi = api as unknown as {
    automod: {
        deleteAutomodRule: ConvexMutationReference;
        listAutomodEventsByGuildId: ConvexQueryReference;
        listAutomodRulesByGuildId: ConvexQueryReference;
        listEnabledAutomodRulesByGuildId: ConvexQueryReference;
        recordAutomodEvent: ConvexMutationReference;
        saveAutomodRule: ConvexMutationReference;
        updateAutomodEventStatus: ConvexMutationReference;
    };
};

type AutomodDb = ConvexDatabase;

type ConvexAutomodRuleRecord = {
    actionType: AutomodActionType;
    config: AutomodRuleConfig;
    createdAt: string;
    enabled: boolean;
    guildId: string;
    id: string;
    name: string;
    triggerType: AutomodTriggerType;
    updatedAt: string;
};

type ConvexAutomodEventRecord = {
    actionType: AutomodActionType;
    authorUserId: string;
    channelId: string;
    createdAt: string;
    details: Record<string, unknown>;
    guildId: string;
    id: string;
    messageId: string;
    ruleId: string | null;
    status: string;
    triggerType: AutomodTriggerType;
};

export async function listAutomodRulesByGuildId(
    db: AutomodDb,
    input: { guildId: string }
): Promise<Result<AutomodRuleRecord[], AutomodRepositoryError>> {
    return listAutomodRules(db, { enabledOnly: false, guildId: input.guildId });
}

export async function listEnabledAutomodRulesByGuildId(
    db: AutomodDb,
    input: { guildId: string }
): Promise<Result<AutomodRuleRecord[], AutomodRepositoryError>> {
    return listAutomodRules(db, { enabledOnly: true, guildId: input.guildId });
}

export async function saveAutomodRule(
    db: AutomodDb,
    input: SaveAutomodRuleInput
): Promise<Result<AutomodRuleRecord, AutomodRepositoryError>> {
    const normalizedInput = normalizeAutomodRuleInput(input);

    if (normalizedInput.isErr()) {
        return err(normalizedInput.error);
    }

    try {
        const rule = (await db.client.mutation(
            convexApi.automod.saveAutomodRule,
            normalizedInput.value
        )) as ConvexAutomodRuleRecord;

        return ok(toAutomodRuleRecord(rule));
    } catch (error) {
        return err(mapConvexAutomodError(error));
    }
}

export async function deleteAutomodRule(
    db: AutomodDb,
    input: { guildId: string; ruleId: string }
): Promise<Result<AutomodRuleRecord, AutomodRepositoryError>> {
    const guildId = normalizeRequiredText(input.guildId, 'guildId');
    const ruleId = normalizeRequiredText(input.ruleId, 'ruleId');

    if (guildId.isErr()) return err(guildId.error);
    if (ruleId.isErr()) return err(ruleId.error);

    try {
        const rule = (await db.client.mutation(convexApi.automod.deleteAutomodRule, {
            guildId: guildId.value,
            ruleId: ruleId.value,
        })) as ConvexAutomodRuleRecord | null;

        return rule ? ok(toAutomodRuleRecord(rule)) : err({ type: 'not-found' });
    } catch (error) {
        return err(mapConvexAutomodError(error));
    }
}

export async function recordAutomodEvent(
    db: AutomodDb,
    input: RecordAutomodEventInput
): Promise<Result<AutomodEventRecord, AutomodRepositoryError>> {
    const normalizedInput = normalizeAutomodEventInput(input);

    if (normalizedInput.isErr()) {
        return err(normalizedInput.error);
    }

    try {
        const event = (await db.client.mutation(
            convexApi.automod.recordAutomodEvent,
            normalizedInput.value
        )) as ConvexAutomodEventRecord;

        return ok(toAutomodEventRecord(event));
    } catch (error) {
        return err(mapConvexAutomodError(error));
    }
}

export async function updateAutomodEventStatus(
    db: AutomodDb,
    input: UpdateAutomodEventStatusInput
): Promise<Result<AutomodEventRecord, AutomodRepositoryError>> {
    const eventId = normalizeRequiredText(input.eventId, 'eventId');
    const status = normalizeRequiredText(input.status, 'status');

    if (eventId.isErr()) return err(eventId.error);
    if (status.isErr()) return err(status.error);

    try {
        const event = (await db.client.mutation(convexApi.automod.updateAutomodEventStatus, {
            ...(input.details ? { details: input.details } : {}),
            eventId: eventId.value,
            status: status.value,
        })) as ConvexAutomodEventRecord | null;

        return event ? ok(toAutomodEventRecord(event)) : err({ type: 'not-found' });
    } catch (error) {
        return err(mapConvexAutomodError(error));
    }
}

export async function listAutomodEventsByGuildId(
    db: AutomodDb,
    input: { guildId: string; limit?: number }
): Promise<Result<AutomodEventRecord[], AutomodRepositoryError>> {
    const guildId = normalizeRequiredText(input.guildId, 'guildId');
    const limit = normalizeAutomodListLimit(input.limit);

    if (guildId.isErr()) return err(guildId.error);
    if (limit.isErr()) return err(limit.error);

    try {
        const events = (await db.client.query(convexApi.automod.listAutomodEventsByGuildId, {
            guildId: guildId.value,
            limit: limit.value,
        })) as ConvexAutomodEventRecord[];

        return ok(events.map(toAutomodEventRecord));
    } catch (error) {
        return err(mapConvexAutomodError(error));
    }
}

async function listAutomodRules(
    db: ConvexDatabase,
    input: { enabledOnly: boolean; guildId: string }
): Promise<Result<AutomodRuleRecord[], AutomodRepositoryError>> {
    const guildId = normalizeRequiredText(input.guildId, 'guildId');

    if (guildId.isErr()) {
        return err(guildId.error);
    }

    try {
        const rules = (await db.client.query(
            input.enabledOnly
                ? convexApi.automod.listEnabledAutomodRulesByGuildId
                : convexApi.automod.listAutomodRulesByGuildId,
            { guildId: guildId.value, limit: 200 }
        )) as ConvexAutomodRuleRecord[];

        return ok(rules.map(toAutomodRuleRecord));
    } catch (error) {
        return err(mapConvexAutomodError(error));
    }
}

function toAutomodRuleRecord(record: ConvexAutomodRuleRecord): AutomodRuleRecord {
    return {
        actionType: record.actionType,
        config: record.config,
        createdAt: new Date(record.createdAt),
        enabled: record.enabled,
        guildId: record.guildId,
        id: record.id,
        name: record.name,
        triggerType: record.triggerType,
        updatedAt: new Date(record.updatedAt),
    };
}

function toAutomodEventRecord(record: ConvexAutomodEventRecord): AutomodEventRecord {
    return {
        actionType: record.actionType,
        authorUserId: record.authorUserId,
        channelId: record.channelId,
        createdAt: new Date(record.createdAt),
        details: record.details,
        guildId: record.guildId,
        id: record.id,
        messageId: record.messageId,
        ruleId: record.ruleId,
        status: record.status,
        triggerType: record.triggerType,
    };
}

function normalizeAutomodRuleInput(input: SaveAutomodRuleInput): Result<
    {
        actionType: AutomodActionType;
        config: AutomodRuleConfig;
        enabled: boolean;
        guildId: string;
        name: string;
        ruleId?: string;
        triggerType: AutomodTriggerType;
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
    if (!triggerType) return err({ field: 'triggerType', type: 'invalid-value' });
    if (!actionType) return err({ field: 'actionType', type: 'invalid-value' });

    const config = normalizeRuleConfig(triggerType, input.config ?? {});

    if (config.isErr()) {
        return err(config.error);
    }

    return ok({
        actionType,
        config: config.value,
        enabled: input.enabled ?? true,
        guildId: guildId.value,
        name: name.value,
        ...(ruleId.value ? { ruleId: ruleId.value } : {}),
        triggerType,
    });
}

function normalizeAutomodEventInput(input: RecordAutomodEventInput): Result<
    {
        actionType: AutomodActionType;
        authorUserId: string;
        channelId: string;
        details: Record<string, unknown>;
        guildId: string;
        messageId: string;
        ruleId?: string;
        status: string;
        triggerType: AutomodTriggerType;
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
    if (!triggerType) return err({ field: 'triggerType', type: 'invalid-value' });
    if (!actionType) return err({ field: 'actionType', type: 'invalid-value' });

    return ok({
        actionType,
        authorUserId: authorUserId.value,
        channelId: channelId.value,
        details: input.details ?? {},
        guildId: guildId.value,
        messageId: messageId.value,
        ...(ruleId.value ? { ruleId: ruleId.value } : {}),
        status,
        triggerType,
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
        return err({ field: 'config.timeoutDurationSeconds', type: 'invalid-value' });
    }
    if (!ignoredChannelIds || !ignoredRoleIds || !ignoredUserIds) {
        return err({ field: 'config.ignoredIds', type: 'invalid-value' });
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

    const terms = normalizeTerms(config.terms);

    return terms && terms.length > 0
        ? ok({ terms, ...sharedConfig })
        : err({ field: 'config.terms', type: 'invalid-value' });
}

function normalizeAutomodListLimit(limit: number | undefined): Result<number, AutomodRepositoryError> {
    if (limit === undefined) {
        return ok(50);
    }

    if (!Number.isInteger(limit) || limit < 1 || limit > 200) {
        return err({ field: 'limit', type: 'invalid-value' });
    }

    return ok(limit);
}

function mapConvexAutomodError(error: unknown): AutomodRepositoryError {
    const message = error instanceof Error ? error.message.trim() : '';

    return message === 'not-found' || message.endsWith(': not-found')
        ? { type: 'not-found' }
        : { type: 'database-error' };
}

function normalizeRequiredText(
    value: string | null | undefined,
    field: string
): Result<string, GuildFeatureRepositoryError> {
    const normalizedValue = value?.trim();

    return normalizedValue ? ok(normalizedValue) : err({ field, type: 'missing-input' });
}

function normalizeOptionalText(value: string | null | undefined): string | undefined {
    const normalizedValue = value?.trim();

    return normalizedValue && normalizedValue.length > 0 ? normalizedValue : undefined;
}

function normalizeAutomodTriggerType(value: string | null | undefined): AutomodTriggerType | undefined {
    return automodTriggerTypes.find((triggerType) => triggerType === value);
}

function normalizeAutomodActionType(value: string | null | undefined): AutomodActionType | undefined {
    return automodActionTypes.find((actionType) => actionType === value);
}

function normalizeTerms(value: unknown): string[] | undefined {
    if (!Array.isArray(value)) return undefined;

    return normalizeTextArray(value);
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

function normalizeTimeoutDurationSeconds(value: unknown): number | undefined | 'invalid' {
    if (value === undefined) return undefined;
    if (typeof value !== 'number' || !Number.isInteger(value)) return 'invalid';
    if (value < 60 || value > 2_419_200) return 'invalid';

    return value;
}

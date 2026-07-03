import { api } from '@neonflux/convex/api';
import {
    deleteVcGeneratorRule as deleteVcGeneratorRulePostgres,
    findGeneratedVoiceChannelByChannelId as findGeneratedVoiceChannelByChannelIdPostgres,
    findVcGeneratorControlPanelByMessageId as findVcGeneratorControlPanelByMessageIdPostgres,
    findVcGeneratorControlPanelByRuleId as findVcGeneratorControlPanelByRuleIdPostgres,
    findVcGeneratorRuleBySourceChannelId as findVcGeneratorRuleBySourceChannelIdPostgres,
    listGeneratedVoiceChannelsByGuildId as listGeneratedVoiceChannelsByGuildIdPostgres,
    listVcGeneratorControlPanelsByGuildId as listVcGeneratorControlPanelsByGuildIdPostgres,
    listVcGeneratorRulesByGuildId as listVcGeneratorRulesByGuildIdPostgres,
    updateGeneratedVoiceChannelStatus as updateGeneratedVoiceChannelStatusPostgres,
    upsertGeneratedVoiceChannel as upsertGeneratedVoiceChannelPostgres,
    upsertVcGeneratorControlPanel as upsertVcGeneratorControlPanelPostgres,
    upsertVcGeneratorRule as upsertVcGeneratorRulePostgres,
    type GeneratedVoiceChannelRecord,
    type GeneratedVoiceChannelStatus,
    type VcGeneratorControlMode,
    type VcGeneratorControlPanelRecord,
    type VcGeneratorControlPanelStatus,
    type VcGeneratorRepositoryError,
    type VcGeneratorRuleRecord,
} from '@neonflux/db';
import { err, ok, type Result } from 'neverthrow';

import { isConvexPersistenceDatabase, type ConvexPersistenceDatabase } from './convex.js';
import {
    normalizeNonNegativeInteger,
    normalizeOptionalText,
    normalizeRequiredText,
    toControlPanelRecord,
    toGeneratedChannelRecord,
    toRuleRecord,
    type ConvexGeneratedVoiceChannelRecord,
    type ConvexVcGeneratorControlPanelRecord,
    type ConvexVcGeneratorRuleRecord,
} from './runtime-vc-generator-records.js';

type ConvexQueryReference = Parameters<ConvexPersistenceDatabase['client']['query']>[0];
type ConvexMutationReference = Parameters<ConvexPersistenceDatabase['client']['mutation']>[0];

const convexApi = api as unknown as {
    vc_generator: {
        deleteVcGeneratorRule: ConvexMutationReference;
        findGeneratedVoiceChannelByChannelId: ConvexQueryReference;
        findVcGeneratorControlPanelByMessageId: ConvexQueryReference;
        findVcGeneratorControlPanelByRuleId: ConvexQueryReference;
        findVcGeneratorRuleBySourceChannelId: ConvexQueryReference;
        listGeneratedVoiceChannelsByGuildId: ConvexQueryReference;
        listVcGeneratorControlPanelsByGuildId: ConvexQueryReference;
        listVcGeneratorRulesByGuildId: ConvexQueryReference;
        updateGeneratedVoiceChannelStatus: ConvexMutationReference;
        upsertGeneratedVoiceChannel: ConvexMutationReference;
        upsertVcGeneratorControlPanel: ConvexMutationReference;
        upsertVcGeneratorRule: ConvexMutationReference;
    };
};

type PostgresVcGeneratorDb = Parameters<typeof upsertVcGeneratorRulePostgres>[0];
type VcGeneratorDb = ConvexPersistenceDatabase | PostgresVcGeneratorDb;

const generatedVoiceChannelStatuses = new Set<GeneratedVoiceChannelStatus>(['active', 'deleted', 'orphaned']);
const controlPanelStatuses = new Set<VcGeneratorControlPanelStatus>(['active', 'stale', 'disabled']);

export async function upsertVcGeneratorRule(
    db: VcGeneratorDb,
    input: {
        categoryId?: string;
        config?: Record<string, unknown>;
        enabled?: boolean;
        guildId: string;
        nameTemplate: string;
        sourceChannelId: string;
    }
): Promise<Result<VcGeneratorRuleRecord, VcGeneratorRepositoryError>> {
    if (!isConvexPersistenceDatabase(db)) return upsertVcGeneratorRulePostgres(db, input);

    const normalizedInput = normalizeRuleInput(input);
    if (normalizedInput.isErr()) return err(normalizedInput.error);

    try {
        const rule = (await db.client.mutation(
            convexApi.vc_generator.upsertVcGeneratorRule,
            normalizedInput.value
        )) as ConvexVcGeneratorRuleRecord;

        return ok(toRuleRecord(rule));
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function upsertGeneratedVoiceChannel(
    db: VcGeneratorDb,
    input: { channelId: string; guildId: string; ownerUserId?: string; ruleId?: string; status?: string }
): Promise<Result<GeneratedVoiceChannelRecord, VcGeneratorRepositoryError>> {
    if (!isConvexPersistenceDatabase(db)) return upsertGeneratedVoiceChannelPostgres(db, input);

    const normalizedInput = normalizeGeneratedChannelInput(input);
    if (normalizedInput.isErr()) return err(normalizedInput.error);

    try {
        const channel = (await db.client.mutation(
            convexApi.vc_generator.upsertGeneratedVoiceChannel,
            normalizedInput.value
        )) as ConvexGeneratedVoiceChannelRecord;

        return ok(toGeneratedChannelRecord(channel));
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function listVcGeneratorRulesByGuildId(
    db: VcGeneratorDb,
    input: { enabledOnly?: boolean; guildId: string }
): Promise<Result<VcGeneratorRuleRecord[], VcGeneratorRepositoryError>> {
    if (!isConvexPersistenceDatabase(db)) return listVcGeneratorRulesByGuildIdPostgres(db, input);

    const guildId = normalizeRequiredText(input.guildId, 'guildId');
    if (guildId.isErr()) return err(guildId.error);

    try {
        const rules = (await db.client.query(convexApi.vc_generator.listVcGeneratorRulesByGuildId, {
            ...(input.enabledOnly === undefined ? {} : { enabledOnly: input.enabledOnly }),
            guildId: guildId.value,
            limit: 500,
        })) as ConvexVcGeneratorRuleRecord[];

        return ok(rules.map(toRuleRecord));
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function findVcGeneratorRuleBySourceChannelId(
    db: VcGeneratorDb,
    input: { enabledOnly?: boolean; guildId: string; sourceChannelId: string }
): Promise<Result<VcGeneratorRuleRecord, VcGeneratorRepositoryError>> {
    if (!isConvexPersistenceDatabase(db)) return findVcGeneratorRuleBySourceChannelIdPostgres(db, input);

    const normalizedInput = normalizeSourceLookupInput(input);
    if (normalizedInput.isErr()) return err(normalizedInput.error);

    try {
        const rule = (await db.client.query(
            convexApi.vc_generator.findVcGeneratorRuleBySourceChannelId,
            normalizedInput.value
        )) as ConvexVcGeneratorRuleRecord | null;

        return rule ? ok(toRuleRecord(rule)) : err({ type: 'not-found' });
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function deleteVcGeneratorRule(
    db: VcGeneratorDb,
    input: { guildId: string; sourceChannelId: string }
): Promise<Result<VcGeneratorRuleRecord, VcGeneratorRepositoryError>> {
    if (!isConvexPersistenceDatabase(db)) return deleteVcGeneratorRulePostgres(db, input);

    const normalizedInput = normalizeSourceLookupInput(input);
    if (normalizedInput.isErr()) return err(normalizedInput.error);

    try {
        const rule = (await db.client.mutation(
            convexApi.vc_generator.deleteVcGeneratorRule,
            normalizedInput.value
        )) as ConvexVcGeneratorRuleRecord | null;

        return rule ? ok(toRuleRecord(rule)) : err({ type: 'not-found' });
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function findGeneratedVoiceChannelByChannelId(
    db: VcGeneratorDb,
    input: { channelId: string }
): Promise<Result<GeneratedVoiceChannelRecord, VcGeneratorRepositoryError>> {
    if (!isConvexPersistenceDatabase(db)) return findGeneratedVoiceChannelByChannelIdPostgres(db, input);

    const channelId = normalizeRequiredText(input.channelId, 'channelId');
    if (channelId.isErr()) return err(channelId.error);

    try {
        const channel = (await db.client.query(convexApi.vc_generator.findGeneratedVoiceChannelByChannelId, {
            channelId: channelId.value,
        })) as ConvexGeneratedVoiceChannelRecord | null;

        return channel ? ok(toGeneratedChannelRecord(channel)) : err({ type: 'not-found' });
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function listGeneratedVoiceChannelsByGuildId(
    db: VcGeneratorDb,
    input: { guildId: string; ruleId?: string; status?: string }
): Promise<Result<GeneratedVoiceChannelRecord[], VcGeneratorRepositoryError>> {
    if (!isConvexPersistenceDatabase(db)) return listGeneratedVoiceChannelsByGuildIdPostgres(db, input);

    const normalizedInput = normalizeGeneratedChannelListInput(input);
    if (normalizedInput.isErr()) return err(normalizedInput.error);

    try {
        const channels = (await db.client.query(convexApi.vc_generator.listGeneratedVoiceChannelsByGuildId, {
            ...normalizedInput.value,
            limit: 500,
        })) as ConvexGeneratedVoiceChannelRecord[];

        return ok(channels.map(toGeneratedChannelRecord));
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function updateGeneratedVoiceChannelStatus(
    db: VcGeneratorDb,
    input: { channelId: string; guildId: string; status: string }
): Promise<Result<GeneratedVoiceChannelRecord, VcGeneratorRepositoryError>> {
    if (!isConvexPersistenceDatabase(db)) return updateGeneratedVoiceChannelStatusPostgres(db, input);

    const normalizedInput = normalizeGeneratedChannelStatusInput(input);
    if (normalizedInput.isErr()) return err(normalizedInput.error);

    try {
        const channel = (await db.client.mutation(
            convexApi.vc_generator.updateGeneratedVoiceChannelStatus,
            normalizedInput.value
        )) as ConvexGeneratedVoiceChannelRecord | null;

        return channel ? ok(toGeneratedChannelRecord(channel)) : err({ type: 'not-found' });
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function upsertVcGeneratorControlPanel(
    db: VcGeneratorDb,
    input: {
        channelId: string;
        config?: Record<string, unknown>;
        controlMode?: string;
        guildId: string;
        messageId?: string;
        ruleId: string;
        status?: string;
        synced?: boolean;
    }
): Promise<Result<VcGeneratorControlPanelRecord, VcGeneratorRepositoryError>> {
    if (!isConvexPersistenceDatabase(db)) return upsertVcGeneratorControlPanelPostgres(db, input);

    const normalizedInput = normalizeControlPanelInput(input);
    if (normalizedInput.isErr()) return err(normalizedInput.error);

    try {
        const panel = (await db.client.mutation(
            convexApi.vc_generator.upsertVcGeneratorControlPanel,
            normalizedInput.value
        )) as ConvexVcGeneratorControlPanelRecord;

        return ok(toControlPanelRecord(panel));
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function findVcGeneratorControlPanelByMessageId(
    db: VcGeneratorDb,
    input: { guildId: string; messageId: string }
): Promise<Result<VcGeneratorControlPanelRecord, VcGeneratorRepositoryError>> {
    if (!isConvexPersistenceDatabase(db)) return findVcGeneratorControlPanelByMessageIdPostgres(db, input);

    const normalizedInput = normalizePanelMessageLookupInput(input);
    if (normalizedInput.isErr()) return err(normalizedInput.error);

    try {
        const panel = (await db.client.query(
            convexApi.vc_generator.findVcGeneratorControlPanelByMessageId,
            normalizedInput.value
        )) as ConvexVcGeneratorControlPanelRecord | null;

        return panel ? ok(toControlPanelRecord(panel)) : err({ type: 'not-found' });
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function findVcGeneratorControlPanelByRuleId(
    db: VcGeneratorDb,
    input: { guildId: string; ruleId: string }
): Promise<Result<VcGeneratorControlPanelRecord, VcGeneratorRepositoryError>> {
    if (!isConvexPersistenceDatabase(db)) return findVcGeneratorControlPanelByRuleIdPostgres(db, input);

    const normalizedInput = normalizePanelRuleLookupInput(input);
    if (normalizedInput.isErr()) return err(normalizedInput.error);

    try {
        const panel = (await db.client.query(
            convexApi.vc_generator.findVcGeneratorControlPanelByRuleId,
            normalizedInput.value
        )) as ConvexVcGeneratorControlPanelRecord | null;

        return panel ? ok(toControlPanelRecord(panel)) : err({ type: 'not-found' });
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function listVcGeneratorControlPanelsByGuildId(
    db: VcGeneratorDb,
    input: { guildId: string; limit?: number; status?: string }
): Promise<Result<VcGeneratorControlPanelRecord[], VcGeneratorRepositoryError>> {
    if (!isConvexPersistenceDatabase(db)) return listVcGeneratorControlPanelsByGuildIdPostgres(db, input);

    const normalizedInput = normalizeControlPanelListInput(input);
    if (normalizedInput.isErr()) return err(normalizedInput.error);
    if (normalizedInput.value.limit === 0) return ok([]);

    try {
        const panels = (await db.client.query(
            convexApi.vc_generator.listVcGeneratorControlPanelsByGuildId,
            normalizedInput.value
        )) as ConvexVcGeneratorControlPanelRecord[];

        return ok(panels.map(toControlPanelRecord));
    } catch {
        return err({ type: 'database-error' });
    }
}

function normalizeRuleInput(input: {
    categoryId?: string;
    config?: Record<string, unknown>;
    enabled?: boolean;
    guildId: string;
    nameTemplate: string;
    sourceChannelId: string;
}): Result<Record<string, unknown>, VcGeneratorRepositoryError> {
    const sourceLookup = normalizeSourceLookupInput(input);
    const nameTemplate = normalizeRequiredText(input.nameTemplate, 'nameTemplate');

    if (sourceLookup.isErr()) return err(sourceLookup.error);
    if (nameTemplate.isErr()) return err(nameTemplate.error);

    return ok({
        ...sourceLookup.value,
        ...(normalizeOptionalText(input.categoryId) ? { categoryId: normalizeOptionalText(input.categoryId) } : {}),
        config: input.config ?? {},
        ...(input.enabled === undefined ? {} : { enabled: input.enabled }),
        nameTemplate: nameTemplate.value,
    });
}

function normalizeGeneratedChannelInput(input: {
    channelId: string;
    guildId: string;
    ownerUserId?: string;
    ruleId?: string;
    status?: string;
}): Result<Record<string, unknown>, VcGeneratorRepositoryError> {
    const guildId = normalizeRequiredText(input.guildId, 'guildId');
    const channelId = normalizeRequiredText(input.channelId, 'channelId');
    const ownerUserId = normalizeOptionalText(input.ownerUserId);
    const ruleId = normalizeOptionalText(input.ruleId);
    let status: GeneratedVoiceChannelStatus | undefined;

    if (guildId.isErr()) return err(guildId.error);
    if (channelId.isErr()) return err(channelId.error);
    if (input.status !== undefined) {
        const statusResult = normalizeGeneratedVoiceChannelStatus(input.status);
        if (statusResult.isErr()) return err(statusResult.error);
        status = statusResult.value;
    }

    return ok({
        channelId: channelId.value,
        guildId: guildId.value,
        ...(ownerUserId ? { ownerUserId } : {}),
        ...(ruleId ? { ruleId } : {}),
        ...(status ? { status } : {}),
    });
}

function normalizeGeneratedChannelListInput(input: {
    guildId: string;
    ruleId?: string;
    status?: string;
}): Result<Record<string, unknown>, VcGeneratorRepositoryError> {
    const guildId = normalizeRequiredText(input.guildId, 'guildId');
    const ruleId = normalizeOptionalText(input.ruleId);
    let status: GeneratedVoiceChannelStatus | undefined;

    if (guildId.isErr()) return err(guildId.error);
    if (input.status !== undefined) {
        const statusResult = normalizeGeneratedVoiceChannelStatus(input.status);
        if (statusResult.isErr()) return err(statusResult.error);
        status = statusResult.value;
    }

    return ok({
        guildId: guildId.value,
        ...(ruleId ? { ruleId } : {}),
        ...(status ? { status } : {}),
    });
}

function normalizeGeneratedChannelStatusInput(input: {
    channelId: string;
    guildId: string;
    status: string;
}): Result<{ channelId: string; guildId: string; status: GeneratedVoiceChannelStatus }, VcGeneratorRepositoryError> {
    const guildId = normalizeRequiredText(input.guildId, 'guildId');
    const channelId = normalizeRequiredText(input.channelId, 'channelId');
    const status = normalizeGeneratedVoiceChannelStatus(input.status);

    if (guildId.isErr()) return err(guildId.error);
    if (channelId.isErr()) return err(channelId.error);
    if (status.isErr()) return err(status.error);

    return ok({ channelId: channelId.value, guildId: guildId.value, status: status.value });
}

function normalizeControlPanelInput(input: {
    channelId: string;
    config?: Record<string, unknown>;
    controlMode?: string;
    guildId: string;
    messageId?: string;
    ruleId: string;
    status?: string;
    synced?: boolean;
}): Result<Record<string, unknown>, VcGeneratorRepositoryError> {
    const identity = normalizePanelRuleLookupInput(input);
    const channelId = normalizeRequiredText(input.channelId, 'channelId');
    const status = normalizeControlPanelStatus(input.status ?? 'active');
    const controlMode = normalizeControlMode(input.controlMode ?? 'reaction');

    if (identity.isErr()) return err(identity.error);
    if (channelId.isErr()) return err(channelId.error);
    if (status.isErr()) return err(status.error);
    if (controlMode.isErr()) return err(controlMode.error);

    return ok({
        ...identity.value,
        channelId: channelId.value,
        config: input.config ?? {},
        controlMode: controlMode.value,
        ...(normalizeOptionalText(input.messageId) ? { messageId: normalizeOptionalText(input.messageId) } : {}),
        status: status.value,
        ...(input.synced === undefined ? {} : { synced: input.synced }),
    });
}

function normalizeControlPanelListInput(input: {
    guildId: string;
    limit?: number;
    status?: string;
}): Result<{ guildId: string; limit: number; status?: VcGeneratorControlPanelStatus }, VcGeneratorRepositoryError> {
    const guildId = normalizeRequiredText(input.guildId, 'guildId');
    const limit = normalizeNonNegativeInteger(input.limit ?? 100, 'limit');
    let status: VcGeneratorControlPanelStatus | undefined;

    if (guildId.isErr()) return err(guildId.error);
    if (limit.isErr()) return err(limit.error);
    if (input.status !== undefined) {
        const statusResult = normalizeControlPanelStatus(input.status);
        if (statusResult.isErr()) return err(statusResult.error);
        status = statusResult.value;
    }

    return ok({
        guildId: guildId.value,
        limit: limit.value,
        ...(status ? { status } : {}),
    });
}

function normalizeSourceLookupInput(input: {
    enabledOnly?: boolean;
    guildId: string;
    sourceChannelId: string;
}): Result<{ enabledOnly?: boolean; guildId: string; sourceChannelId: string }, VcGeneratorRepositoryError> {
    const guildId = normalizeRequiredText(input.guildId, 'guildId');
    const sourceChannelId = normalizeRequiredText(input.sourceChannelId, 'sourceChannelId');

    if (guildId.isErr()) return err(guildId.error);
    if (sourceChannelId.isErr()) return err(sourceChannelId.error);

    return ok({
        ...(input.enabledOnly === undefined ? {} : { enabledOnly: input.enabledOnly }),
        guildId: guildId.value,
        sourceChannelId: sourceChannelId.value,
    });
}

function normalizePanelMessageLookupInput(input: {
    guildId: string;
    messageId: string;
}): Result<{ guildId: string; messageId: string }, VcGeneratorRepositoryError> {
    const guildId = normalizeRequiredText(input.guildId, 'guildId');
    const messageId = normalizeRequiredText(input.messageId, 'messageId');

    if (guildId.isErr()) return err(guildId.error);
    if (messageId.isErr()) return err(messageId.error);

    return ok({ guildId: guildId.value, messageId: messageId.value });
}

function normalizePanelRuleLookupInput(input: {
    guildId: string;
    ruleId: string;
}): Result<{ guildId: string; ruleId: string }, VcGeneratorRepositoryError> {
    const guildId = normalizeRequiredText(input.guildId, 'guildId');
    const ruleId = normalizeRequiredText(input.ruleId, 'ruleId');

    if (guildId.isErr()) return err(guildId.error);
    if (ruleId.isErr()) return err(ruleId.error);

    return ok({ guildId: guildId.value, ruleId: ruleId.value });
}

function normalizeGeneratedVoiceChannelStatus(
    value: string
): Result<GeneratedVoiceChannelStatus, VcGeneratorRepositoryError> {
    return generatedVoiceChannelStatuses.has(value as GeneratedVoiceChannelStatus)
        ? ok(value as GeneratedVoiceChannelStatus)
        : err({ field: 'status', type: 'invalid-value' });
}

function normalizeControlPanelStatus(value: string): Result<VcGeneratorControlPanelStatus, VcGeneratorRepositoryError> {
    return controlPanelStatuses.has(value as VcGeneratorControlPanelStatus)
        ? ok(value as VcGeneratorControlPanelStatus)
        : err({ field: 'status', type: 'invalid-value' });
}

function normalizeControlMode(value: string): Result<VcGeneratorControlMode, VcGeneratorRepositoryError> {
    return value === 'reaction' ? ok(value) : err({ field: 'controlMode', type: 'invalid-value' });
}

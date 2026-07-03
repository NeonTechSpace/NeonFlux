import { api } from '@neonflux/convex/api';
import {
    addModerationCaseNote as addModerationCaseNotePostgres,
    createChannelModerationCase as createChannelModerationCasePostgres,
    createModerationCase as createModerationCasePostgres,
    findModerationCaseByGuildCaseNumber as findModerationCaseByGuildCaseNumberPostgres,
    listModerationCaseEventsByCaseId as listModerationCaseEventsByCaseIdPostgres,
    listModerationCasesByGuildId as listModerationCasesByGuildIdPostgres,
    recordModerationCaseEvent as recordModerationCaseEventPostgres,
    updateModerationCaseReason as updateModerationCaseReasonPostgres,
    updateModerationCaseStatus as updateModerationCaseStatusPostgres,
    voidModerationCase as voidModerationCasePostgres,
    type GuildFeatureRepositoryError,
    type ModerationCaseEventRecord,
    type ModerationCaseRecord,
    type ModerationRepositoryError,
} from '@neonflux/db';
import {
    createObservedModerationCase as createObservedModerationCasePostgres,
    findRecentModerationCaseByTargetAction as findRecentModerationCaseByTargetActionPostgres,
} from '@neonflux/db';
import { err, ok, type Result } from 'neverthrow';

import { isConvexPersistenceDatabase, type ConvexPersistenceDatabase } from './convex.js';

type ConvexQueryReference = Parameters<ConvexPersistenceDatabase['client']['query']>[0];
type ConvexMutationReference = Parameters<ConvexPersistenceDatabase['client']['mutation']>[0];

const convexApi = api as unknown as {
    moderation: {
        addModerationCaseNote: ConvexMutationReference;
        createChannelModerationCase: ConvexMutationReference;
        createModerationCase: ConvexMutationReference;
        createObservedModerationCase: ConvexMutationReference;
        findModerationCaseByGuildCaseNumber: ConvexQueryReference;
        findRecentModerationCaseByTargetAction: ConvexQueryReference;
        listModerationCaseEventsByCaseId: ConvexQueryReference;
        listModerationCasesByGuildId: ConvexQueryReference;
        recordModerationCaseEvent: ConvexMutationReference;
        updateModerationCaseReason: ConvexMutationReference;
        updateModerationCaseStatus: ConvexMutationReference;
        voidModerationCase: ConvexMutationReference;
    };
};

type PostgresModerationDb = Parameters<typeof createModerationCasePostgres>[0];
type ModerationDb = ConvexPersistenceDatabase | PostgresModerationDb;

type ConvexModerationCaseRecord = Omit<ModerationCaseRecord, 'createdAt' | 'updatedAt'> & {
    createdAt: string;
    updatedAt: string;
};
type ConvexModerationCaseEventRecord = Omit<ModerationCaseEventRecord, 'createdAt'> & {
    createdAt: string;
};

export async function createModerationCase(
    db: ModerationDb,
    input: {
        action: string;
        actorUserId?: string;
        caseNumber?: number;
        guildId: string;
        reason?: string;
        targetUserId: string;
    }
): Promise<Result<ModerationCaseRecord, ModerationRepositoryError>> {
    if (!isConvexPersistenceDatabase(db)) return createModerationCasePostgres(db, input);

    const normalizedInput = normalizeUserCaseInput(input);
    if (normalizedInput.isErr()) return err(normalizedInput.error);

    try {
        const moderationCase = (await db.client.mutation(
            convexApi.moderation.createModerationCase,
            normalizedInput.value
        )) as ConvexModerationCaseRecord;

        return ok(toModerationCaseRecord(moderationCase));
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function createChannelModerationCase(
    db: ModerationDb,
    input: { action: string; actorUserId?: string; guildId: string; reason?: string; targetChannelId: string }
): Promise<Result<ModerationCaseRecord, ModerationRepositoryError>> {
    if (!isConvexPersistenceDatabase(db)) return createChannelModerationCasePostgres(db, input);

    const guildId = normalizeRequiredText(input.guildId, 'guildId');
    const action = normalizeRequiredText(input.action, 'action');
    const targetChannelId = normalizeRequiredText(input.targetChannelId, 'targetChannelId');

    if (guildId.isErr()) return err(guildId.error);
    if (action.isErr()) return err(action.error);
    if (targetChannelId.isErr()) return err(targetChannelId.error);

    try {
        const moderationCase = (await db.client.mutation(convexApi.moderation.createChannelModerationCase, {
            action: action.value,
            ...(normalizeOptionalText(input.actorUserId)
                ? { actorUserId: normalizeOptionalText(input.actorUserId) }
                : {}),
            guildId: guildId.value,
            ...(normalizeOptionalText(input.reason) ? { reason: normalizeOptionalText(input.reason) } : {}),
            targetChannelId: targetChannelId.value,
        })) as ConvexModerationCaseRecord;

        return ok(toModerationCaseRecord(moderationCase));
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function createObservedModerationCase(
    db: ModerationDb,
    input: {
        action: string;
        details?: Record<string, unknown>;
        eventType: string;
        guildId: string;
        targetUserId: string;
    }
): Promise<Result<ModerationCaseRecord, ModerationRepositoryError>> {
    if (!isConvexPersistenceDatabase(db)) return createObservedModerationCasePostgres(db, input);

    const normalizedInput = normalizeObservedCaseInput(input);
    if (normalizedInput.isErr()) return err(normalizedInput.error);

    try {
        const moderationCase = (await db.client.mutation(
            convexApi.moderation.createObservedModerationCase,
            normalizedInput.value
        )) as ConvexModerationCaseRecord;

        return ok(toModerationCaseRecord(moderationCase));
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function findModerationCaseByGuildCaseNumber(
    db: ModerationDb,
    input: { caseNumber: number; guildId: string }
): Promise<Result<ModerationCaseRecord, ModerationRepositoryError>> {
    if (!isConvexPersistenceDatabase(db)) return findModerationCaseByGuildCaseNumberPostgres(db, input);

    const guildId = normalizeRequiredText(input.guildId, 'guildId');
    const caseNumber = normalizePositiveInteger(input.caseNumber, 'caseNumber');

    if (guildId.isErr()) return err(guildId.error);
    if (caseNumber.isErr()) return err(caseNumber.error);

    try {
        const moderationCase = (await db.client.query(convexApi.moderation.findModerationCaseByGuildCaseNumber, {
            caseNumber: caseNumber.value,
            guildId: guildId.value,
        })) as ConvexModerationCaseRecord | null;

        return moderationCase ? ok(toModerationCaseRecord(moderationCase)) : err({ type: 'not-found' });
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function listModerationCasesByGuildId(
    db: ModerationDb,
    input: { action?: string; guildId: string; limit?: number; status?: string; targetUserId?: string }
): Promise<Result<ModerationCaseRecord[], ModerationRepositoryError>> {
    if (!isConvexPersistenceDatabase(db)) return listModerationCasesByGuildIdPostgres(db, input);

    const guildId = normalizeRequiredText(input.guildId, 'guildId');
    const limit = normalizePositiveInteger(input.limit ?? 5, 'limit');

    if (guildId.isErr()) return err(guildId.error);
    if (limit.isErr()) return err(limit.error);

    try {
        const cases = (await db.client.query(convexApi.moderation.listModerationCasesByGuildId, {
            ...(normalizeOptionalText(input.action) ? { action: normalizeOptionalText(input.action) } : {}),
            guildId: guildId.value,
            limit: limit.value,
            ...(normalizeOptionalText(input.status) ? { status: normalizeOptionalText(input.status) } : {}),
            ...(normalizeOptionalText(input.targetUserId)
                ? { targetUserId: normalizeOptionalText(input.targetUserId) }
                : {}),
        })) as ConvexModerationCaseRecord[];

        return ok(cases.map(toModerationCaseRecord));
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function findRecentModerationCaseByTargetAction(
    db: ModerationDb,
    input: { action: string; guildId: string; since: Date; statuses?: readonly string[]; targetUserId: string }
): Promise<Result<ModerationCaseRecord, ModerationRepositoryError>> {
    if (!isConvexPersistenceDatabase(db)) return findRecentModerationCaseByTargetActionPostgres(db, input);

    const normalizedInput = normalizeRecentCaseInput(input);
    if (normalizedInput.isErr()) return err(normalizedInput.error);

    try {
        const moderationCase = (await db.client.query(
            convexApi.moderation.findRecentModerationCaseByTargetAction,
            normalizedInput.value
        )) as ConvexModerationCaseRecord | null;

        return moderationCase ? ok(toModerationCaseRecord(moderationCase)) : err({ type: 'not-found' });
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function recordModerationCaseEvent(
    db: ModerationDb,
    input: { actorUserId?: string; caseId: string; details?: Record<string, unknown>; eventType: string }
): Promise<Result<ModerationCaseEventRecord, ModerationRepositoryError>> {
    if (!isConvexPersistenceDatabase(db)) return recordModerationCaseEventPostgres(db, input);

    const normalizedInput = normalizeCaseEventInput(input);
    if (normalizedInput.isErr()) return err(normalizedInput.error);

    try {
        const event = (await db.client.mutation(
            convexApi.moderation.recordModerationCaseEvent,
            normalizedInput.value
        )) as ConvexModerationCaseEventRecord;

        return ok(toModerationCaseEventRecord(event));
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function listModerationCaseEventsByCaseId(
    db: ModerationDb,
    input: { caseId: string; eventType?: string; limit?: number }
): Promise<Result<ModerationCaseEventRecord[], ModerationRepositoryError>> {
    if (!isConvexPersistenceDatabase(db)) return listModerationCaseEventsByCaseIdPostgres(db, input);

    const caseId = normalizeRequiredText(input.caseId, 'caseId');
    const limit = normalizePositiveInteger(input.limit ?? 10, 'limit');

    if (caseId.isErr()) return err(caseId.error);
    if (limit.isErr()) return err(limit.error);

    try {
        const events = (await db.client.query(convexApi.moderation.listModerationCaseEventsByCaseId, {
            caseId: caseId.value,
            ...(normalizeOptionalText(input.eventType) ? { eventType: normalizeOptionalText(input.eventType) } : {}),
            limit: limit.value,
        })) as ConvexModerationCaseEventRecord[];

        return ok(events.map(toModerationCaseEventRecord));
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function updateModerationCaseStatus(
    db: ModerationDb,
    input: { caseId: string; status: string }
): Promise<Result<ModerationCaseRecord, ModerationRepositoryError>> {
    if (!isConvexPersistenceDatabase(db)) return updateModerationCaseStatusPostgres(db, input);

    const caseId = normalizeRequiredText(input.caseId, 'caseId');
    const status = normalizeRequiredText(input.status, 'status');

    if (caseId.isErr()) return err(caseId.error);
    if (status.isErr()) return err(status.error);

    try {
        const moderationCase = (await db.client.mutation(convexApi.moderation.updateModerationCaseStatus, {
            caseId: caseId.value,
            status: status.value,
        })) as ConvexModerationCaseRecord | null;

        return moderationCase ? ok(toModerationCaseRecord(moderationCase)) : err({ type: 'not-found' });
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function updateModerationCaseReason(
    db: ModerationDb,
    input: { actorUserId?: string; caseId: string; reason: string }
): Promise<Result<ModerationCaseRecord, ModerationRepositoryError>> {
    if (!isConvexPersistenceDatabase(db)) return updateModerationCaseReasonPostgres(db, input);

    const caseId = normalizeRequiredText(input.caseId, 'caseId');
    const reason = normalizeRequiredText(input.reason, 'reason');

    if (caseId.isErr()) return err(caseId.error);
    if (reason.isErr()) return err(reason.error);

    try {
        const moderationCase = (await db.client.mutation(convexApi.moderation.updateModerationCaseReason, {
            ...(normalizeOptionalText(input.actorUserId)
                ? { actorUserId: normalizeOptionalText(input.actorUserId) }
                : {}),
            caseId: caseId.value,
            reason: reason.value,
        })) as ConvexModerationCaseRecord | null;

        return moderationCase ? ok(toModerationCaseRecord(moderationCase)) : err({ type: 'not-found' });
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function voidModerationCase(
    db: ModerationDb,
    input: { actorUserId?: string; caseId: string; reason?: string }
): Promise<Result<ModerationCaseRecord, ModerationRepositoryError>> {
    if (!isConvexPersistenceDatabase(db)) return voidModerationCasePostgres(db, input);

    const caseId = normalizeRequiredText(input.caseId, 'caseId');

    if (caseId.isErr()) return err(caseId.error);

    try {
        const moderationCase = (await db.client.mutation(convexApi.moderation.voidModerationCase, {
            ...(normalizeOptionalText(input.actorUserId)
                ? { actorUserId: normalizeOptionalText(input.actorUserId) }
                : {}),
            caseId: caseId.value,
            ...(normalizeOptionalText(input.reason) ? { reason: normalizeOptionalText(input.reason) } : {}),
        })) as ConvexModerationCaseRecord | null;

        return moderationCase ? ok(toModerationCaseRecord(moderationCase)) : err({ type: 'not-found' });
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function addModerationCaseNote(
    db: ModerationDb,
    input: { actorUserId?: string; caseId: string; note: string }
): Promise<Result<ModerationCaseEventRecord, ModerationRepositoryError>> {
    if (!isConvexPersistenceDatabase(db)) return addModerationCaseNotePostgres(db, input);

    const note = normalizeRequiredText(input.note, 'note');
    const caseId = normalizeRequiredText(input.caseId, 'caseId');

    if (note.isErr()) return err(note.error);
    if (caseId.isErr()) return err(caseId.error);

    try {
        const event = (await db.client.mutation(convexApi.moderation.addModerationCaseNote, {
            ...(normalizeOptionalText(input.actorUserId)
                ? { actorUserId: normalizeOptionalText(input.actorUserId) }
                : {}),
            caseId: caseId.value,
            note: note.value,
        })) as ConvexModerationCaseEventRecord;

        return ok(toModerationCaseEventRecord(event));
    } catch {
        return err({ type: 'database-error' });
    }
}

function toModerationCaseRecord(record: ConvexModerationCaseRecord): ModerationCaseRecord {
    return { ...record, createdAt: new Date(record.createdAt), updatedAt: new Date(record.updatedAt) };
}

function toModerationCaseEventRecord(record: ConvexModerationCaseEventRecord): ModerationCaseEventRecord {
    return { ...record, createdAt: new Date(record.createdAt) };
}

function normalizeUserCaseInput(input: {
    action: string;
    actorUserId?: string;
    caseNumber?: number;
    guildId: string;
    reason?: string;
    targetUserId: string;
}): Result<Record<string, unknown>, ModerationRepositoryError> {
    const guildId = normalizeRequiredText(input.guildId, 'guildId');
    const action = normalizeRequiredText(input.action, 'action');
    const targetUserId = normalizeRequiredText(input.targetUserId, 'targetUserId');

    if (guildId.isErr()) return err(guildId.error);
    if (action.isErr()) return err(action.error);
    if (targetUserId.isErr()) return err(targetUserId.error);

    if (input.caseNumber !== undefined) {
        const caseNumber = normalizePositiveInteger(input.caseNumber, 'caseNumber');
        if (caseNumber.isErr()) return err(caseNumber.error);
    }

    return ok({
        action: action.value,
        ...(normalizeOptionalText(input.actorUserId) ? { actorUserId: normalizeOptionalText(input.actorUserId) } : {}),
        ...(input.caseNumber === undefined ? {} : { caseNumber: input.caseNumber }),
        guildId: guildId.value,
        ...(normalizeOptionalText(input.reason) ? { reason: normalizeOptionalText(input.reason) } : {}),
        targetUserId: targetUserId.value,
    });
}

function normalizeObservedCaseInput(input: {
    action: string;
    details?: Record<string, unknown>;
    eventType: string;
    guildId: string;
    targetUserId: string;
}): Result<Record<string, unknown>, ModerationRepositoryError> {
    const base = normalizeUserCaseInput(input);
    const eventType = normalizeRequiredText(input.eventType, 'eventType');

    if (base.isErr()) return err(base.error);
    if (eventType.isErr()) return err(eventType.error);

    return ok({ ...base.value, details: input.details ?? {}, eventType: eventType.value });
}

function normalizeRecentCaseInput(input: {
    action: string;
    guildId: string;
    since: Date;
    statuses?: readonly string[];
    targetUserId: string;
}): Result<Record<string, unknown>, ModerationRepositoryError> {
    const base = normalizeUserCaseInput(input);
    const since = normalizeDate(input.since, 'since');

    if (base.isErr()) return err(base.error);
    if (since.isErr()) return err(since.error);

    return ok({
        action: base.value.action,
        guildId: base.value.guildId,
        since: since.value.toISOString(),
        statuses: input.statuses?.map(normalizeOptionalText).filter((status): status is string => Boolean(status)),
        targetUserId: base.value.targetUserId,
    });
}

function normalizeCaseEventInput(input: {
    actorUserId?: string;
    caseId: string;
    details?: Record<string, unknown>;
    eventType: string;
}): Result<Record<string, unknown>, ModerationRepositoryError> {
    const caseId = normalizeRequiredText(input.caseId, 'caseId');
    const eventType = normalizeRequiredText(input.eventType, 'eventType');

    if (caseId.isErr()) return err(caseId.error);
    if (eventType.isErr()) return err(eventType.error);

    return ok({
        ...(normalizeOptionalText(input.actorUserId) ? { actorUserId: normalizeOptionalText(input.actorUserId) } : {}),
        caseId: caseId.value,
        details: input.details ?? {},
        eventType: eventType.value,
    });
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

function normalizePositiveInteger(value: number, field: string): Result<number, GuildFeatureRepositoryError> {
    return Number.isInteger(value) && value >= 1 ? ok(value) : err({ field, type: 'invalid-value' });
}

function normalizeDate(value: Date, field: string): Result<Date, GuildFeatureRepositoryError> {
    return value instanceof Date && !Number.isNaN(value.getTime()) ? ok(value) : err({ field, type: 'invalid-value' });
}

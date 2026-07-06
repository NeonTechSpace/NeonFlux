import { api } from '@neonflux/convex-api';
import { err, ok, type Result } from 'neverthrow';

import type { GuildFeatureRepositoryError } from './contracts.js';
import type {
    ModerationCaseEventRecord,
    ModerationCaseRecord,
    ModerationRepositoryError,
} from './contracts-moderation.js';

import type { ConvexDatabase } from './convex.js';
import { compactConvexArgs } from './convex-args.js';

type ModerationDb = ConvexDatabase;

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
    const normalizedInput = normalizeUserCaseInput(input);
    if (normalizedInput.isErr()) return err(normalizedInput.error);

    try {
        const moderationCase = await db.client.mutation(
            api.moderation.createModerationCase,
            compactConvexArgs(normalizedInput.value)
        );

        return ok(toModerationCaseRecord(moderationCase));
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function createChannelModerationCase(
    db: ModerationDb,
    input: { action: string; actorUserId?: string; guildId: string; reason?: string; targetChannelId: string }
): Promise<Result<ModerationCaseRecord, ModerationRepositoryError>> {
    const guildId = normalizeRequiredText(input.guildId, 'guildId');
    const action = normalizeRequiredText(input.action, 'action');
    const targetChannelId = normalizeRequiredText(input.targetChannelId, 'targetChannelId');

    if (guildId.isErr()) return err(guildId.error);
    if (action.isErr()) return err(action.error);
    if (targetChannelId.isErr()) return err(targetChannelId.error);

    try {
        const moderationCase = await db.client.mutation(
            api.moderation.createChannelModerationCase,
            compactConvexArgs({
                action: action.value,
                actorUserId: normalizeOptionalText(input.actorUserId),
                guildId: guildId.value,
                reason: normalizeOptionalText(input.reason),
                targetChannelId: targetChannelId.value,
            })
        );

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
    const normalizedInput = normalizeObservedCaseInput(input);
    if (normalizedInput.isErr()) return err(normalizedInput.error);

    try {
        const moderationCase = await db.client.mutation(
            api.moderation.createObservedModerationCase,
            normalizedInput.value
        );

        return ok(toModerationCaseRecord(moderationCase));
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function findModerationCaseByGuildCaseNumber(
    db: ModerationDb,
    input: { caseNumber: number; guildId: string }
): Promise<Result<ModerationCaseRecord, ModerationRepositoryError>> {
    const guildId = normalizeRequiredText(input.guildId, 'guildId');
    const caseNumber = normalizePositiveInteger(input.caseNumber, 'caseNumber');

    if (guildId.isErr()) return err(guildId.error);
    if (caseNumber.isErr()) return err(caseNumber.error);

    try {
        const moderationCase = await db.client.query(api.moderation.findModerationCaseByGuildCaseNumber, {
            caseNumber: caseNumber.value,
            guildId: guildId.value,
        });

        return moderationCase ? ok(toModerationCaseRecord(moderationCase)) : err({ type: 'not-found' });
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function listModerationCasesByGuildId(
    db: ModerationDb,
    input: { action?: string; guildId: string; limit?: number; status?: string; targetUserId?: string }
): Promise<Result<ModerationCaseRecord[], ModerationRepositoryError>> {
    const guildId = normalizeRequiredText(input.guildId, 'guildId');
    const limit = normalizePositiveInteger(input.limit ?? 5, 'limit');

    if (guildId.isErr()) return err(guildId.error);
    if (limit.isErr()) return err(limit.error);

    try {
        const cases = await db.client.query(
            api.moderation.listModerationCasesByGuildId,
            compactConvexArgs({
                action: normalizeOptionalText(input.action),
                guildId: guildId.value,
                limit: limit.value,
                status: normalizeOptionalText(input.status),
                targetUserId: normalizeOptionalText(input.targetUserId),
            })
        );

        return ok(cases.map(toModerationCaseRecord));
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function findRecentModerationCaseByTargetAction(
    db: ModerationDb,
    input: { action: string; guildId: string; since: Date; statuses?: readonly string[]; targetUserId: string }
): Promise<Result<ModerationCaseRecord, ModerationRepositoryError>> {
    const normalizedInput = normalizeRecentCaseInput(input);
    if (normalizedInput.isErr()) return err(normalizedInput.error);

    try {
        const moderationCase = await db.client.query(
            api.moderation.findRecentModerationCaseByTargetAction,
            compactConvexArgs(normalizedInput.value)
        );

        return moderationCase ? ok(toModerationCaseRecord(moderationCase)) : err({ type: 'not-found' });
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function recordModerationCaseEvent(
    db: ModerationDb,
    input: { actorUserId?: string; caseId: string; details?: Record<string, unknown>; eventType: string }
): Promise<Result<ModerationCaseEventRecord, ModerationRepositoryError>> {
    const normalizedInput = normalizeCaseEventInput(input);
    if (normalizedInput.isErr()) return err(normalizedInput.error);

    try {
        const event = await db.client.mutation(
            api.moderation.recordModerationCaseEvent,
            compactConvexArgs(normalizedInput.value)
        );

        return ok(toModerationCaseEventRecord(event));
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function listModerationCaseEventsByCaseId(
    db: ModerationDb,
    input: { caseId: string; eventType?: string; limit?: number }
): Promise<Result<ModerationCaseEventRecord[], ModerationRepositoryError>> {
    const caseId = normalizeRequiredText(input.caseId, 'caseId');
    const limit = normalizePositiveInteger(input.limit ?? 10, 'limit');

    if (caseId.isErr()) return err(caseId.error);
    if (limit.isErr()) return err(limit.error);

    try {
        const events = await db.client.query(
            api.moderation.listModerationCaseEventsByCaseId,
            compactConvexArgs({
                caseId: caseId.value,
                eventType: normalizeOptionalText(input.eventType),
                limit: limit.value,
            })
        );

        return ok(events.map(toModerationCaseEventRecord));
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function updateModerationCaseStatus(
    db: ModerationDb,
    input: { caseId: string; status: string }
): Promise<Result<ModerationCaseRecord, ModerationRepositoryError>> {
    const caseId = normalizeRequiredText(input.caseId, 'caseId');
    const status = normalizeRequiredText(input.status, 'status');

    if (caseId.isErr()) return err(caseId.error);
    if (status.isErr()) return err(status.error);

    try {
        const moderationCase = await db.client.mutation(api.moderation.updateModerationCaseStatus, {
            caseId: caseId.value,
            status: status.value,
        });

        return moderationCase ? ok(toModerationCaseRecord(moderationCase)) : err({ type: 'not-found' });
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function updateModerationCaseReason(
    db: ModerationDb,
    input: { actorUserId?: string; caseId: string; reason: string }
): Promise<Result<ModerationCaseRecord, ModerationRepositoryError>> {
    const caseId = normalizeRequiredText(input.caseId, 'caseId');
    const reason = normalizeRequiredText(input.reason, 'reason');

    if (caseId.isErr()) return err(caseId.error);
    if (reason.isErr()) return err(reason.error);

    try {
        const moderationCase = await db.client.mutation(
            api.moderation.updateModerationCaseReason,
            compactConvexArgs({
                actorUserId: normalizeOptionalText(input.actorUserId),
                caseId: caseId.value,
                reason: reason.value,
            })
        );

        return moderationCase ? ok(toModerationCaseRecord(moderationCase)) : err({ type: 'not-found' });
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function voidModerationCase(
    db: ModerationDb,
    input: { actorUserId?: string; caseId: string; reason?: string }
): Promise<Result<ModerationCaseRecord, ModerationRepositoryError>> {
    const caseId = normalizeRequiredText(input.caseId, 'caseId');

    if (caseId.isErr()) return err(caseId.error);

    try {
        const moderationCase = await db.client.mutation(
            api.moderation.voidModerationCase,
            compactConvexArgs({
                actorUserId: normalizeOptionalText(input.actorUserId),
                caseId: caseId.value,
                reason: normalizeOptionalText(input.reason),
            })
        );

        return moderationCase ? ok(toModerationCaseRecord(moderationCase)) : err({ type: 'not-found' });
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function addModerationCaseNote(
    db: ModerationDb,
    input: { actorUserId?: string; caseId: string; note: string }
): Promise<Result<ModerationCaseEventRecord, ModerationRepositoryError>> {
    const note = normalizeRequiredText(input.note, 'note');
    const caseId = normalizeRequiredText(input.caseId, 'caseId');

    if (note.isErr()) return err(note.error);
    if (caseId.isErr()) return err(caseId.error);

    try {
        const event = await db.client.mutation(
            api.moderation.addModerationCaseNote,
            compactConvexArgs({
                actorUserId: normalizeOptionalText(input.actorUserId),
                caseId: caseId.value,
                note: note.value,
            })
        );

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
}) {
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
}) {
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
}) {
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
}) {
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

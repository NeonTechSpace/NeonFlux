import { api } from '@neonflux/convex-api';
import { err, ok, type Result } from 'neverthrow';

import type {
    GuildFeatureRepositoryError,
    ModerationTemporaryActionRecord,
    ModerationTemporaryActionRepositoryError,
    ModerationTemporaryActionStatus,
} from './contracts.js';

import type { ConvexDatabase } from './convex.js';
import { compactConvexArgs } from './convex-args.js';

type TemporaryActionDb = ConvexDatabase;

type ConvexModerationTemporaryActionRecord = Omit<
    ModerationTemporaryActionRecord,
    'createdAt' | 'expiresAt' | 'updatedAt'
> & {
    createdAt: string;
    expiresAt: string;
    updatedAt: string;
};

const temporaryActionStatuses = new Set<ModerationTemporaryActionStatus>([
    'cancelled',
    'completed',
    'failed',
    'pending',
]);

export async function createModerationTemporaryAction(
    db: TemporaryActionDb,
    input: { action: string; caseId?: string; expiresAt: Date; guildId: string; targetUserId: string }
): Promise<Result<ModerationTemporaryActionRecord, ModerationTemporaryActionRepositoryError>> {
    const normalizedInput = normalizeTemporaryActionInput(input);
    if (normalizedInput.isErr()) return err(normalizedInput.error);

    try {
        const action = await db.client.mutation(
            api.moderation_temporary_actions.createModerationTemporaryAction,
            compactConvexArgs(normalizedInput.value)
        );

        return ok(toTemporaryActionRecord(action));
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function findPendingModerationTemporaryActionByTarget(
    db: TemporaryActionDb,
    input: { action: string; guildId: string; now?: Date; targetUserId: string }
): Promise<Result<ModerationTemporaryActionRecord, ModerationTemporaryActionRepositoryError>> {
    const normalizedInput = normalizeTemporaryActionTargetInput(input);
    const now = normalizeDate(input.now ?? new Date(), 'now');

    if (normalizedInput.isErr()) return err(normalizedInput.error);
    if (now.isErr()) return err(now.error);

    try {
        const action = await db.client.query(
            api.moderation_temporary_actions.findPendingModerationTemporaryActionByTarget,
            {
                ...normalizedInput.value,
                now: now.value.toISOString(),
            }
        );

        return action ? ok(toTemporaryActionRecord(action)) : err({ type: 'not-found' });
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function listDueModerationTemporaryActions(
    db: TemporaryActionDb,
    input: { action?: string; limit?: number; now: Date }
): Promise<Result<ModerationTemporaryActionRecord[], ModerationTemporaryActionRepositoryError>> {
    const now = normalizeDate(input.now, 'now');
    const limit = normalizePositiveInteger(input.limit ?? 25, 'limit');

    if (now.isErr()) return err(now.error);
    if (limit.isErr()) return err(limit.error);

    try {
        const actions = await db.client.query(
            api.moderation_temporary_actions.listDueModerationTemporaryActions,
            compactConvexArgs({
                action: normalizeOptionalText(input.action),
                limit: limit.value,
                now: now.value.toISOString(),
            })
        );

        return ok(actions.map(toTemporaryActionRecord));
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function cancelPendingModerationTemporaryActionsByTarget(
    db: TemporaryActionDb,
    input: { action: string; excludeId?: string; guildId: string; targetUserId: string }
): Promise<Result<ModerationTemporaryActionRecord[], ModerationTemporaryActionRepositoryError>> {
    const normalizedInput = normalizeTemporaryActionTargetInput(input);
    if (normalizedInput.isErr()) return err(normalizedInput.error);

    try {
        const actions = await db.client.mutation(
            api.moderation_temporary_actions.cancelPendingModerationTemporaryActionsByTarget,
            compactConvexArgs({
                ...normalizedInput.value,
                excludeId: normalizeOptionalText(input.excludeId),
            })
        );

        return ok(actions.map(toTemporaryActionRecord));
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function updateModerationTemporaryActionStatus(
    db: TemporaryActionDb,
    input: { id: string; status: ModerationTemporaryActionStatus }
): Promise<Result<ModerationTemporaryActionRecord, ModerationTemporaryActionRepositoryError>> {
    const id = normalizeRequiredText(input.id, 'id');
    const status = normalizeTemporaryActionStatus(input.status);

    if (id.isErr()) return err(id.error);
    if (status.isErr()) return err(status.error);

    try {
        const action = await db.client.mutation(
            api.moderation_temporary_actions.updateModerationTemporaryActionStatus,
            {
                id: id.value,
                status: status.value,
            }
        );

        return action ? ok(toTemporaryActionRecord(action)) : err({ type: 'not-found' });
    } catch {
        return err({ type: 'database-error' });
    }
}

function toTemporaryActionRecord(record: ConvexModerationTemporaryActionRecord): ModerationTemporaryActionRecord {
    return {
        ...record,
        createdAt: new Date(record.createdAt),
        expiresAt: new Date(record.expiresAt),
        updatedAt: new Date(record.updatedAt),
    };
}

function normalizeTemporaryActionInput(input: {
    action: string;
    caseId?: string;
    expiresAt: Date;
    guildId: string;
    targetUserId: string;
}) {
    const targetInput = normalizeTemporaryActionTargetInput(input);
    const expiresAt = normalizeDate(input.expiresAt, 'expiresAt');

    if (targetInput.isErr()) return err(targetInput.error);
    if (expiresAt.isErr()) return err(expiresAt.error);

    return ok({
        ...targetInput.value,
        ...(normalizeOptionalText(input.caseId) ? { caseId: normalizeOptionalText(input.caseId) } : {}),
        expiresAt: expiresAt.value.toISOString(),
    });
}

function normalizeTemporaryActionTargetInput(input: {
    action: string;
    guildId: string;
    targetUserId: string;
}): Result<{ action: string; guildId: string; targetUserId: string }, ModerationTemporaryActionRepositoryError> {
    const guildId = normalizeRequiredText(input.guildId, 'guildId');
    const action = normalizeRequiredText(input.action, 'action');
    const targetUserId = normalizeRequiredText(input.targetUserId, 'targetUserId');

    if (guildId.isErr()) return err(guildId.error);
    if (action.isErr()) return err(action.error);
    if (targetUserId.isErr()) return err(targetUserId.error);

    return ok({ action: action.value, guildId: guildId.value, targetUserId: targetUserId.value });
}

function normalizeTemporaryActionStatus(
    value: string
): Result<ModerationTemporaryActionStatus, ModerationTemporaryActionRepositoryError> {
    const status = normalizeRequiredText(value, 'status');

    if (status.isErr()) return err(status.error);
    if (!temporaryActionStatuses.has(status.value as ModerationTemporaryActionStatus)) {
        return err({ field: 'status', type: 'invalid-value' });
    }

    return ok(status.value as ModerationTemporaryActionStatus);
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

import { api } from '@neonflux/convex-api';
import type {
    GeneratedVoiceChannelControlRecord,
    VcGeneratorControlAction,
    VcGeneratorControlRequestError,
    VcGeneratorControlRequestRecord,
    VcGeneratorControlRequestStatus,
} from './contracts-vc-generator.js';
import { err, ok, type Result } from 'neverthrow';

import type { ConvexDatabase } from './convex.js';
import type { GuildFeatureRepositoryError } from './contracts.js';

type VcGeneratorControlRequestDb = ConvexDatabase;

type ConvexGeneratedVoiceChannelRecord = Omit<
    GeneratedVoiceChannelControlRecord,
    'createdAt' | 'lastSeenAt' | 'updatedAt'
> & {
    createdAt: string;
    lastSeenAt: string;
    updatedAt: string;
};
type ConvexVcGeneratorControlRequestRecord = Omit<
    VcGeneratorControlRequestRecord,
    'completedAt' | 'createdAt' | 'expiresAt' | 'updatedAt'
> & {
    completedAt: string | null;
    createdAt: string;
    expiresAt: string;
    updatedAt: string;
};

const controlActions = new Set<VcGeneratorControlAction>([
    'blacklist',
    'lock',
    'rename',
    'unlock',
    'user_limit',
    'whitelist',
]);
const controlRequestStatuses = new Set<VcGeneratorControlRequestStatus>([
    'applied',
    'cancelled',
    'expired',
    'failed',
    'pending',
]);

export async function findActiveGeneratedVoiceChannelByOwner(
    db: VcGeneratorControlRequestDb,
    input: { guildId: string; ownerUserId: string; ruleId?: string }
): Promise<Result<GeneratedVoiceChannelControlRecord, VcGeneratorControlRequestError>> {
    const normalizedInput = normalizeOwnerLookupInput(input);
    if (normalizedInput.isErr()) return err(normalizedInput.error);

    try {
        const channel = await db.client.query(
            api.vc_generator_control_requests.findActiveGeneratedVoiceChannelByOwner,
            normalizedInput.value
        );

        return channel ? ok(toGeneratedChannelRecord(channel)) : err({ type: 'not-found' });
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function createVcGeneratorControlRequest(
    db: VcGeneratorControlRequestDb,
    input: {
        controlAction: string;
        expiresAt: Date;
        generatedChannelId: string;
        guildId: string;
        panelChannelId: string;
        promptMessageId?: string;
        requesterUserId: string;
        status?: string;
        targetChannelId: string;
    }
): Promise<Result<VcGeneratorControlRequestRecord, VcGeneratorControlRequestError>> {
    const normalizedInput = normalizeControlRequestInput(input);
    if (normalizedInput.isErr()) return err(normalizedInput.error);

    try {
        const request = await db.client.mutation(
            api.vc_generator_control_requests.createVcGeneratorControlRequest,
            normalizedInput.value
        );

        return ok(toControlRequestRecord(request));
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function findPendingVcGeneratorControlRequest(
    db: VcGeneratorControlRequestDb,
    input: { guildId: string; panelChannelId: string; requesterUserId: string }
): Promise<Result<VcGeneratorControlRequestRecord, VcGeneratorControlRequestError>> {
    const normalizedInput = normalizePendingLookupInput(input);
    if (normalizedInput.isErr()) return err(normalizedInput.error);

    try {
        const request = await db.client.query(
            api.vc_generator_control_requests.findPendingVcGeneratorControlRequest,
            normalizedInput.value
        );

        return request ? ok(toControlRequestRecord(request)) : err({ type: 'not-found' });
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function updateVcGeneratorControlRequest(
    db: VcGeneratorControlRequestDb,
    input: { errorMessage?: string; promptMessageId?: string; requestId: string; status?: string; value?: string }
): Promise<Result<VcGeneratorControlRequestRecord, VcGeneratorControlRequestError>> {
    const normalizedInput = normalizeControlRequestUpdateInput(input);
    if (normalizedInput.isErr()) return err(normalizedInput.error);

    try {
        const request = await db.client.mutation(
            api.vc_generator_control_requests.updateVcGeneratorControlRequest,
            normalizedInput.value
        );

        return request ? ok(toControlRequestRecord(request)) : err({ type: 'not-found' });
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function expirePendingVcGeneratorControlRequests(
    db: VcGeneratorControlRequestDb,
    input: { limit?: number; now: Date }
): Promise<Result<VcGeneratorControlRequestRecord[], VcGeneratorControlRequestError>> {
    const now = normalizeDate(input.now, 'now');
    const limit = normalizePositiveLimit(input.limit);

    if (now.isErr()) return err(now.error);
    if (limit.isErr()) return err(limit.error);

    try {
        const requests = await db.client.mutation(
            api.vc_generator_control_requests.expirePendingVcGeneratorControlRequests,
            {
                limit: limit.value,
                now: now.value.toISOString(),
            }
        );

        return ok(requests.map(toControlRequestRecord));
    } catch {
        return err({ type: 'database-error' });
    }
}

function toGeneratedChannelRecord(record: ConvexGeneratedVoiceChannelRecord): GeneratedVoiceChannelControlRecord {
    return {
        ...record,
        createdAt: new Date(record.createdAt),
        lastSeenAt: new Date(record.lastSeenAt),
        updatedAt: new Date(record.updatedAt),
    };
}

function toControlRequestRecord(record: ConvexVcGeneratorControlRequestRecord): VcGeneratorControlRequestRecord {
    return {
        ...record,
        completedAt: record.completedAt ? new Date(record.completedAt) : null,
        createdAt: new Date(record.createdAt),
        expiresAt: new Date(record.expiresAt),
        updatedAt: new Date(record.updatedAt),
    };
}

function normalizeOwnerLookupInput(input: {
    guildId: string;
    ownerUserId: string;
    ruleId?: string;
}): Result<{ guildId: string; ownerUserId: string; ruleId?: string }, VcGeneratorControlRequestError> {
    const guildId = normalizeRequiredText(input.guildId, 'guildId');
    const ownerUserId = normalizeRequiredText(input.ownerUserId, 'ownerUserId');
    const ruleId = normalizeOptionalText(input.ruleId);

    if (guildId.isErr()) return err(guildId.error);
    if (ownerUserId.isErr()) return err(ownerUserId.error);

    return ok({
        guildId: guildId.value,
        ownerUserId: ownerUserId.value,
        ...(ruleId ? { ruleId } : {}),
    });
}

function normalizeControlRequestInput(input: {
    controlAction: string;
    expiresAt: Date;
    generatedChannelId: string;
    guildId: string;
    panelChannelId: string;
    promptMessageId?: string;
    requesterUserId: string;
    status?: string;
    targetChannelId: string;
}) {
    const pendingLookup = normalizePendingLookupInput(input);
    const generatedChannelId = normalizeRequiredText(input.generatedChannelId, 'generatedChannelId');
    const targetChannelId = normalizeRequiredText(input.targetChannelId, 'targetChannelId');
    const controlAction = normalizeControlAction(input.controlAction);
    const expiresAt = normalizeDate(input.expiresAt, 'expiresAt');
    const promptMessageId = normalizeOptionalText(input.promptMessageId);
    let status: VcGeneratorControlRequestStatus | undefined;

    if (pendingLookup.isErr()) return err(pendingLookup.error);
    if (generatedChannelId.isErr()) return err(generatedChannelId.error);
    if (targetChannelId.isErr()) return err(targetChannelId.error);
    if (controlAction.isErr()) return err(controlAction.error);
    if (expiresAt.isErr()) return err(expiresAt.error);
    if (input.status !== undefined) {
        const statusResult = normalizeControlRequestStatus(input.status);
        if (statusResult.isErr()) return err(statusResult.error);
        status = statusResult.value;
    }

    return ok({
        ...pendingLookup.value,
        controlAction: controlAction.value,
        expiresAt: expiresAt.value.toISOString(),
        generatedChannelId: generatedChannelId.value,
        ...(promptMessageId ? { promptMessageId } : {}),
        ...(status ? { status } : {}),
        targetChannelId: targetChannelId.value,
    });
}

function normalizePendingLookupInput(input: {
    guildId: string;
    panelChannelId: string;
    requesterUserId: string;
}): Result<{ guildId: string; panelChannelId: string; requesterUserId: string }, VcGeneratorControlRequestError> {
    const guildId = normalizeRequiredText(input.guildId, 'guildId');
    const panelChannelId = normalizeRequiredText(input.panelChannelId, 'panelChannelId');
    const requesterUserId = normalizeRequiredText(input.requesterUserId, 'requesterUserId');

    if (guildId.isErr()) return err(guildId.error);
    if (panelChannelId.isErr()) return err(panelChannelId.error);
    if (requesterUserId.isErr()) return err(requesterUserId.error);

    return ok({
        guildId: guildId.value,
        panelChannelId: panelChannelId.value,
        requesterUserId: requesterUserId.value,
    });
}

function normalizeControlRequestUpdateInput(input: {
    errorMessage?: string;
    promptMessageId?: string;
    requestId: string;
    status?: string;
    value?: string;
}) {
    const requestId = normalizeRequiredText(input.requestId, 'requestId');
    let status: VcGeneratorControlRequestStatus | undefined;

    if (requestId.isErr()) return err(requestId.error);
    if (input.status !== undefined) {
        const statusResult = normalizeControlRequestStatus(input.status);
        if (statusResult.isErr()) return err(statusResult.error);
        status = statusResult.value;
    }

    return ok({
        ...(input.errorMessage === undefined
            ? {}
            : { errorMessage: normalizeOptionalText(input.errorMessage) ?? null }),
        ...(input.promptMessageId === undefined
            ? {}
            : { promptMessageId: normalizeOptionalText(input.promptMessageId) ?? null }),
        requestId: requestId.value,
        ...(status ? { status } : {}),
        ...(input.value === undefined ? {} : { value: normalizeOptionalText(input.value) ?? null }),
    });
}

function normalizeControlAction(value: string): Result<VcGeneratorControlAction, VcGeneratorControlRequestError> {
    return controlActions.has(value as VcGeneratorControlAction)
        ? ok(value as VcGeneratorControlAction)
        : err({ field: 'controlAction', type: 'invalid-value' });
}

function normalizeControlRequestStatus(
    value: string
): Result<VcGeneratorControlRequestStatus, VcGeneratorControlRequestError> {
    return controlRequestStatuses.has(value as VcGeneratorControlRequestStatus)
        ? ok(value as VcGeneratorControlRequestStatus)
        : err({ field: 'status', type: 'invalid-value' });
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

function normalizeDate(value: Date, field: string): Result<Date, GuildFeatureRepositoryError> {
    return value instanceof Date && !Number.isNaN(value.getTime()) ? ok(value) : err({ field, type: 'invalid-value' });
}

function normalizePositiveLimit(value: number | undefined): Result<number, GuildFeatureRepositoryError> {
    if (value === undefined) return ok(25);
    return Number.isInteger(value) && value > 0
        ? ok(Math.min(value, 100))
        : err({ field: 'limit', type: 'invalid-value' });
}

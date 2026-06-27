import { and, asc, desc, eq, inArray, lte } from 'drizzle-orm';
import { err, ok, type Result } from 'neverthrow';

import {
    normalizeOptionalText,
    normalizeRequiredText,
    type GuildFeatureRepositoryDatabase,
    type GuildFeatureRepositoryError,
} from './feature-repository-types.js';
import { generatedVoiceChannels, vcGeneratorControlRequests } from './schema.js';

export type VcGeneratorControlAction = 'rename' | 'user_limit' | 'whitelist' | 'blacklist' | 'lock' | 'unlock';
export type VcGeneratorControlRequestStatus = 'pending' | 'applied' | 'failed' | 'cancelled' | 'expired';
export type GeneratedVoiceChannelControlRecord = typeof generatedVoiceChannels.$inferSelect;
export type VcGeneratorControlRequestRecord = typeof vcGeneratorControlRequests.$inferSelect;
export type VcGeneratorControlRequestError = GuildFeatureRepositoryError;

const controlActions = new Set<VcGeneratorControlAction>([
    'rename',
    'user_limit',
    'whitelist',
    'blacklist',
    'lock',
    'unlock',
]);
const requestStatuses = new Set<VcGeneratorControlRequestStatus>([
    'pending',
    'applied',
    'failed',
    'cancelled',
    'expired',
]);

export async function findActiveGeneratedVoiceChannelByOwner(
    db: GuildFeatureRepositoryDatabase,
    input: { guildId: string; ownerUserId: string; ruleId?: string }
): Promise<Result<GeneratedVoiceChannelControlRecord, VcGeneratorControlRequestError>> {
    const guildId = normalizeRequiredText(input.guildId, 'guildId');
    const ownerUserId = normalizeRequiredText(input.ownerUserId, 'ownerUserId');

    if (guildId.isErr()) return err(guildId.error);
    if (ownerUserId.isErr()) return err(ownerUserId.error);

    try {
        const rows = await db
            .select()
            .from(generatedVoiceChannels)
            .where(
                and(
                    eq(generatedVoiceChannels.guildId, guildId.value),
                    eq(generatedVoiceChannels.ownerUserId, ownerUserId.value),
                    eq(generatedVoiceChannels.status, 'active'),
                    ...(input.ruleId ? [eq(generatedVoiceChannels.ruleId, input.ruleId)] : [])
                )
            )
            .orderBy(desc(generatedVoiceChannels.createdAt))
            .limit(1);
        const row = rows[0];

        return row ? ok(row) : err({ type: 'not-found' } satisfies GuildFeatureRepositoryError);
    } catch {
        return err({ type: 'database-error' } satisfies GuildFeatureRepositoryError);
    }
}

export async function createVcGeneratorControlRequest(
    db: GuildFeatureRepositoryDatabase,
    input: {
        guildId: string;
        generatedChannelId: string;
        panelChannelId: string;
        targetChannelId: string;
        requesterUserId: string;
        controlAction: string;
        expiresAt: Date;
        promptMessageId?: string;
        status?: string;
    }
): Promise<Result<VcGeneratorControlRequestRecord, VcGeneratorControlRequestError>> {
    const normalized = normalizeControlRequestInput(input);
    if (normalized.isErr()) return err(normalized.error);
    if (input.status && !isControlRequestStatus(input.status)) return err({ type: 'invalid-value', field: 'status' });

    try {
        const status = input.status ?? 'pending';
        const updatedAt = new Date();

        if (status === 'pending') {
            await db
                .update(vcGeneratorControlRequests)
                .set({
                    status: 'cancelled',
                    errorMessage: 'replaced-by-new-request',
                    completedAt: updatedAt,
                    updatedAt,
                })
                .where(
                    and(
                        eq(vcGeneratorControlRequests.guildId, normalized.value.guildId),
                        eq(vcGeneratorControlRequests.panelChannelId, normalized.value.panelChannelId),
                        eq(vcGeneratorControlRequests.requesterUserId, normalized.value.requesterUserId),
                        eq(vcGeneratorControlRequests.status, 'pending')
                    )
                );
        }

        const rows = await db
            .insert(vcGeneratorControlRequests)
            .values({
                ...normalized.value,
                promptMessageId: normalizeOptionalText(input.promptMessageId),
                status,
            })
            .returning();
        const row = rows[0];

        return row ? ok(row) : err({ type: 'database-error' });
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function findPendingVcGeneratorControlRequest(
    db: GuildFeatureRepositoryDatabase,
    input: { guildId: string; panelChannelId: string; requesterUserId: string }
): Promise<Result<VcGeneratorControlRequestRecord, VcGeneratorControlRequestError>> {
    const guildId = normalizeRequiredText(input.guildId, 'guildId');
    const panelChannelId = normalizeRequiredText(input.panelChannelId, 'panelChannelId');
    const requesterUserId = normalizeRequiredText(input.requesterUserId, 'requesterUserId');

    if (guildId.isErr()) return err(guildId.error);
    if (panelChannelId.isErr()) return err(panelChannelId.error);
    if (requesterUserId.isErr()) return err(requesterUserId.error);

    try {
        const rows = await db
            .select()
            .from(vcGeneratorControlRequests)
            .where(
                and(
                    eq(vcGeneratorControlRequests.guildId, guildId.value),
                    eq(vcGeneratorControlRequests.panelChannelId, panelChannelId.value),
                    eq(vcGeneratorControlRequests.requesterUserId, requesterUserId.value),
                    eq(vcGeneratorControlRequests.status, 'pending')
                )
            )
            .orderBy(desc(vcGeneratorControlRequests.createdAt))
            .limit(1);
        const row = rows[0];

        return row ? ok(row) : err({ type: 'not-found' });
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function updateVcGeneratorControlRequest(
    db: GuildFeatureRepositoryDatabase,
    input: { requestId: string; status?: string; promptMessageId?: string; value?: string; errorMessage?: string }
): Promise<Result<VcGeneratorControlRequestRecord, VcGeneratorControlRequestError>> {
    const requestId = normalizeRequiredText(input.requestId, 'requestId');
    const updatedAt = new Date();

    if (requestId.isErr()) return err(requestId.error);
    if (input.status && !isControlRequestStatus(input.status)) return err({ type: 'invalid-value', field: 'status' });

    try {
        const rows = await db
            .update(vcGeneratorControlRequests)
            .set({
                ...(input.status ? { status: input.status } : {}),
                ...(input.promptMessageId !== undefined
                    ? { promptMessageId: normalizeOptionalText(input.promptMessageId) }
                    : {}),
                ...(input.value !== undefined ? { value: normalizeOptionalText(input.value) ?? null } : {}),
                ...(input.errorMessage !== undefined
                    ? { errorMessage: normalizeOptionalText(input.errorMessage) ?? null }
                    : {}),
                ...(input.status && input.status !== 'pending' ? { completedAt: updatedAt } : {}),
                updatedAt,
            })
            .where(eq(vcGeneratorControlRequests.id, requestId.value))
            .returning();
        const row = rows[0];

        return row ? ok(row) : err({ type: 'not-found' });
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function expirePendingVcGeneratorControlRequests(
    db: GuildFeatureRepositoryDatabase,
    input: { now: Date; limit?: number }
): Promise<Result<VcGeneratorControlRequestRecord[], VcGeneratorControlRequestError>> {
    const now = normalizeDate(input.now, 'now');
    const limit = normalizeLimit(input.limit);

    if (now.isErr()) return err(now.error);
    if (limit.isErr()) return err(limit.error);

    try {
        const dueRows = await db
            .select()
            .from(vcGeneratorControlRequests)
            .where(
                and(
                    eq(vcGeneratorControlRequests.status, 'pending'),
                    lte(vcGeneratorControlRequests.expiresAt, now.value)
                )
            )
            .orderBy(asc(vcGeneratorControlRequests.expiresAt))
            .limit(limit.value);

        if (dueRows.length === 0) {
            return ok([]);
        }

        const rows = await db
            .update(vcGeneratorControlRequests)
            .set({
                status: 'expired',
                errorMessage: 'expired-by-maintenance',
                completedAt: now.value,
                updatedAt: now.value,
            })
            .where(
                inArray(
                    vcGeneratorControlRequests.id,
                    dueRows.map((row) => row.id)
                )
            )
            .returning();

        return ok(rows);
    } catch {
        return err({ type: 'database-error' });
    }
}

function normalizeControlRequestInput(input: {
    guildId: string;
    generatedChannelId: string;
    panelChannelId: string;
    targetChannelId: string;
    requesterUserId: string;
    controlAction: string;
    expiresAt: Date;
}): Result<
    {
        guildId: string;
        generatedChannelId: string;
        panelChannelId: string;
        targetChannelId: string;
        requesterUserId: string;
        controlAction: VcGeneratorControlAction;
        expiresAt: Date;
    },
    VcGeneratorControlRequestError
> {
    const guildId = normalizeRequiredText(input.guildId, 'guildId');
    const generatedChannelId = normalizeRequiredText(input.generatedChannelId, 'generatedChannelId');
    const panelChannelId = normalizeRequiredText(input.panelChannelId, 'panelChannelId');
    const targetChannelId = normalizeRequiredText(input.targetChannelId, 'targetChannelId');
    const requesterUserId = normalizeRequiredText(input.requesterUserId, 'requesterUserId');

    if (guildId.isErr()) return err(guildId.error);
    if (generatedChannelId.isErr()) return err(generatedChannelId.error);
    if (panelChannelId.isErr()) return err(panelChannelId.error);
    if (targetChannelId.isErr()) return err(targetChannelId.error);
    if (requesterUserId.isErr()) return err(requesterUserId.error);
    if (!isControlAction(input.controlAction)) return err({ type: 'invalid-value', field: 'controlAction' });
    if (!(input.expiresAt instanceof Date) || Number.isNaN(input.expiresAt.getTime())) {
        return err({ type: 'invalid-value', field: 'expiresAt' });
    }

    return ok({
        guildId: guildId.value,
        generatedChannelId: generatedChannelId.value,
        panelChannelId: panelChannelId.value,
        targetChannelId: targetChannelId.value,
        requesterUserId: requesterUserId.value,
        controlAction: input.controlAction,
        expiresAt: input.expiresAt,
    });
}

function normalizeDate(value: Date, field: string): Result<Date, VcGeneratorControlRequestError> {
    if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
        return err({ type: 'invalid-value', field });
    }

    return ok(value);
}

function normalizeLimit(value: number | undefined): Result<number, VcGeneratorControlRequestError> {
    if (value === undefined) {
        return ok(25);
    }

    if (!Number.isInteger(value) || value <= 0) {
        return err({ type: 'invalid-value', field: 'limit' });
    }

    return ok(Math.min(value, 100));
}

function isControlAction(action: string): action is VcGeneratorControlAction {
    return controlActions.has(action as VcGeneratorControlAction);
}

function isControlRequestStatus(status: string): status is VcGeneratorControlRequestStatus {
    return requestStatuses.has(status as VcGeneratorControlRequestStatus);
}

import type { GenericId } from 'convex/values';

export type GiveawayStatus = 'active' | 'cancelled' | 'closed' | 'draft';
export type GiveawaySyncStatus = 'active' | 'stale';

export type GiveawayInput = {
    channelId?: string | null;
    closedAt?: string | null;
    closedByUserId?: string | null;
    config?: Record<string, unknown> | null;
    createdAt?: string | null;
    createdByUserId?: string | null;
    description?: string | null;
    endsAt?: string | null;
    entryEmoji?: string | null;
    guildId?: string | null;
    messageId?: string | null;
    prize?: string | null;
    status?: string | null;
    title?: string | null;
    updatedAt?: string | null;
    winnerCount?: number | null;
};

export type GiveawayDocument = {
    channelId: string;
    closedAt?: string;
    closedByUserId?: string;
    config: Record<string, unknown>;
    createdAt: string;
    createdByUserId?: string;
    description?: string;
    endsAt?: string;
    entryEmoji: string;
    guildId: string;
    messageId?: string;
    prize: string;
    status: GiveawayStatus;
    title: string;
    updatedAt: string;
    winnerCount: number;
};

export type GiveawayEntryInput = {
    enteredAt?: string | null;
    giveawayId?: string | null;
    removedAt?: string | null;
    userId?: string | null;
};

export type GiveawayEntryDocument = {
    enteredAt: string;
    giveawayId: GenericId<'giveaways'>;
    removedAt?: string;
    userId: string;
};

export type GiveawayWinnerInput = {
    drawNumber?: number | null;
    giveawayId?: string | null;
    selectedAt?: string | null;
    userId?: string | null;
};

export type GiveawayWinnerDocument = {
    drawNumber: number;
    giveawayId: GenericId<'giveaways'>;
    selectedAt: string;
    userId: string;
};

export type GiveawayEventInput = {
    actorUserId?: string | null;
    createdAt?: string | null;
    details?: Record<string, unknown> | null;
    eventType?: string | null;
    giveawayId?: string | null;
};

export type GiveawayEventDocument = {
    actorUserId?: string;
    createdAt: string;
    details: Record<string, unknown>;
    eventType: string;
    giveawayId: GenericId<'giveaways'>;
};

export type GiveawayInputError =
    | { field: string; type: 'invalid-value' | 'missing-input' }
    | { from: string; to: string; type: 'invalid-status-transition' };
export type GiveawayInputResult<Value> = { ok: true; value: Value } | { error: GiveawayInputError; ok: false };

const statusTransitions = new Map<GiveawayStatus, readonly GiveawayStatus[]>([
    ['draft', ['active', 'cancelled']],
    ['active', ['closed', 'cancelled']],
    ['closed', []],
    ['cancelled', []],
]);

export function buildGiveawayDocument(input: GiveawayInput, now: string): GiveawayInputResult<GiveawayDocument> {
    const guildId = normalizeRequiredString(input.guildId, 'guildId');
    const channelId = normalizeRequiredString(input.channelId, 'channelId');
    const title = normalizeRequiredString(input.title, 'title');
    const prize = normalizeRequiredString(input.prize, 'prize');
    const status = normalizeStatus(input.status ?? 'draft');
    const winnerCount = normalizePositiveInteger(input.winnerCount ?? 1, 'winnerCount');
    const entryEmoji = normalizeRequiredString(input.entryEmoji ?? '\u{1f389}', 'entryEmoji');
    const config = normalizeRecord(input.config ?? {});
    const createdAt = input.createdAt === undefined ? now : normalizeTimestamp(input.createdAt);
    const updatedAt = input.updatedAt === undefined ? now : normalizeTimestamp(input.updatedAt);
    const endsAt = input.endsAt === undefined || input.endsAt === null ? undefined : normalizeTimestamp(input.endsAt);
    const closedAt =
        input.closedAt === undefined || input.closedAt === null ? undefined : normalizeTimestamp(input.closedAt);

    if (!guildId.ok) return guildId;
    if (!channelId.ok) return channelId;
    if (!title.ok) return title;
    if (!prize.ok) return prize;
    if (!status.ok) return status;
    if (!winnerCount.ok) return winnerCount;
    if (winnerCount.value > 25) return { error: { field: 'winnerCount', type: 'invalid-value' }, ok: false };
    if (!entryEmoji.ok) return entryEmoji;
    if (!config) return { error: { field: 'config', type: 'invalid-value' }, ok: false };
    if (!createdAt) return { error: { field: 'createdAt', type: 'invalid-value' }, ok: false };
    if (!updatedAt) return { error: { field: 'updatedAt', type: 'invalid-value' }, ok: false };
    if (input.endsAt !== undefined && input.endsAt !== null && !endsAt) {
        return { error: { field: 'endsAt', type: 'invalid-value' }, ok: false };
    }
    if (input.closedAt !== undefined && input.closedAt !== null && !closedAt) {
        return { error: { field: 'closedAt', type: 'invalid-value' }, ok: false };
    }

    return {
        ok: true,
        value: {
            channelId: channelId.value,
            ...(closedAt ? { closedAt } : {}),
            ...optional('closedByUserId', input.closedByUserId),
            config,
            createdAt,
            ...optional('createdByUserId', input.createdByUserId),
            ...optional('description', input.description),
            ...(endsAt ? { endsAt } : {}),
            entryEmoji: entryEmoji.value,
            guildId: guildId.value,
            ...optional('messageId', input.messageId),
            prize: prize.value,
            status: status.value,
            title: title.value,
            updatedAt,
            winnerCount: winnerCount.value,
        },
    };
}

export function buildGiveawayStatusPatch(
    existing: Pick<GiveawayDocument, 'closedAt' | 'closedByUserId' | 'status'>,
    input: { actorUserId?: string | null; status?: string | null },
    now: string
): GiveawayInputResult<{ closedAt?: string; closedByUserId?: string; status: GiveawayStatus; updatedAt: string }> {
    const status = normalizeStatus(input.status);

    if (!status.ok) return status;
    if (!statusTransitions.get(existing.status)?.includes(status.value) && existing.status !== status.value) {
        return { error: { from: existing.status, to: status.value, type: 'invalid-status-transition' }, ok: false };
    }

    const shouldClose = status.value === 'closed' || status.value === 'cancelled';
    const closedAt = shouldClose ? now : existing.closedAt;
    const closedByUserId = shouldClose ? normalizeOptionalString(input.actorUserId) : existing.closedByUserId;

    return {
        ok: true,
        value: {
            ...(closedAt ? { closedAt } : {}),
            ...(closedByUserId ? { closedByUserId } : {}),
            status: status.value,
            updatedAt: now,
        },
    };
}

export function buildGiveawayEntryDocument(
    input: GiveawayEntryInput,
    now: string,
    existing?: Pick<GiveawayEntryDocument, 'enteredAt'>
): GiveawayInputResult<GiveawayEntryDocument> {
    const giveawayId = normalizeRequiredString(input.giveawayId, 'giveawayId');
    const userId = normalizeRequiredString(input.userId, 'userId');
    const enteredAt =
        input.enteredAt === undefined ? (existing?.enteredAt ?? now) : normalizeTimestamp(input.enteredAt);
    const removedAt =
        input.removedAt === undefined || input.removedAt === null ? undefined : normalizeTimestamp(input.removedAt);

    if (!giveawayId.ok) return giveawayId;
    if (!userId.ok) return userId;
    if (!enteredAt) return { error: { field: 'enteredAt', type: 'invalid-value' }, ok: false };
    if (input.removedAt !== undefined && input.removedAt !== null && !removedAt) {
        return { error: { field: 'removedAt', type: 'invalid-value' }, ok: false };
    }

    return {
        ok: true,
        value: {
            enteredAt,
            giveawayId: giveawayId.value as GenericId<'giveaways'>,
            ...(removedAt ? { removedAt } : {}),
            userId: userId.value,
        },
    };
}

export function buildGiveawayWinnerDocument(
    input: GiveawayWinnerInput,
    now: string
): GiveawayInputResult<GiveawayWinnerDocument> {
    const giveawayId = normalizeRequiredString(input.giveawayId, 'giveawayId');
    const userId = normalizeRequiredString(input.userId, 'userId');
    const drawNumber = normalizePositiveInteger(input.drawNumber ?? 1, 'drawNumber');
    const selectedAt = input.selectedAt === undefined ? now : normalizeTimestamp(input.selectedAt);

    if (!giveawayId.ok) return giveawayId;
    if (!userId.ok) return userId;
    if (!drawNumber.ok) return drawNumber;
    if (!selectedAt) return { error: { field: 'selectedAt', type: 'invalid-value' }, ok: false };

    return {
        ok: true,
        value: {
            drawNumber: drawNumber.value,
            giveawayId: giveawayId.value as GenericId<'giveaways'>,
            selectedAt,
            userId: userId.value,
        },
    };
}

export function buildGiveawayEventDocument(
    input: GiveawayEventInput,
    now: string
): GiveawayInputResult<GiveawayEventDocument> {
    const giveawayId = normalizeRequiredString(input.giveawayId, 'giveawayId');
    const eventType = normalizeRequiredString(input.eventType, 'eventType');
    const details = normalizeRecord(input.details ?? {});
    const createdAt = input.createdAt === undefined ? now : normalizeTimestamp(input.createdAt);

    if (!giveawayId.ok) return giveawayId;
    if (!eventType.ok) return eventType;
    if (!details) return { error: { field: 'details', type: 'invalid-value' }, ok: false };
    if (!createdAt) return { error: { field: 'createdAt', type: 'invalid-value' }, ok: false };

    return {
        ok: true,
        value: {
            ...optional('actorUserId', input.actorUserId),
            createdAt,
            details,
            eventType: eventType.value,
            giveawayId: giveawayId.value as GenericId<'giveaways'>,
        },
    };
}

export const normalizeRequiredGuildId = (value: string) => normalizeRequiredString(value, 'guildId');
export const normalizeRequiredGiveawayId = (value: string) => normalizeRequiredString(value, 'giveawayId');
export const normalizeRequiredMessageId = (value: string) => normalizeRequiredString(value, 'messageId');

export function normalizeGiveawayLimit(limit: number | undefined, fallback = 50, max = 100): number {
    if (limit === undefined || !Number.isFinite(limit)) return fallback;

    return Math.min(Math.max(Math.trunc(limit), 1), max);
}

export function toGiveawayRecord(document: GiveawayDocument & { _id: string }) {
    return {
        channelId: document.channelId,
        closedAt: document.closedAt ?? null,
        closedByUserId: document.closedByUserId ?? null,
        config: document.config,
        createdAt: document.createdAt,
        createdByUserId: document.createdByUserId ?? null,
        description: document.description ?? null,
        endsAt: document.endsAt ?? null,
        entryEmoji: document.entryEmoji,
        guildId: document.guildId,
        id: document._id,
        messageId: document.messageId ?? null,
        prize: document.prize,
        status: document.status,
        title: document.title,
        updatedAt: document.updatedAt,
        winnerCount: document.winnerCount,
    };
}

export function toGiveawayEntryRecord(document: GiveawayEntryDocument & { _id: string }) {
    return {
        enteredAt: document.enteredAt,
        giveawayId: document.giveawayId,
        id: document._id,
        removedAt: document.removedAt ?? null,
        userId: document.userId,
    };
}

export function toGiveawayWinnerRecord(document: GiveawayWinnerDocument & { _id: string }) {
    return {
        drawNumber: document.drawNumber,
        giveawayId: document.giveawayId,
        id: document._id,
        selectedAt: document.selectedAt,
        userId: document.userId,
    };
}

export function toGiveawayEventRecord(document: GiveawayEventDocument & { _id: string }) {
    return {
        actorUserId: document.actorUserId ?? null,
        createdAt: document.createdAt,
        details: document.details,
        eventType: document.eventType,
        giveawayId: document.giveawayId,
        id: document._id,
    };
}

function normalizeRequiredString(value: string | null | undefined, field: string): GiveawayInputResult<string> {
    const normalizedValue = normalizeOptionalString(value);

    return normalizedValue
        ? { ok: true, value: normalizedValue }
        : { error: { field, type: 'missing-input' }, ok: false };
}

function normalizeOptionalString(value: string | null | undefined): string | undefined {
    const normalizedValue = value?.trim();

    return normalizedValue && normalizedValue.length > 0 ? normalizedValue : undefined;
}

function normalizeTimestamp(value: string | null | undefined): string | undefined {
    const parsed = Date.parse(value ?? '');

    return Number.isFinite(parsed) ? new Date(parsed).toISOString() : undefined;
}

function normalizeRecord(value: Record<string, unknown> | null | undefined): Record<string, unknown> | undefined {
    return typeof value === 'object' && value !== null && !Array.isArray(value) ? value : undefined;
}

function normalizePositiveInteger(value: number | null | undefined, field: string): GiveawayInputResult<number> {
    return Number.isInteger(value) && Number(value) > 0
        ? { ok: true, value: Number(value) }
        : { error: { field, type: 'invalid-value' }, ok: false };
}

function normalizeStatus(value: string | null | undefined): GiveawayInputResult<GiveawayStatus> {
    const normalizedValue = normalizeOptionalString(value);

    if (
        normalizedValue === 'active' ||
        normalizedValue === 'cancelled' ||
        normalizedValue === 'closed' ||
        normalizedValue === 'draft'
    ) {
        return { ok: true, value: normalizedValue };
    }

    return { error: { field: 'status', type: normalizedValue ? 'invalid-value' : 'missing-input' }, ok: false };
}

function optional<Key extends string>(key: Key, value: string | null | undefined): Partial<Record<Key, string>> {
    const normalized = normalizeOptionalString(value);

    return normalized ? ({ [key]: normalized } as Partial<Record<Key, string>>) : {};
}

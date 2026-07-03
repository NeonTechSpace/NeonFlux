export type TicketPanelInput = {
    channelId?: string | null;
    config?: Record<string, unknown> | null;
    createdAt?: string | null;
    enabled?: boolean | null;
    guildId?: string | null;
    legacyId?: string | null;
    messageId?: string | null;
    title?: string | null;
    updatedAt?: string | null;
};

export type TicketPanelDocument = {
    channelId: string;
    config: Record<string, unknown>;
    createdAt: string;
    enabled: boolean;
    guildId: string;
    legacyId: string;
    messageId?: string;
    title: string;
    updatedAt: string;
};

export type TicketPanelRecord = {
    channelId: string;
    config: Record<string, unknown>;
    createdAt: string;
    enabled: boolean;
    guildId: string;
    id: string;
    messageId: string | null;
    title: string;
    updatedAt: string;
};

export type TicketInput = {
    channelId?: string | null;
    claimedByUserId?: string | null;
    closedAt?: string | null;
    guildId?: string | null;
    legacyId?: string | null;
    openedAt?: string | null;
    openerUserId?: string | null;
    panelId?: string | null;
    status?: string | null;
    ticketNumber?: number | null;
    updatedAt?: string | null;
};

export type TicketDocument = {
    channelId?: string;
    claimedByUserId?: string;
    closedAt?: string;
    guildId: string;
    legacyId: string;
    openedAt: string;
    openerUserId: string;
    panelLegacyId?: string;
    status: string;
    ticketNumber: number;
    updatedAt: string;
};

export type TicketRecord = {
    channelId: string | null;
    claimedByUserId: string | null;
    closedAt: string | null;
    guildId: string;
    id: string;
    openedAt: string;
    openerUserId: string;
    panelId: string | null;
    status: string;
    ticketNumber: number;
    updatedAt: string;
};

export type TicketMemberInput = {
    createdAt?: string | null;
    legacyId?: string | null;
    role?: string | null;
    ticketId?: string | null;
    userId?: string | null;
};

export type TicketMemberDocument = {
    createdAt: string;
    legacyId: string;
    role: string;
    ticketLegacyId: string;
    userId: string;
};

export type TicketMemberRecord = {
    createdAt: string;
    id: string;
    role: string;
    ticketId: string;
    userId: string;
};

export type TicketEventInput = {
    actorUserId?: string | null;
    createdAt?: string | null;
    details?: Record<string, unknown> | null;
    eventType?: string | null;
    legacyId?: string | null;
    ticketId?: string | null;
};

export type TicketEventDocument = {
    actorUserId?: string;
    createdAt: string;
    details: Record<string, unknown>;
    eventType: string;
    legacyId: string;
    ticketLegacyId: string;
};

export type TicketEventRecord = {
    actorUserId: string | null;
    createdAt: string;
    details: Record<string, unknown>;
    eventType: string;
    id: string;
    ticketId: string;
};

export type TicketInputError =
    | { field: string; type: 'invalid-value' | 'missing-input' }
    | { from: string; to: string; type: 'invalid-status-transition' };

export type TicketInputResult<Value> = { ok: true; value: Value } | { error: TicketInputError; ok: false };

const ticketStatusTransitions = new Map<string, readonly string[]>([
    ['open', ['closed', 'archived']],
    ['closed', ['archived']],
    ['archived', []],
]);

export function buildTicketPanelDocument(
    input: TicketPanelInput,
    now: string,
    existing?: Pick<TicketPanelDocument, 'createdAt' | 'legacyId'>,
    createLegacyId: () => string = () => crypto.randomUUID()
): TicketInputResult<TicketPanelDocument> {
    const guildId = normalizeRequiredString(input.guildId, 'guildId');
    const channelId = normalizeRequiredString(input.channelId, 'channelId');
    const title = normalizeRequiredString(input.title, 'title');
    const config = normalizeRecord(input.config ?? {});
    const createdAt =
        input.createdAt === undefined ? (existing?.createdAt ?? now) : normalizeTimestamp(input.createdAt);
    const updatedAt = input.updatedAt === undefined ? now : normalizeTimestamp(input.updatedAt);

    if (!guildId.ok) return guildId;
    if (!channelId.ok) return channelId;
    if (!title.ok) return title;
    if (!config) return { error: { field: 'config', type: 'invalid-value' }, ok: false };
    if (!createdAt) return { error: { field: 'createdAt', type: 'invalid-value' }, ok: false };
    if (!updatedAt) return { error: { field: 'updatedAt', type: 'invalid-value' }, ok: false };

    const messageId = normalizeOptionalString(input.messageId);

    return {
        ok: true,
        value: {
            channelId: channelId.value,
            config,
            createdAt,
            enabled: input.enabled ?? true,
            guildId: guildId.value,
            legacyId: normalizeOptionalString(input.legacyId) ?? existing?.legacyId ?? createLegacyId(),
            ...(messageId ? { messageId } : {}),
            title: title.value,
            updatedAt,
        },
    };
}

export function buildTicketDocument(
    input: TicketInput,
    now: string,
    createLegacyId: () => string = () => crypto.randomUUID()
): TicketInputResult<TicketDocument> {
    const guildId = normalizeRequiredString(input.guildId, 'guildId');
    const openerUserId = normalizeRequiredString(input.openerUserId, 'openerUserId');
    const ticketNumber = normalizePositiveInteger(input.ticketNumber, 'ticketNumber');
    const status = normalizeRequiredString(input.status ?? 'open', 'status');
    const openedAt = input.openedAt === undefined ? now : normalizeTimestamp(input.openedAt);
    const updatedAt = input.updatedAt === undefined ? now : normalizeTimestamp(input.updatedAt);
    const closedAt =
        input.closedAt === undefined || input.closedAt === null ? undefined : normalizeTimestamp(input.closedAt);

    if (!guildId.ok) return guildId;
    if (!openerUserId.ok) return openerUserId;
    if (!ticketNumber.ok) return ticketNumber;
    if (!status.ok) return status;
    if (!openedAt) return { error: { field: 'openedAt', type: 'invalid-value' }, ok: false };
    if (!updatedAt) return { error: { field: 'updatedAt', type: 'invalid-value' }, ok: false };
    if (input.closedAt !== undefined && input.closedAt !== null && !closedAt) {
        return { error: { field: 'closedAt', type: 'invalid-value' }, ok: false };
    }

    const channelId = normalizeOptionalString(input.channelId);
    const claimedByUserId = normalizeOptionalString(input.claimedByUserId);
    const panelLegacyId = normalizeOptionalString(input.panelId);

    return {
        ok: true,
        value: {
            ...(channelId ? { channelId } : {}),
            ...(claimedByUserId ? { claimedByUserId } : {}),
            ...(closedAt ? { closedAt } : {}),
            guildId: guildId.value,
            legacyId: normalizeOptionalString(input.legacyId) ?? createLegacyId(),
            openedAt,
            openerUserId: openerUserId.value,
            ...(panelLegacyId ? { panelLegacyId } : {}),
            status: status.value,
            ticketNumber: ticketNumber.value,
            updatedAt,
        },
    };
}

export function buildTicketStatusPatch(
    existing: Pick<TicketDocument, 'closedAt' | 'status'>,
    input: { status?: string | null; updatedAt?: string | null },
    now: string
): TicketInputResult<{ closedAt?: string; status: string; updatedAt: string }> {
    const status = normalizeRequiredString(input.status, 'status');
    const updatedAt = input.updatedAt === undefined ? now : normalizeTimestamp(input.updatedAt);

    if (!status.ok) return status;
    if (!updatedAt) return { error: { field: 'updatedAt', type: 'invalid-value' }, ok: false };

    const transition = assertAllowedStatusTransition(existing.status, status.value);

    if (!transition.ok) return transition;

    const closedAt =
        status.value === 'closed' || (status.value === 'archived' && !existing.closedAt) ? now : existing.closedAt;

    return {
        ok: true,
        value: {
            ...(closedAt ? { closedAt } : {}),
            status: status.value,
            updatedAt,
        },
    };
}

export function buildTicketMemberDocument(
    input: TicketMemberInput,
    now: string,
    existing?: Pick<TicketMemberDocument, 'createdAt' | 'legacyId'>,
    createLegacyId: () => string = () => crypto.randomUUID()
): TicketInputResult<TicketMemberDocument> {
    const ticketId = normalizeRequiredString(input.ticketId, 'ticketId');
    const userId = normalizeRequiredString(input.userId, 'userId');
    const createdAt =
        input.createdAt === undefined ? (existing?.createdAt ?? now) : normalizeTimestamp(input.createdAt);

    if (!ticketId.ok) return ticketId;
    if (!userId.ok) return userId;
    if (!createdAt) return { error: { field: 'createdAt', type: 'invalid-value' }, ok: false };

    return {
        ok: true,
        value: {
            createdAt,
            legacyId: normalizeOptionalString(input.legacyId) ?? existing?.legacyId ?? createLegacyId(),
            role: normalizeOptionalString(input.role) ?? 'participant',
            ticketLegacyId: ticketId.value,
            userId: userId.value,
        },
    };
}

export function buildTicketEventDocument(
    input: TicketEventInput,
    now: string,
    createLegacyId: () => string = () => crypto.randomUUID()
): TicketInputResult<TicketEventDocument> {
    const ticketId = normalizeRequiredString(input.ticketId, 'ticketId');
    const eventType = normalizeRequiredString(input.eventType, 'eventType');
    const details = normalizeRecord(input.details ?? {});
    const createdAt = input.createdAt === undefined ? now : normalizeTimestamp(input.createdAt);

    if (!ticketId.ok) return ticketId;
    if (!eventType.ok) return eventType;
    if (!details) return { error: { field: 'details', type: 'invalid-value' }, ok: false };
    if (!createdAt) return { error: { field: 'createdAt', type: 'invalid-value' }, ok: false };

    const actorUserId = normalizeOptionalString(input.actorUserId);

    return {
        ok: true,
        value: {
            ...(actorUserId ? { actorUserId } : {}),
            createdAt,
            details,
            eventType: eventType.value,
            legacyId: normalizeOptionalString(input.legacyId) ?? createLegacyId(),
            ticketLegacyId: ticketId.value,
        },
    };
}

export function normalizeRequiredGuildId(value: string): TicketInputResult<string> {
    return normalizeRequiredString(value, 'guildId');
}

export function normalizeRequiredPanelId(value: string): TicketInputResult<string> {
    return normalizeRequiredString(value, 'panelId');
}

export function normalizeRequiredTicketId(value: string): TicketInputResult<string> {
    return normalizeRequiredString(value, 'ticketId');
}

export function normalizeRequiredMessageId(value: string): TicketInputResult<string> {
    return normalizeRequiredString(value, 'messageId');
}

export function normalizeRequiredChannelId(value: string): TicketInputResult<string> {
    return normalizeRequiredString(value, 'channelId');
}

export function normalizeRequiredOpenerUserId(value: string): TicketInputResult<string> {
    return normalizeRequiredString(value, 'openerUserId');
}

export function normalizeLimit(limit: number | undefined, fallback = 100): number {
    if (limit === undefined || !Number.isFinite(limit)) return fallback;

    return Math.min(Math.max(Math.trunc(limit), 1), 500);
}

export function toTicketPanelRecord(document: TicketPanelDocument): TicketPanelRecord {
    return {
        channelId: document.channelId,
        config: document.config,
        createdAt: document.createdAt,
        enabled: document.enabled,
        guildId: document.guildId,
        id: document.legacyId,
        messageId: document.messageId ?? null,
        title: document.title,
        updatedAt: document.updatedAt,
    };
}

export function toTicketRecord(document: TicketDocument): TicketRecord {
    return {
        channelId: document.channelId ?? null,
        claimedByUserId: document.claimedByUserId ?? null,
        closedAt: document.closedAt ?? null,
        guildId: document.guildId,
        id: document.legacyId,
        openedAt: document.openedAt,
        openerUserId: document.openerUserId,
        panelId: document.panelLegacyId ?? null,
        status: document.status,
        ticketNumber: document.ticketNumber,
        updatedAt: document.updatedAt,
    };
}

export function toTicketMemberRecord(document: TicketMemberDocument): TicketMemberRecord {
    return {
        createdAt: document.createdAt,
        id: document.legacyId,
        role: document.role,
        ticketId: document.ticketLegacyId,
        userId: document.userId,
    };
}

export function toTicketEventRecord(document: TicketEventDocument): TicketEventRecord {
    return {
        actorUserId: document.actorUserId ?? null,
        createdAt: document.createdAt,
        details: document.details,
        eventType: document.eventType,
        id: document.legacyId,
        ticketId: document.ticketLegacyId,
    };
}

function assertAllowedStatusTransition(from: string, to: string): TicketInputResult<undefined> {
    if (from === to || ticketStatusTransitions.get(from)?.includes(to)) {
        return { ok: true, value: undefined };
    }

    return { error: { from, to, type: 'invalid-status-transition' }, ok: false };
}

function normalizeRequiredString(value: string | null | undefined, field: string): TicketInputResult<string> {
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

function normalizePositiveInteger(value: number | null | undefined, field: string): TicketInputResult<number> {
    return Number.isInteger(value) && Number(value) > 0
        ? { ok: true, value: Number(value) }
        : { error: { field, type: 'invalid-value' }, ok: false };
}

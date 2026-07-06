export type XpVoiceSessionStatus = 'active' | 'closed';

export type XpVoiceSessionDocument = {
    channelId: string;
    createdAt: string;
    creditedSeconds: number;
    endedAt?: string;
    guildId: string;
    startedAt: string;
    status: XpVoiceSessionStatus;
    updatedAt: string;
    userId: string;
};

export type ClosedXpVoiceSessionDocument = {
    durationSeconds: number;
    session: XpVoiceSessionDocument & { _id: string };
};

export type XpVoiceSessionInputError = { field: string; type: 'invalid-value' | 'missing-input' };
export type XpVoiceSessionInputResult<Value> =
    | { ok: true; value: Value }
    | { error: XpVoiceSessionInputError; ok: false };

export function buildActiveXpVoiceSessionDocument(
    input: {
        channelId?: string | null;
        createdAt?: string | null;
        guildId?: string | null;
        startedAt?: string | null;
        userId?: string | null;
    },
    now: string
): XpVoiceSessionInputResult<XpVoiceSessionDocument> {
    const guildId = normalizeRequiredString(input.guildId, 'guildId');
    const userId = normalizeRequiredString(input.userId, 'userId');
    const channelId = normalizeRequiredString(input.channelId, 'channelId');
    const startedAt = input.startedAt === undefined ? now : normalizeTimestamp(input.startedAt);
    const createdAt = input.createdAt === undefined ? startedAt : normalizeTimestamp(input.createdAt);

    if (!guildId.ok) return guildId;
    if (!userId.ok) return userId;
    if (!channelId.ok) return channelId;
    if (!startedAt) return { error: { field: 'startedAt', type: 'invalid-value' }, ok: false };
    if (!createdAt) return { error: { field: 'createdAt', type: 'invalid-value' }, ok: false };

    return {
        ok: true,
        value: {
            channelId: channelId.value,
            createdAt,
            creditedSeconds: 0,
            guildId: guildId.value,
            startedAt,
            status: 'active',
            updatedAt: startedAt,
            userId: userId.value,
        },
    };
}

export function closeXpVoiceSessionDocument(
    session: XpVoiceSessionDocument & { _id: string },
    endedAtInput?: string | null
): XpVoiceSessionInputResult<ClosedXpVoiceSessionDocument> {
    const endedAt = endedAtInput === undefined ? new Date().toISOString() : normalizeTimestamp(endedAtInput);

    if (!endedAt) return { error: { field: 'endedAt', type: 'invalid-value' }, ok: false };

    const durationSeconds = calculateDurationSeconds(session.startedAt, endedAt);

    return {
        ok: true,
        value: {
            durationSeconds,
            session: {
                ...session,
                creditedSeconds: durationSeconds,
                endedAt,
                status: 'closed',
                updatedAt: endedAt,
            },
        },
    };
}

export function calculateDurationSeconds(startedAtInput: string, endedAtInput: string): number {
    const startedAt = Date.parse(startedAtInput);
    const endedAt = Date.parse(endedAtInput);

    if (!Number.isFinite(startedAt) || !Number.isFinite(endedAt)) return 0;

    return Math.max(0, Math.floor((endedAt - startedAt) / 1000));
}

export const normalizeRequiredGuildId = (value: string) => normalizeRequiredString(value, 'guildId');
export const normalizeRequiredUserId = (value: string) => normalizeRequiredString(value, 'userId');
export const normalizeRequiredChannelId = (value: string) => normalizeRequiredString(value, 'channelId');

export function toXpVoiceSessionRecord(document: XpVoiceSessionDocument & { _id: string }) {
    return {
        ...document,
        endedAt: document.endedAt ?? null,
        id: document._id,
    };
}

function normalizeRequiredString(value: string | null | undefined, field: string): XpVoiceSessionInputResult<string> {
    const normalizedValue = value?.trim();

    return normalizedValue
        ? { ok: true, value: normalizedValue }
        : { error: { field, type: 'missing-input' }, ok: false };
}

function normalizeTimestamp(value: string | null | undefined): string | undefined {
    const parsed = Date.parse(value ?? '');

    return Number.isFinite(parsed) ? new Date(parsed).toISOString() : undefined;
}

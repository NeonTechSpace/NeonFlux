import { api } from '@neonflux/convex/api';
import { err, ok, type Result } from 'neverthrow';

import type { GuildFeatureRepositoryError } from './contracts.js';
import type {
    ClosedXpVoiceSession,
    XpVoiceSessionRecord,
    XpVoiceSessionRepositoryError,
    XpVoiceSessionTransition,
} from './contracts-xp.js';

import type { ConvexDatabase } from './convex.js';

type ConvexMutationReference = Parameters<ConvexDatabase['client']['mutation']>[0];

const convexApi = api as unknown as {
    xp_voice_sessions: {
        closeXpVoiceSession: ConvexMutationReference;
        startXpVoiceSession: ConvexMutationReference;
        transitionXpVoiceSession: ConvexMutationReference;
    };
};

type XpVoiceDb = ConvexDatabase;

type ConvexXpVoiceSessionRecord = Omit<XpVoiceSessionRecord, 'createdAt' | 'endedAt' | 'startedAt' | 'updatedAt'> & {
    createdAt: string;
    endedAt: string | null;
    legacyId: string;
    startedAt: string;
    updatedAt: string;
};
type ConvexClosedXpVoiceSession = {
    durationSeconds: number;
    session: ConvexXpVoiceSessionRecord;
};
type ConvexXpVoiceSessionTransition =
    | { active: ConvexXpVoiceSessionRecord; status: 'unchanged' }
    | { active: ConvexXpVoiceSessionRecord; closed?: ConvexClosedXpVoiceSession; status: 'started' };

export async function transitionXpVoiceSession(
    db: XpVoiceDb,
    input: { channelId: string; guildId: string; occurredAt?: Date; userId: string }
): Promise<Result<XpVoiceSessionTransition, XpVoiceSessionRepositoryError>> {
    const normalizedInput = normalizeVoiceSessionInput(input, 'occurredAt');

    if (normalizedInput.isErr()) return err(normalizedInput.error);

    try {
        const transition = await db.client.mutation<ConvexXpVoiceSessionTransition>(
            convexApi.xp_voice_sessions.transitionXpVoiceSession,
            normalizedInput.value
        );

        return ok(toXpVoiceSessionTransition(transition));
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function startXpVoiceSession(
    db: XpVoiceDb,
    input: { channelId: string; guildId: string; startedAt?: Date; userId: string }
): Promise<Result<XpVoiceSessionRecord, XpVoiceSessionRepositoryError>> {
    const normalizedInput = normalizeVoiceSessionInput(input, 'startedAt');

    if (normalizedInput.isErr()) return err(normalizedInput.error);

    try {
        const session = await db.client.mutation<ConvexXpVoiceSessionRecord>(
            convexApi.xp_voice_sessions.startXpVoiceSession,
            normalizedInput.value
        );

        return ok(toXpVoiceSessionRecord(session));
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function closeXpVoiceSession(
    db: XpVoiceDb,
    input: { endedAt?: Date; guildId: string; userId: string }
): Promise<Result<ClosedXpVoiceSession, XpVoiceSessionRepositoryError>> {
    const guildId = normalizeRequiredText(input.guildId, 'guildId');
    const userId = normalizeRequiredText(input.userId, 'userId');
    const endedAt = input.endedAt ? normalizeDate(input.endedAt, 'endedAt') : ok(undefined);

    if (guildId.isErr()) return err(guildId.error);
    if (userId.isErr()) return err(userId.error);
    if (endedAt.isErr()) return err(endedAt.error);

    try {
        const closed = await db.client.mutation<ConvexClosedXpVoiceSession | null>(
            convexApi.xp_voice_sessions.closeXpVoiceSession,
            {
                ...(endedAt.value === undefined ? {} : { endedAt: endedAt.value }),
                guildId: guildId.value,
                userId: userId.value,
            }
        );

        return closed ? ok(toClosedXpVoiceSession(closed)) : err({ type: 'not-found' });
    } catch {
        return err({ type: 'database-error' });
    }
}

function normalizeVoiceSessionInput(
    input: { channelId: string; guildId: string; occurredAt?: Date; startedAt?: Date; userId: string },
    dateField: 'occurredAt' | 'startedAt'
): Result<
    { channelId: string; guildId: string; occurredAt?: string; startedAt?: string; userId: string },
    XpVoiceSessionRepositoryError
> {
    const guildId = normalizeRequiredText(input.guildId, 'guildId');
    const userId = normalizeRequiredText(input.userId, 'userId');
    const channelId = normalizeRequiredText(input.channelId, 'channelId');
    const dateInput = dateField === 'occurredAt' ? input.occurredAt : input.startedAt;
    const date = dateInput ? normalizeDate(dateInput, dateField) : ok(undefined);

    if (guildId.isErr()) return err(guildId.error);
    if (userId.isErr()) return err(userId.error);
    if (channelId.isErr()) return err(channelId.error);
    if (date.isErr()) return err(date.error);

    return ok({
        channelId: channelId.value,
        guildId: guildId.value,
        ...(date.value === undefined ? {} : { [dateField]: date.value }),
        userId: userId.value,
    });
}

function toXpVoiceSessionTransition(transition: ConvexXpVoiceSessionTransition): XpVoiceSessionTransition {
    return transition.status === 'unchanged'
        ? { active: toXpVoiceSessionRecord(transition.active), status: 'unchanged' }
        : {
              active: toXpVoiceSessionRecord(transition.active),
              ...(transition.closed === undefined ? {} : { closed: toClosedXpVoiceSession(transition.closed) }),
              status: 'started',
          };
}

function toClosedXpVoiceSession(record: ConvexClosedXpVoiceSession): ClosedXpVoiceSession {
    return {
        durationSeconds: record.durationSeconds,
        session: toXpVoiceSessionRecord(record.session),
    };
}

function toXpVoiceSessionRecord(record: ConvexXpVoiceSessionRecord): XpVoiceSessionRecord {
    return {
        channelId: record.channelId,
        createdAt: new Date(record.createdAt),
        creditedSeconds: record.creditedSeconds,
        endedAt: record.endedAt ? new Date(record.endedAt) : null,
        guildId: record.guildId,
        id: record.id,
        startedAt: new Date(record.startedAt),
        status: record.status,
        updatedAt: new Date(record.updatedAt),
        userId: record.userId,
    };
}

function normalizeRequiredText(
    value: string | null | undefined,
    field: string
): Result<string, GuildFeatureRepositoryError> {
    const normalizedValue = value?.trim();

    return normalizedValue ? ok(normalizedValue) : err({ field, type: 'missing-input' });
}

function normalizeDate(value: Date, field: string): Result<string, GuildFeatureRepositoryError> {
    const timestamp = value.getTime();

    return Number.isFinite(timestamp) ? ok(value.toISOString()) : err({ field, type: 'invalid-value' });
}

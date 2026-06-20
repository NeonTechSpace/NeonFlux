import { and, eq, gt, isNull } from 'drizzle-orm';
import type { PgDatabase } from 'drizzle-orm/pg-core/db';
import type { PgQueryResultHKT } from 'drizzle-orm/pg-core/session';
import { err, ok, type Result } from 'neverthrow';

import type * as schema from './schema.js';
import { webSessions } from './schema.js';

export type WebSessionRecord = {
    id: string;
    fluxerUserId: string;
    createdAt: Date;
    expiresAt: Date;
    revokedAt: Date | null;
};

export type WebSessionRepositoryError =
    | 'missing-session-id'
    | 'missing-fluxer-user-id'
    | 'invalid-expiry'
    | 'not-found'
    | 'database-error';

type WebSessionRow = typeof webSessions.$inferSelect;
type WebSessionDatabase = PgDatabase<PgQueryResultHKT, typeof schema>;

export async function createWebSession(
    db: WebSessionDatabase,
    input: {
        sessionId: string;
        fluxerUserId: string;
        expiresAt: Date;
    }
): Promise<Result<WebSessionRecord, WebSessionRepositoryError>> {
    const sessionIdResult = normalizeRequiredString(input.sessionId, 'missing-session-id');

    if (sessionIdResult.isErr()) {
        return err(sessionIdResult.error);
    }

    const fluxerUserIdResult = normalizeRequiredString(input.fluxerUserId, 'missing-fluxer-user-id');

    if (fluxerUserIdResult.isErr()) {
        return err(fluxerUserIdResult.error);
    }

    if (!isFutureDate(input.expiresAt)) {
        return err('invalid-expiry');
    }

    try {
        const sessions = await db
            .insert(webSessions)
            .values({
                id: sessionIdResult.value,
                fluxerUserId: fluxerUserIdResult.value,
                expiresAt: input.expiresAt,
            })
            .returning();
        const session = sessions[0];

        if (!session) {
            return err('database-error');
        }

        return ok(toWebSessionRecord(session));
    } catch {
        return err('database-error');
    }
}

export async function findActiveWebSessionById(
    db: WebSessionDatabase,
    input: {
        sessionId: string;
        now?: Date;
    }
): Promise<Result<WebSessionRecord, WebSessionRepositoryError>> {
    const sessionIdResult = normalizeRequiredString(input.sessionId, 'missing-session-id');

    if (sessionIdResult.isErr()) {
        return err(sessionIdResult.error);
    }

    const now = input.now ?? new Date();

    if (!isValidDate(now)) {
        return err('not-found');
    }

    try {
        const sessions = await db
            .select()
            .from(webSessions)
            .where(
                and(
                    eq(webSessions.id, sessionIdResult.value),
                    isNull(webSessions.revokedAt),
                    gt(webSessions.expiresAt, now)
                )
            )
            .limit(1);
        const session = sessions[0];

        if (!session) {
            return err('not-found');
        }

        return ok(toWebSessionRecord(session));
    } catch {
        return err('database-error');
    }
}

export async function revokeWebSession(
    db: WebSessionDatabase,
    input: {
        sessionId: string;
        revokedAt?: Date;
    }
): Promise<Result<WebSessionRecord, WebSessionRepositoryError>> {
    const sessionIdResult = normalizeRequiredString(input.sessionId, 'missing-session-id');

    if (sessionIdResult.isErr()) {
        return err(sessionIdResult.error);
    }

    const revokedAt = input.revokedAt ?? new Date();

    if (!isValidDate(revokedAt)) {
        return err('database-error');
    }

    try {
        const sessions = await db
            .update(webSessions)
            .set({ revokedAt })
            .where(eq(webSessions.id, sessionIdResult.value))
            .returning();
        const session = sessions[0];

        if (!session) {
            return err('not-found');
        }

        return ok(toWebSessionRecord(session));
    } catch {
        return err('database-error');
    }
}

function normalizeRequiredString<E extends WebSessionRepositoryError>(value: string, error: E): Result<string, E> {
    const normalizedValue = value.trim();

    if (normalizedValue.length === 0) {
        return err(error);
    }

    return ok(normalizedValue);
}

function isFutureDate(date: Date): boolean {
    return isValidDate(date) && date.getTime() > Date.now();
}

function isValidDate(date: Date): boolean {
    return Number.isFinite(date.getTime());
}

function toWebSessionRecord(session: WebSessionRow): WebSessionRecord {
    return {
        id: session.id,
        fluxerUserId: session.fluxerUserId,
        createdAt: session.createdAt,
        expiresAt: session.expiresAt,
        revokedAt: session.revokedAt,
    };
}

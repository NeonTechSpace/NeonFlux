import { and, eq } from 'drizzle-orm';
import { err, ok, type Result } from 'neverthrow';

import {
    normalizeRequiredText,
    type GuildFeatureRepositoryDatabase,
    type GuildFeatureRepositoryError,
} from './feature-repository-types.js';
import { xpVoiceSessions } from './schema.js';

export type XpVoiceSessionRecord = typeof xpVoiceSessions.$inferSelect;
export type XpVoiceSessionRepositoryError = GuildFeatureRepositoryError;
export type ClosedXpVoiceSession = {
    session: XpVoiceSessionRecord;
    durationSeconds: number;
};
export type XpVoiceSessionTransition =
    | { status: 'started'; active: XpVoiceSessionRecord; closed?: ClosedXpVoiceSession }
    | { status: 'unchanged'; active: XpVoiceSessionRecord };

export async function transitionXpVoiceSession(
    db: GuildFeatureRepositoryDatabase,
    input: { guildId: string; userId: string; channelId: string; occurredAt?: Date }
): Promise<Result<XpVoiceSessionTransition, XpVoiceSessionRepositoryError>> {
    const guildId = normalizeRequiredText(input.guildId, 'guildId');
    const userId = normalizeRequiredText(input.userId, 'userId');
    const channelId = normalizeRequiredText(input.channelId, 'channelId');

    if (guildId.isErr()) return err(guildId.error);
    if (userId.isErr()) return err(userId.error);
    if (channelId.isErr()) return err(channelId.error);

    try {
        const occurredAt = input.occurredAt ?? new Date();
        const result = await db.transaction(async (tx) => {
            const activeRows = await tx
                .select()
                .from(xpVoiceSessions)
                .where(
                    and(
                        eq(xpVoiceSessions.guildId, guildId.value),
                        eq(xpVoiceSessions.userId, userId.value),
                        eq(xpVoiceSessions.status, 'active')
                    )
                )
                .limit(1);
            const active = activeRows[0];

            if (active?.channelId === channelId.value) {
                return {
                    status: 'unchanged' as const,
                    active,
                };
            }

            let closed: ClosedXpVoiceSession | undefined;

            if (active) {
                const durationSeconds = calculateDurationSeconds(active.startedAt, occurredAt);
                const closedRows = await tx
                    .update(xpVoiceSessions)
                    .set({
                        status: 'closed',
                        endedAt: occurredAt,
                        creditedSeconds: durationSeconds,
                        updatedAt: occurredAt,
                    })
                    .where(eq(xpVoiceSessions.id, active.id))
                    .returning();
                const session = closedRows[0];

                if (!session) {
                    throw new Error('Missing closed XP voice session row.');
                }

                closed = { session, durationSeconds };
            }

            const startedRows = await tx
                .insert(xpVoiceSessions)
                .values({
                    guildId: guildId.value,
                    userId: userId.value,
                    channelId: channelId.value,
                    status: 'active',
                    startedAt: occurredAt,
                    updatedAt: occurredAt,
                })
                .returning();
            const started = startedRows[0];

            if (!started) {
                throw new Error('Missing started XP voice session row.');
            }

            return {
                status: 'started' as const,
                active: started,
                ...(closed ? { closed } : {}),
            };
        });

        return ok(result);
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function startXpVoiceSession(
    db: GuildFeatureRepositoryDatabase,
    input: { guildId: string; userId: string; channelId: string; startedAt?: Date }
): Promise<Result<XpVoiceSessionRecord, XpVoiceSessionRepositoryError>> {
    const guildId = normalizeRequiredText(input.guildId, 'guildId');
    const userId = normalizeRequiredText(input.userId, 'userId');
    const channelId = normalizeRequiredText(input.channelId, 'channelId');

    if (guildId.isErr()) return err(guildId.error);
    if (userId.isErr()) return err(userId.error);
    if (channelId.isErr()) return err(channelId.error);

    try {
        const startedAt = input.startedAt ?? new Date();
        const rows = await db.transaction(async (tx) => {
            const activeRows = await tx
                .select()
                .from(xpVoiceSessions)
                .where(
                    and(
                        eq(xpVoiceSessions.guildId, guildId.value),
                        eq(xpVoiceSessions.userId, userId.value),
                        eq(xpVoiceSessions.status, 'active')
                    )
                )
                .limit(1);
            const active = activeRows[0];

            if (active?.channelId === channelId.value) {
                return [active];
            }

            if (active) {
                await tx
                    .update(xpVoiceSessions)
                    .set({
                        status: 'closed',
                        endedAt: startedAt,
                        creditedSeconds: calculateDurationSeconds(active.startedAt, startedAt),
                        updatedAt: startedAt,
                    })
                    .where(eq(xpVoiceSessions.id, active.id));
            }

            return tx
                .insert(xpVoiceSessions)
                .values({
                    guildId: guildId.value,
                    userId: userId.value,
                    channelId: channelId.value,
                    status: 'active',
                    startedAt,
                    updatedAt: startedAt,
                })
                .returning();
        });
        const row = rows[0];

        return row ? ok(row) : err({ type: 'database-error' });
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function closeXpVoiceSession(
    db: GuildFeatureRepositoryDatabase,
    input: { guildId: string; userId: string; endedAt?: Date }
): Promise<Result<ClosedXpVoiceSession, XpVoiceSessionRepositoryError>> {
    const guildId = normalizeRequiredText(input.guildId, 'guildId');
    const userId = normalizeRequiredText(input.userId, 'userId');

    if (guildId.isErr()) return err(guildId.error);
    if (userId.isErr()) return err(userId.error);

    try {
        const endedAt = input.endedAt ?? new Date();
        const activeRows = await db
            .select()
            .from(xpVoiceSessions)
            .where(
                and(
                    eq(xpVoiceSessions.guildId, guildId.value),
                    eq(xpVoiceSessions.userId, userId.value),
                    eq(xpVoiceSessions.status, 'active')
                )
            )
            .limit(1);
        const active = activeRows[0];

        if (!active) {
            return err({ type: 'not-found' });
        }

        const durationSeconds = calculateDurationSeconds(active.startedAt, endedAt);
        const updatedRows = await db
            .update(xpVoiceSessions)
            .set({
                status: 'closed',
                endedAt,
                creditedSeconds: durationSeconds,
                updatedAt: endedAt,
            })
            .where(eq(xpVoiceSessions.id, active.id))
            .returning();
        const session = updatedRows[0];

        return session ? ok({ session, durationSeconds }) : err({ type: 'database-error' });
    } catch {
        return err({ type: 'database-error' });
    }
}

function calculateDurationSeconds(startedAt: Date, endedAt: Date): number {
    return Math.max(0, Math.floor((endedAt.getTime() - startedAt.getTime()) / 1000));
}

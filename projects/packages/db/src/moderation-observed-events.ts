import { and, desc, eq, gte, inArray } from 'drizzle-orm';
import { err, ok, type Result } from 'neverthrow';

import {
    normalizeOptionalText,
    normalizeRequiredText,
    type GuildFeatureRepositoryDatabase,
} from './feature-repository-types.js';
import type { ModerationCaseRecord, ModerationRepositoryError } from './moderation.js';
import { allocateModerationCaseNumber, insertModerationCase } from './moderation-case-writes.js';
import { moderationCaseEvents, moderationCases } from './schema.js';

export async function findRecentModerationCaseByTargetAction(
    db: GuildFeatureRepositoryDatabase,
    input: {
        guildId: string;
        targetUserId: string;
        action: string;
        since: Date;
        statuses?: readonly string[];
    }
): Promise<Result<ModerationCaseRecord, ModerationRepositoryError>> {
    const guildId = normalizeRequiredText(input.guildId, 'guildId');
    const targetUserId = normalizeRequiredText(input.targetUserId, 'targetUserId');
    const action = normalizeRequiredText(input.action, 'action');

    if (guildId.isErr()) return err(guildId.error);
    if (targetUserId.isErr()) return err(targetUserId.error);
    if (action.isErr()) return err(action.error);
    if (!(input.since instanceof Date) || Number.isNaN(input.since.getTime())) {
        return err({ type: 'invalid-value', field: 'since' });
    }

    const statuses = [
        ...new Set(
            input.statuses?.map(normalizeOptionalText).filter((status): status is string => Boolean(status)) ?? []
        ),
    ];

    try {
        const rows = await db
            .select()
            .from(moderationCases)
            .where(
                and(
                    eq(moderationCases.guildId, guildId.value),
                    eq(moderationCases.targetUserId, targetUserId.value),
                    eq(moderationCases.action, action.value),
                    gte(moderationCases.createdAt, input.since),
                    ...(statuses.length > 0 ? [inArray(moderationCases.status, statuses)] : [])
                )
            )
            .orderBy(desc(moderationCases.caseNumber))
            .limit(1);
        const row = rows[0];

        return row ? ok(row) : err({ type: 'not-found' });
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function createObservedModerationCase(
    db: GuildFeatureRepositoryDatabase,
    input: {
        guildId: string;
        action: string;
        targetUserId: string;
        eventType: string;
        details?: Record<string, unknown>;
    }
): Promise<Result<ModerationCaseRecord, ModerationRepositoryError>> {
    const guildId = normalizeRequiredText(input.guildId, 'guildId');
    const action = normalizeRequiredText(input.action, 'action');
    const targetUserId = normalizeRequiredText(input.targetUserId, 'targetUserId');
    const eventType = normalizeRequiredText(input.eventType, 'eventType');

    if (guildId.isErr()) return err(guildId.error);
    if (action.isErr()) return err(action.error);
    if (targetUserId.isErr()) return err(targetUserId.error);
    if (eventType.isErr()) return err(eventType.error);

    try {
        const rows = await db.transaction(async (tx) => {
            const caseNumber = await allocateModerationCaseNumber(tx, guildId.value);
            const insertedRows = await insertModerationCase(tx, {
                guildId: guildId.value,
                caseNumber,
                action: action.value,
                targetType: 'user',
                targetUserId: targetUserId.value,
                status: 'resolved',
            });
            const insertedCase = insertedRows[0];

            if (!insertedCase) {
                return [];
            }

            await tx.insert(moderationCaseEvents).values({
                caseId: insertedCase.id,
                eventType: eventType.value,
                details: input.details ?? {},
            });

            return insertedRows;
        });
        const row = rows[0];

        return row ? ok(row) : err({ type: 'database-error' });
    } catch {
        return err({ type: 'database-error' });
    }
}

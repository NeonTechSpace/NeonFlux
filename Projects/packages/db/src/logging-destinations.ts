import { and, asc, eq } from 'drizzle-orm';
import { isServerLogEventGroup, type ServerLogEventGroup } from '@neonflux/core/server-event-logging';
import { err, ok, type Result } from 'neverthrow';

import {
    normalizeRequiredText,
    type GuildFeatureRepositoryDatabase,
    type GuildFeatureRepositoryError,
} from './feature-repository-types.js';
import { guildLoggingDestinations } from './schema.js';

export type GuildLoggingDestinationRecord = Omit<typeof guildLoggingDestinations.$inferSelect, 'eventGroup'> & {
    eventGroup: ServerLogEventGroup;
};
export type GuildLoggingDestinationRepositoryError = GuildFeatureRepositoryError;

export async function listGuildLoggingDestinationsByGuildId(
    db: GuildFeatureRepositoryDatabase,
    input: { guildId: string; enabled?: boolean }
): Promise<Result<GuildLoggingDestinationRecord[], GuildLoggingDestinationRepositoryError>> {
    const guildId = normalizeRequiredText(input.guildId, 'guildId');

    if (guildId.isErr()) {
        return err(guildId.error);
    }

    try {
        const rows = await db
            .select()
            .from(guildLoggingDestinations)
            .where(
                and(
                    eq(guildLoggingDestinations.guildId, guildId.value),
                    ...(input.enabled === undefined ? [] : [eq(guildLoggingDestinations.enabled, input.enabled)])
                )
            )
            .orderBy(asc(guildLoggingDestinations.eventGroup));

        return ok(rows.map(toGuildLoggingDestinationRecord));
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function findGuildLoggingDestinationByEventGroup(
    db: GuildFeatureRepositoryDatabase,
    input: { guildId: string; eventGroup: string }
): Promise<Result<GuildLoggingDestinationRecord, GuildLoggingDestinationRepositoryError>> {
    const normalizedInput = normalizeLoggingDestinationLookupInput(input);

    if (normalizedInput.isErr()) {
        return err(normalizedInput.error);
    }

    try {
        const rows = await db
            .select()
            .from(guildLoggingDestinations)
            .where(
                and(
                    eq(guildLoggingDestinations.guildId, normalizedInput.value.guildId),
                    eq(guildLoggingDestinations.eventGroup, normalizedInput.value.eventGroup)
                )
            )
            .limit(1);
        const row = rows[0];

        return row ? ok(toGuildLoggingDestinationRecord(row)) : err({ type: 'not-found' });
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function upsertGuildLoggingDestination(
    db: GuildFeatureRepositoryDatabase,
    input: {
        guildId: string;
        eventGroup: string;
        channelId: string;
        enabled?: boolean;
    }
): Promise<Result<GuildLoggingDestinationRecord, GuildLoggingDestinationRepositoryError>> {
    const normalizedInput = normalizeLoggingDestinationInput(input);

    if (normalizedInput.isErr()) {
        return err(normalizedInput.error);
    }

    const updatedAt = new Date();

    try {
        const rows = await db
            .insert(guildLoggingDestinations)
            .values({
                guildId: normalizedInput.value.guildId,
                eventGroup: normalizedInput.value.eventGroup,
                channelId: normalizedInput.value.channelId,
                enabled: normalizedInput.value.enabled,
                updatedAt,
            })
            .onConflictDoUpdate({
                target: [guildLoggingDestinations.guildId, guildLoggingDestinations.eventGroup],
                set: {
                    channelId: normalizedInput.value.channelId,
                    enabled: normalizedInput.value.enabled,
                    updatedAt,
                },
            })
            .returning();
        const row = rows[0];

        return row ? ok(toGuildLoggingDestinationRecord(row)) : err({ type: 'database-error' });
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function deleteGuildLoggingDestination(
    db: GuildFeatureRepositoryDatabase,
    input: { guildId: string; eventGroup: string }
): Promise<Result<GuildLoggingDestinationRecord, GuildLoggingDestinationRepositoryError>> {
    const normalizedInput = normalizeLoggingDestinationLookupInput(input);

    if (normalizedInput.isErr()) {
        return err(normalizedInput.error);
    }

    try {
        const rows = await db
            .delete(guildLoggingDestinations)
            .where(
                and(
                    eq(guildLoggingDestinations.guildId, normalizedInput.value.guildId),
                    eq(guildLoggingDestinations.eventGroup, normalizedInput.value.eventGroup)
                )
            )
            .returning();
        const row = rows[0];

        return row ? ok(toGuildLoggingDestinationRecord(row)) : err({ type: 'not-found' });
    } catch {
        return err({ type: 'database-error' });
    }
}

function normalizeLoggingDestinationInput(input: {
    guildId: string;
    eventGroup: string;
    channelId: string;
    enabled?: boolean;
}): Result<
    {
        guildId: string;
        eventGroup: ServerLogEventGroup;
        channelId: string;
        enabled: boolean;
    },
    GuildLoggingDestinationRepositoryError
> {
    const lookupInput = normalizeLoggingDestinationLookupInput(input);
    const channelId = normalizeRequiredText(input.channelId, 'channelId');

    if (lookupInput.isErr()) return err(lookupInput.error);
    if (channelId.isErr()) return err(channelId.error);

    return ok({
        ...lookupInput.value,
        channelId: channelId.value,
        enabled: input.enabled ?? true,
    });
}

function normalizeLoggingDestinationLookupInput(input: { guildId: string; eventGroup: string }): Result<
    {
        guildId: string;
        eventGroup: ServerLogEventGroup;
    },
    GuildLoggingDestinationRepositoryError
> {
    const guildId = normalizeRequiredText(input.guildId, 'guildId');

    if (guildId.isErr()) {
        return err(guildId.error);
    }

    if (!isServerLogEventGroup(input.eventGroup)) {
        return err({ type: 'invalid-value', field: 'eventGroup' });
    }

    return ok({
        guildId: guildId.value,
        eventGroup: input.eventGroup,
    });
}

function toGuildLoggingDestinationRecord(
    row: typeof guildLoggingDestinations.$inferSelect
): GuildLoggingDestinationRecord {
    if (!isServerLogEventGroup(row.eventGroup)) {
        throw new Error(`Invalid server log event group stored in database: ${row.eventGroup}`);
    }

    return {
        ...row,
        eventGroup: row.eventGroup,
    };
}

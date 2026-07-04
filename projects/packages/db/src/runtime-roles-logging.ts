import { api } from '@neonflux/convex/api';
import { isServerLogEventGroup } from '@neonflux/core/server-event-logging';
import { err, ok, type Result } from 'neverthrow';

import type {
    AutoroleRepositoryError,
    AutoroleRuleRecord,
    GuildFeatureRepositoryError,
    GuildLoggingDestinationRecord,
    GuildLoggingDestinationRepositoryError,
} from './contracts.js';

import type { ConvexDatabase } from './convex.js';

type ConvexQueryReference = Parameters<ConvexDatabase['client']['query']>[0];
type ConvexMutationReference = Parameters<ConvexDatabase['client']['mutation']>[0];

const convexApi = api as unknown as {
    autoroles: {
        deleteAutoroleRule: ConvexMutationReference;
        listAutoroleRulesByGuildId: ConvexQueryReference;
        listEnabledAutoroleRulesByGuildId: ConvexQueryReference;
        upsertAutoroleRule: ConvexMutationReference;
    };
    logging_destinations: {
        deleteGuildLoggingDestination: ConvexMutationReference;
        listGuildLoggingDestinationsByGuildId: ConvexQueryReference;
        readGuildLoggingDestinationByEventGroup: ConvexQueryReference;
        upsertGuildLoggingDestination: ConvexMutationReference;
    };
};

type AutoroleDb = ConvexDatabase;
type LoggingDestinationDb = ConvexDatabase;

type ConvexAutoroleRuleRecord = {
    createdAt: string;
    enabled: boolean;
    guildId: string;
    id: string;
    name: string | null;
    roleId: string;
    updatedAt: string;
};

type ConvexGuildLoggingDestinationRecord = {
    channelId: string;
    createdAt: string;
    enabled: boolean;
    eventGroup: GuildLoggingDestinationRecord['eventGroup'];
    guildId: string;
    id: string;
    updatedAt: string;
};

export async function upsertAutoroleRule(
    db: AutoroleDb,
    input: {
        enabled?: boolean;
        guildId: string;
        name?: string;
        roleId: string;
    }
): Promise<Result<AutoroleRuleRecord, AutoroleRepositoryError>> {
    const normalizedInput = normalizeAutoroleRuleInput(input);

    if (normalizedInput.isErr()) {
        return err(normalizedInput.error);
    }

    try {
        const rule = (await db.client.mutation(convexApi.autoroles.upsertAutoroleRule, {
            ...normalizedInput.value,
            ...(input.enabled === undefined ? {} : { enabled: input.enabled }),
            ...(normalizeOptionalText(input.name) ? { name: normalizeOptionalText(input.name) } : {}),
        })) as ConvexAutoroleRuleRecord;

        return ok(toAutoroleRuleRecord(rule));
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function listAutoroleRulesByGuildId(
    db: AutoroleDb,
    input: { guildId: string }
): Promise<Result<AutoroleRuleRecord[], AutoroleRepositoryError>> {
    return listAutoroles(db, {
        enabledOnly: false,
        guildId: input.guildId,
    });
}

export async function listEnabledAutoroleRulesByGuildId(
    db: AutoroleDb,
    input: { guildId: string }
): Promise<Result<AutoroleRuleRecord[], AutoroleRepositoryError>> {
    return listAutoroles(db, {
        enabledOnly: true,
        guildId: input.guildId,
    });
}

export async function deleteAutoroleRule(
    db: AutoroleDb,
    input: { guildId: string; roleId: string }
): Promise<Result<AutoroleRuleRecord, AutoroleRepositoryError>> {
    const normalizedInput = normalizeAutoroleRuleInput(input);

    if (normalizedInput.isErr()) {
        return err(normalizedInput.error);
    }

    try {
        const rule = (await db.client.mutation(
            convexApi.autoroles.deleteAutoroleRule,
            normalizedInput.value
        )) as ConvexAutoroleRuleRecord | null;

        return rule ? ok(toAutoroleRuleRecord(rule)) : err({ type: 'not-found' });
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function listGuildLoggingDestinationsByGuildId(
    db: LoggingDestinationDb,
    input: { enabled?: boolean; guildId: string }
): Promise<Result<GuildLoggingDestinationRecord[], GuildLoggingDestinationRepositoryError>> {
    const guildId = normalizeRequiredText(input.guildId, 'guildId');

    if (guildId.isErr()) {
        return err(guildId.error);
    }

    try {
        const destinations = (await db.client.query(
            convexApi.logging_destinations.listGuildLoggingDestinationsByGuildId,
            {
                ...(input.enabled === undefined ? {} : { enabled: input.enabled }),
                guildId: guildId.value,
            }
        )) as ConvexGuildLoggingDestinationRecord[];

        return ok(destinations.map(toGuildLoggingDestinationRecord));
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function findGuildLoggingDestinationByEventGroup(
    db: LoggingDestinationDb,
    input: { eventGroup: string; guildId: string }
): Promise<Result<GuildLoggingDestinationRecord, GuildLoggingDestinationRepositoryError>> {
    const normalizedInput = normalizeLoggingDestinationLookupInput(input);

    if (normalizedInput.isErr()) {
        return err(normalizedInput.error);
    }

    try {
        const destination = (await db.client.query(
            convexApi.logging_destinations.readGuildLoggingDestinationByEventGroup,
            normalizedInput.value
        )) as ConvexGuildLoggingDestinationRecord | null;

        return destination ? ok(toGuildLoggingDestinationRecord(destination)) : err({ type: 'not-found' });
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function upsertGuildLoggingDestination(
    db: LoggingDestinationDb,
    input: {
        channelId: string;
        enabled?: boolean;
        eventGroup: string;
        guildId: string;
    }
): Promise<Result<GuildLoggingDestinationRecord, GuildLoggingDestinationRepositoryError>> {
    const normalizedInput = normalizeLoggingDestinationInput(input);

    if (normalizedInput.isErr()) {
        return err(normalizedInput.error);
    }

    try {
        const destination = (await db.client.mutation(
            convexApi.logging_destinations.upsertGuildLoggingDestination,
            normalizedInput.value
        )) as ConvexGuildLoggingDestinationRecord;

        return ok(toGuildLoggingDestinationRecord(destination));
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function deleteGuildLoggingDestination(
    db: LoggingDestinationDb,
    input: { eventGroup: string; guildId: string }
): Promise<Result<GuildLoggingDestinationRecord, GuildLoggingDestinationRepositoryError>> {
    const normalizedInput = normalizeLoggingDestinationLookupInput(input);

    if (normalizedInput.isErr()) {
        return err(normalizedInput.error);
    }

    try {
        const destination = (await db.client.mutation(
            convexApi.logging_destinations.deleteGuildLoggingDestination,
            normalizedInput.value
        )) as ConvexGuildLoggingDestinationRecord | null;

        return destination ? ok(toGuildLoggingDestinationRecord(destination)) : err({ type: 'not-found' });
    } catch {
        return err({ type: 'database-error' });
    }
}

async function listAutoroles(
    db: ConvexDatabase,
    input: { enabledOnly: boolean; guildId: string }
): Promise<Result<AutoroleRuleRecord[], AutoroleRepositoryError>> {
    const guildId = normalizeRequiredText(input.guildId, 'guildId');

    if (guildId.isErr()) {
        return err(guildId.error);
    }

    try {
        const rules = (await db.client.query(
            input.enabledOnly
                ? convexApi.autoroles.listEnabledAutoroleRulesByGuildId
                : convexApi.autoroles.listAutoroleRulesByGuildId,
            { guildId: guildId.value, limit: 1000 }
        )) as ConvexAutoroleRuleRecord[];

        return ok(rules.map(toAutoroleRuleRecord));
    } catch {
        return err({ type: 'database-error' });
    }
}

function toAutoroleRuleRecord(record: ConvexAutoroleRuleRecord): AutoroleRuleRecord {
    return {
        createdAt: new Date(record.createdAt),
        enabled: record.enabled,
        guildId: record.guildId,
        id: record.id,
        name: record.name,
        roleId: record.roleId,
        updatedAt: new Date(record.updatedAt),
    };
}

function toGuildLoggingDestinationRecord(record: ConvexGuildLoggingDestinationRecord): GuildLoggingDestinationRecord {
    return {
        channelId: record.channelId,
        createdAt: new Date(record.createdAt),
        enabled: record.enabled,
        eventGroup: record.eventGroup,
        guildId: record.guildId,
        id: record.id,
        updatedAt: new Date(record.updatedAt),
    };
}

function normalizeAutoroleRuleInput(input: {
    guildId: string;
    roleId: string;
}): Result<{ guildId: string; roleId: string }, AutoroleRepositoryError> {
    const guildId = normalizeRequiredText(input.guildId, 'guildId');
    const roleId = normalizeRequiredText(input.roleId, 'roleId');

    if (guildId.isErr()) return err(guildId.error);
    if (roleId.isErr()) return err(roleId.error);

    return ok({ guildId: guildId.value, roleId: roleId.value });
}

function normalizeLoggingDestinationInput(input: {
    channelId: string;
    enabled?: boolean;
    eventGroup: string;
    guildId: string;
}): Result<
    {
        channelId: string;
        enabled: boolean;
        eventGroup: GuildLoggingDestinationRecord['eventGroup'];
        guildId: string;
    },
    GuildLoggingDestinationRepositoryError
> {
    const lookup = normalizeLoggingDestinationLookupInput(input);
    const channelId = normalizeRequiredText(input.channelId, 'channelId');

    if (lookup.isErr()) return err(lookup.error);
    if (channelId.isErr()) return err(channelId.error);

    return ok({
        ...lookup.value,
        channelId: channelId.value,
        enabled: input.enabled ?? true,
    });
}

function normalizeLoggingDestinationLookupInput(input: {
    eventGroup: string;
    guildId: string;
}): Result<
    { eventGroup: GuildLoggingDestinationRecord['eventGroup']; guildId: string },
    GuildLoggingDestinationRepositoryError
> {
    const guildId = normalizeRequiredText(input.guildId, 'guildId');

    if (guildId.isErr()) {
        return err(guildId.error);
    }

    if (!isServerLogEventGroup(input.eventGroup)) {
        return err({ field: 'eventGroup', type: 'invalid-value' });
    }

    return ok({
        eventGroup: input.eventGroup,
        guildId: guildId.value,
    });
}

function normalizeRequiredText(
    value: string | null | undefined,
    field: string
): Result<string, GuildFeatureRepositoryError> {
    const normalizedValue = value?.trim();

    if (!normalizedValue) {
        return err({ field, type: 'missing-input' });
    }

    return ok(normalizedValue);
}

function normalizeOptionalText(value: string | null | undefined): string | undefined {
    const normalizedValue = value?.trim();

    return normalizedValue && normalizedValue.length > 0 ? normalizedValue : undefined;
}

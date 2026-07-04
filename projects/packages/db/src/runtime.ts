import { api } from '@neonflux/convex/api';
import { err, ok, type Result } from 'neverthrow';

import type {
    BotActionEventCursor,
    BotActionEventPage,
    BotActionEventRecord,
    BotInstallationRecord,
    BotInstallationRepositoryError,
    DeploymentConfigInput,
    DeploymentConfigRecord,
    DeploymentConfigRepositoryError,
    GuildSecurityPolicyRecord,
    GuildSecurityPolicyRepositoryError,
    LoggingRepositoryError,
} from './contracts.js';

import type { ConvexDatabase } from './convex.js';

type ConvexQueryReference = Parameters<ConvexDatabase['client']['query']>[0];
type ConvexMutationReference = Parameters<ConvexDatabase['client']['mutation']>[0];

const convexApi = api as unknown as {
    core: {
        deleteBotInstallation: ConvexMutationReference;
        listBotInstallationGuildIdsPage: ConvexQueryReference;
        readDeploymentConfig: ConvexQueryReference;
        upsertDeploymentConfig: ConvexMutationReference;
        upsertBotInstallation: ConvexMutationReference;
    };
    events: {
        listBotActionEventPageByGuildId: ConvexQueryReference;
        listBotActionEventsByGuildId: ConvexQueryReference;
        recordBotActionEvent: ConvexMutationReference;
    };
    security_policies: {
        listGuildSecurityPoliciesByGuildIds: ConvexQueryReference;
    };
};

type DeploymentConfigDb = ConvexDatabase;
type BotInstallationDb = ConvexDatabase;
type SecurityPolicyDb = ConvexDatabase;
type BotActionEventDb = ConvexDatabase;

type ConvexDeploymentConfigRecord =
    | {
          instanceMode: 'single';
          ownerIds: string[];
          publicWebUrl: string | null;
          singleGuildId: string;
      }
    | {
          instanceMode: 'multi';
          ownerIds: string[];
          publicWebUrl: string | null;
      };

type ConvexBotInstallationRecord = {
    guildId: string;
    installedAt: string;
    updatedAt: string;
};

type ConvexGuildSecurityPolicyRecord = {
    createdAt: string;
    defconLevel: 1 | 2 | 3;
    guildId: string;
    updatedAt: string;
};

type ConvexBotActionEventRecord = {
    action: string;
    actorUserId: string | null;
    createdAt: string;
    feature: string;
    guildId: string | null;
    id: string;
    metadata: Record<string, unknown>;
    targetId: string | null;
};

type ConvexBotActionEventPage = {
    nextCursor?: { createdAt: string; id: string };
    records: ConvexBotActionEventRecord[];
};

export async function findDeploymentConfig(
    db: DeploymentConfigDb
): Promise<Result<DeploymentConfigRecord, DeploymentConfigRepositoryError>> {
    try {
        const config = (await db.client.query(
            convexApi.core.readDeploymentConfig,
            {}
        )) as ConvexDeploymentConfigRecord | null;

        return config ? ok(config) : err('not-found');
    } catch {
        return err('database-error');
    }
}

export async function upsertDeploymentConfig(
    db: DeploymentConfigDb,
    input: DeploymentConfigInput
): Promise<Result<DeploymentConfigRecord, DeploymentConfigRepositoryError>> {
    const normalizedInput = normalizeDeploymentConfigInput(input);

    if (normalizedInput.isErr()) return err(normalizedInput.error);

    try {
        const config = (await db.client.mutation(
            convexApi.core.upsertDeploymentConfig,
            normalizedInput.value
        )) as ConvexDeploymentConfigRecord;

        return ok(config);
    } catch {
        return err('database-error');
    }
}

export async function upsertBotInstallation(
    db: BotInstallationDb,
    input: { guildId: string }
): Promise<Result<BotInstallationRecord, BotInstallationRepositoryError>> {
    try {
        const installation = (await db.client.mutation(
            convexApi.core.upsertBotInstallation,
            input
        )) as ConvexBotInstallationRecord;

        return ok(toBotInstallationRecord(installation));
    } catch (error) {
        return err(mapConvexMissingInputError(error, 'missing-guild-id'));
    }
}

export async function listBotInstallationGuildIds(
    db: BotInstallationDb
): Promise<Result<string[], BotInstallationRepositoryError>> {
    try {
        const guildIds: string[] = [];
        let afterGuildId: string | undefined;

        do {
            const page = (await db.client.query(convexApi.core.listBotInstallationGuildIdsPage, {
                ...(afterGuildId ? { afterGuildId } : {}),
                limit: 500,
            })) as { guildIds: string[]; nextCursor?: string };

            guildIds.push(...page.guildIds);
            afterGuildId = page.nextCursor;
        } while (afterGuildId);

        return ok(guildIds);
    } catch {
        return err('database-error');
    }
}

export async function deleteBotInstallation(
    db: BotInstallationDb,
    input: { guildId: string }
): Promise<Result<BotInstallationRecord, BotInstallationRepositoryError>> {
    try {
        const installation = (await db.client.mutation(
            convexApi.core.deleteBotInstallation,
            input
        )) as ConvexBotInstallationRecord | null;

        return installation ? ok(toBotInstallationRecord(installation)) : err('not-found');
    } catch (error) {
        return err(mapConvexMissingInputError(error, 'missing-guild-id'));
    }
}

export async function listGuildSecurityPoliciesByGuildIds(
    db: SecurityPolicyDb,
    input: { guildIds: readonly string[] }
): Promise<Result<GuildSecurityPolicyRecord[], GuildSecurityPolicyRepositoryError>> {
    try {
        const policies = (await db.client.query(convexApi.security_policies.listGuildSecurityPoliciesByGuildIds, {
            guildIds: [...input.guildIds],
        })) as ConvexGuildSecurityPolicyRecord[];

        return ok(policies.map(toGuildSecurityPolicyRecord));
    } catch {
        return err('database-error');
    }
}

export async function recordBotActionEvent(
    db: BotActionEventDb,
    input: {
        action: string;
        actorUserId?: string;
        feature: string;
        guildId?: string | null;
        metadata?: Record<string, unknown>;
        targetId?: string;
    }
): Promise<Result<BotActionEventRecord, LoggingRepositoryError>> {
    try {
        const event = (await db.client.mutation(
            convexApi.events.recordBotActionEvent,
            input
        )) as ConvexBotActionEventRecord;

        return ok(toBotActionEventRecord(event));
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function listBotActionEventsByGuildId(
    db: BotActionEventDb,
    input: { feature?: string; guildId: string; limit?: number }
): Promise<Result<BotActionEventRecord[], LoggingRepositoryError>> {
    try {
        const events = (await db.client.query(
            convexApi.events.listBotActionEventsByGuildId,
            input
        )) as ConvexBotActionEventRecord[];

        return ok(events.map(toBotActionEventRecord));
    } catch {
        return err({ type: 'database-error' });
    }
}

export async function listBotActionEventPageByGuildId(
    db: BotActionEventDb,
    input: {
        cursor?: BotActionEventCursor;
        feature?: string;
        guildId: string;
        limit?: number;
        search?: string;
        searchOffsetMinutes?: number;
        searchScope?: 'actor' | 'all' | 'channel' | 'event' | 'message' | 'metadata' | 'time';
    }
): Promise<Result<BotActionEventPage, LoggingRepositoryError>> {
    try {
        const page = (await db.client.query(convexApi.events.listBotActionEventPageByGuildId, {
            ...input,
            ...(input.cursor ? { cursor: toConvexBotActionEventCursor(input.cursor) } : {}),
        })) as ConvexBotActionEventPage;

        return ok({
            ...(page.nextCursor ? { nextCursor: toBotActionEventCursor(page.nextCursor) } : {}),
            records: page.records.map(toBotActionEventRecord),
        });
    } catch {
        return err({ type: 'database-error' });
    }
}

function toBotInstallationRecord(record: ConvexBotInstallationRecord): BotInstallationRecord {
    return {
        guildId: record.guildId,
        installedAt: new Date(record.installedAt),
        updatedAt: new Date(record.updatedAt),
    };
}

function toGuildSecurityPolicyRecord(record: ConvexGuildSecurityPolicyRecord): GuildSecurityPolicyRecord {
    return {
        createdAt: new Date(record.createdAt),
        defconLevel: record.defconLevel,
        guildId: record.guildId,
        updatedAt: new Date(record.updatedAt),
    };
}

function toBotActionEventRecord(record: ConvexBotActionEventRecord): BotActionEventRecord {
    return {
        action: record.action,
        actorUserId: record.actorUserId,
        createdAt: new Date(record.createdAt),
        feature: record.feature,
        guildId: record.guildId,
        id: record.id,
        metadata: record.metadata,
        targetId: record.targetId,
    };
}

function toConvexBotActionEventCursor(cursor: BotActionEventCursor): { createdAt: string; id: string } {
    return {
        createdAt: cursor.createdAt.toISOString(),
        id: cursor.id,
    };
}

function toBotActionEventCursor(cursor: { createdAt: string; id: string }): BotActionEventCursor {
    return {
        createdAt: new Date(cursor.createdAt),
        id: cursor.id,
    };
}

function normalizeDeploymentConfigInput(
    input: DeploymentConfigInput
): Result<Record<string, unknown>, DeploymentConfigRepositoryError> {
    const instanceMode = input.instanceMode?.trim();
    const publicWebUrl = normalizeOptionalText(input.publicWebUrl);
    const ownerIds = input.ownerIds?.map((ownerId) => ownerId.trim()).filter((ownerId) => ownerId.length > 0) ?? [];

    switch (instanceMode) {
        case undefined:
        case '':
            return err('missing-instance-mode');

        case 'single': {
            const singleGuildId = normalizeOptionalText(input.singleGuildId);

            if (!singleGuildId) return err('missing-single-guild-id');

            return ok({
                instanceMode,
                ownerIds,
                ...(publicWebUrl ? { publicWebUrl } : {}),
                singleGuildId,
            });
        }

        case 'multi':
            return ok({
                instanceMode,
                ownerIds,
                ...(publicWebUrl ? { publicWebUrl } : {}),
            });

        default:
            return err('invalid-instance-mode');
    }
}

function normalizeOptionalText(value: string | null | undefined): string | undefined {
    const normalizedValue = value?.trim();
    return normalizedValue && normalizedValue.length > 0 ? normalizedValue : undefined;
}

function mapConvexMissingInputError<MissingError extends string>(
    error: unknown,
    missingError: MissingError
): MissingError | 'database-error' {
    return error instanceof Error && error.message.includes('missing-input') ? missingError : 'database-error';
}

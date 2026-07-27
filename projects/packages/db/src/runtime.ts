import { api } from '@neonflux/convex-api';
import { err, ok, type Result } from 'neverthrow';

import type {
    BotActionEventCursor,
    BotActionEventPage,
    BotActionEventRecord,
    BotInstallationRecord,
    BotInstallationRepositoryError,
    DashboardGuildAuthorizationFacts,
    DashboardGuildAuthorizationFactsRepositoryError,
    DeploymentConfigInput,
    DeploymentConfigRecord,
    DeploymentConfigRepositoryError,
    GuildSecurityPolicyRecord,
    GuildSecurityPolicyRepositoryError,
    LoggingRepositoryError,
} from './contracts.js';

import type { ConvexDatabase } from './convex.js';
import { compactConvexArgs } from './convex-args.js';

type DeploymentConfigDb = ConvexDatabase;
type BotInstallationDb = ConvexDatabase;
type SecurityPolicyDb = ConvexDatabase;
type BotActionEventDb = ConvexDatabase;

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

export async function findDeploymentConfig(
    db: DeploymentConfigDb
): Promise<Result<DeploymentConfigRecord, DeploymentConfigRepositoryError>> {
    try {
        const config = await db.client.query(api.core.readDeploymentConfig, {});

        return config ? ok(config) : err('not-found');
    } catch {
        return err('database-error');
    }
}

export async function readDashboardGuildAuthorizationFacts(
    db: DeploymentConfigDb,
    input: { guildId: string }
): Promise<Result<DashboardGuildAuthorizationFacts, DashboardGuildAuthorizationFactsRepositoryError>> {
    const guildId = input.guildId.trim();

    if (!guildId) {
        return err('missing-guild-id');
    }

    try {
        const value: unknown = await db.client.query(api.core.readDashboardGuildAuthorizationFacts, { guildId });
        const facts = parseDashboardGuildAuthorizationFacts(value);

        return facts ? ok(facts) : err('database-error');
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
        const config = await db.client.mutation(api.core.upsertDeploymentConfig, normalizedInput.value);

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
        const installation = await db.client.mutation(api.core.upsertBotInstallation, input);

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
            const page = await db.client.query(api.core.listBotInstallationGuildIdsPage, {
                ...(afterGuildId ? { afterGuildId } : {}),
                limit: 500,
            });

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
        const installation = await db.client.mutation(api.core.deleteBotInstallation, input);

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
        const policies = await db.client.query(api.security_policies.listGuildSecurityPoliciesByGuildIds, {
            guildIds: [...input.guildIds],
        });

        return ok(policies.map(toGuildSecurityPolicyRecord));
    } catch {
        return err('database-error');
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
        const page = await db.client.query(
            api.events.listBotActionEventPageByGuildId,
            compactConvexArgs({
                cursor: input.cursor,
                feature: input.feature,
                guildId: input.guildId,
                limit: input.limit,
                search: input.search,
                searchOffsetMinutes: input.searchOffsetMinutes,
                searchScope: input.searchScope,
            })
        );

        return ok({
            ...(page.nextCursor ? { nextCursor: page.nextCursor } : {}),
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

function parseDashboardGuildAuthorizationFacts(value: unknown): DashboardGuildAuthorizationFacts | undefined {
    if (!isRecord(value) || typeof value.botInstalled !== 'boolean' || !isStoredDefconLevel(value.storedDefconLevel)) {
        return undefined;
    }

    const deployment = parseDashboardAuthorizationDeployment(value.deployment);
    if (deployment === undefined) return undefined;

    return {
        botInstalled: value.botInstalled,
        deployment,
        storedDefconLevel: value.storedDefconLevel,
    };
}

function parseDashboardAuthorizationDeployment(
    value: unknown
): DashboardGuildAuthorizationFacts['deployment'] | undefined {
    if (value === null) return null;
    if (!isRecord(value)) return undefined;

    if (value.instanceMode === 'multi') {
        return { instanceMode: 'multi' };
    }

    if (value.instanceMode === 'single' && typeof value.singleGuildId === 'string' && value.singleGuildId.trim()) {
        return {
            instanceMode: 'single',
            singleGuildId: value.singleGuildId,
        };
    }

    return undefined;
}

function isStoredDefconLevel(value: unknown): value is 1 | 2 | 3 | null {
    return value === null || value === 1 || value === 2 || value === 3;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
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

function normalizeDeploymentConfigInput(input: DeploymentConfigInput) {
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

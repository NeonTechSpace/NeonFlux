import type { InstanceMode } from '@neonflux/config';
import { eq } from 'drizzle-orm';
import type { PgDatabase } from 'drizzle-orm/pg-core/db';
import type { PgQueryResultHKT } from 'drizzle-orm/pg-core/session';
import { err, ok, type Result } from 'neverthrow';

import type * as schema from './schema.js';
import { deploymentConfig } from './schema.js';

const deploymentConfigId = 'default';

export type DeploymentConfigRecord =
    | {
          instanceMode: 'single';
          singleGuildId: string;
          publicWebUrl: string | null;
          ownerIds: string[];
      }
    | {
          instanceMode: 'multi';
          publicWebUrl: string | null;
          ownerIds: string[];
      };

export type DeploymentConfigInput = {
    instanceMode: string | null | undefined;
    singleGuildId?: string | null;
    publicWebUrl?: string | null;
    ownerIds?: readonly string[];
};

export type DeploymentConfigRepositoryError =
    | 'missing-instance-mode'
    | 'invalid-instance-mode'
    | 'missing-single-guild-id'
    | 'not-found'
    | 'database-error';

type DeploymentConfigDatabase = PgDatabase<PgQueryResultHKT, typeof schema>;
type DeploymentConfigRow = typeof deploymentConfig.$inferSelect;

export async function upsertDeploymentConfig(
    db: DeploymentConfigDatabase,
    input: DeploymentConfigInput
): Promise<Result<DeploymentConfigRecord, DeploymentConfigRepositoryError>> {
    const normalizedConfigResult = normalizeDeploymentConfigInput(input);

    if (normalizedConfigResult.isErr()) {
        return err(normalizedConfigResult.error);
    }

    const normalizedConfig = normalizedConfigResult.value;
    const updatedAt = new Date();

    try {
        const configs = await db
            .insert(deploymentConfig)
            .values({
                id: deploymentConfigId,
                instanceMode: normalizedConfig.instanceMode,
                singleGuildId: normalizedConfig.instanceMode === 'single' ? normalizedConfig.singleGuildId : null,
                publicWebUrl: normalizedConfig.publicWebUrl,
                ownerIds: normalizedConfig.ownerIds,
                updatedAt,
            })
            .onConflictDoUpdate({
                target: deploymentConfig.id,
                set: {
                    instanceMode: normalizedConfig.instanceMode,
                    singleGuildId: normalizedConfig.instanceMode === 'single' ? normalizedConfig.singleGuildId : null,
                    publicWebUrl: normalizedConfig.publicWebUrl,
                    ownerIds: normalizedConfig.ownerIds,
                    updatedAt,
                },
            })
            .returning();
        const config = configs[0];

        if (!config) {
            return err('database-error');
        }

        return toDeploymentConfigRecord(config);
    } catch {
        return err('database-error');
    }
}

export async function findDeploymentConfig(
    db: DeploymentConfigDatabase
): Promise<Result<DeploymentConfigRecord, DeploymentConfigRepositoryError>> {
    try {
        const configs = await db
            .select()
            .from(deploymentConfig)
            .where(eq(deploymentConfig.id, deploymentConfigId))
            .limit(1);
        const config = configs[0];

        if (!config) {
            return err('not-found');
        }

        return toDeploymentConfigRecord(config);
    } catch {
        return err('database-error');
    }
}

function normalizeDeploymentConfigInput(
    input: DeploymentConfigInput
): Result<DeploymentConfigRecord, DeploymentConfigRepositoryError> {
    const modeResult = normalizeInstanceMode(input.instanceMode);

    if (modeResult.isErr()) {
        return err(modeResult.error);
    }

    const publicWebUrl = normalizeOptionalString(input.publicWebUrl);
    const ownerIds = normalizeOwnerIds(input.ownerIds);

    switch (modeResult.value) {
        case 'single': {
            const singleGuildId = normalizeOptionalString(input.singleGuildId);

            if (!singleGuildId) {
                return err('missing-single-guild-id');
            }

            return ok({
                instanceMode: 'single',
                singleGuildId,
                publicWebUrl,
                ownerIds,
            });
        }

        case 'multi':
            return ok({
                instanceMode: 'multi',
                publicWebUrl,
                ownerIds,
            });
    }
}

function normalizeInstanceMode(
    instanceMode: string | null | undefined
): Result<InstanceMode, 'missing-instance-mode' | 'invalid-instance-mode'> {
    const normalizedMode = instanceMode?.trim();

    if (!normalizedMode) {
        return err('missing-instance-mode');
    }

    switch (normalizedMode) {
        case 'single':
        case 'multi':
            return ok(normalizedMode);

        default:
            return err('invalid-instance-mode');
    }
}

function normalizeOptionalString(value: string | null | undefined): string | null {
    const normalizedValue = value?.trim();

    return normalizedValue && normalizedValue.length > 0 ? normalizedValue : null;
}

function normalizeOwnerIds(ownerIds: readonly string[] | undefined): string[] {
    return ownerIds?.map((ownerId) => ownerId.trim()).filter((ownerId) => ownerId.length > 0) ?? [];
}

function toDeploymentConfigRecord(
    config: DeploymentConfigRow
): Result<DeploymentConfigRecord, DeploymentConfigRepositoryError> {
    const publicWebUrl = normalizeOptionalString(config.publicWebUrl);
    const ownerIds = normalizeOwnerIds(config.ownerIds);

    switch (config.instanceMode) {
        case 'single': {
            const singleGuildId = normalizeOptionalString(config.singleGuildId);

            if (!singleGuildId) {
                return err('database-error');
            }

            return ok({
                instanceMode: 'single',
                singleGuildId,
                publicWebUrl,
                ownerIds,
            });
        }

        case 'multi':
            return ok({
                instanceMode: 'multi',
                publicWebUrl,
                ownerIds,
            });

        default:
            return err('database-error');
    }
}

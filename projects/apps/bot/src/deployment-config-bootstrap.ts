import type { AppConfig, AppMode } from '@neonflux/config';
import {
    findDeploymentConfig,
    upsertDeploymentConfig,
    type DeploymentConfigRecord,
    type DeploymentConfigRepositoryError,
} from '@neonflux/db';
import { err, ok, type Result } from 'neverthrow';

type DeploymentConfigDatabase = Parameters<typeof upsertDeploymentConfig>[0];

export type DeploymentConfigBootstrapError = 'deployment-config-not-found' | 'database-error';

export async function bootstrapDeploymentConfig(
    db: DeploymentConfigDatabase,
    config: AppConfig
): Promise<Result<AppMode, DeploymentConfigBootstrapError>> {
    const upsertResult = await upsertDeploymentConfig(db, {
        instanceMode: config.instanceMode,
        ...(config.instanceMode === 'single' ? { singleGuildId: config.singleGuildId } : {}),
        ...(config.publicWebUrl ? { publicWebUrl: config.publicWebUrl } : {}),
        ownerIds: config.ownerIds,
    });

    if (upsertResult.isErr()) {
        return mapDeploymentConfigRepositoryError(upsertResult.error);
    }

    const findResult = await findDeploymentConfig(db);

    if (findResult.isErr()) {
        return mapDeploymentConfigRepositoryError(findResult.error);
    }

    return ok(toAppMode(findResult.value));
}

function toAppMode(config: DeploymentConfigRecord): AppMode {
    switch (config.instanceMode) {
        case 'single':
            return {
                instanceMode: 'single',
                singleGuildId: config.singleGuildId,
            };

        case 'multi':
            return {
                instanceMode: 'multi',
            };
    }
}

function mapDeploymentConfigRepositoryError(
    errorValue: DeploymentConfigRepositoryError
): Result<never, DeploymentConfigBootstrapError> {
    switch (errorValue) {
        case 'not-found':
            return err('deployment-config-not-found');

        case 'database-error':
        case 'invalid-instance-mode':
        case 'missing-instance-mode':
        case 'missing-single-guild-id':
            return err('database-error');
    }
}

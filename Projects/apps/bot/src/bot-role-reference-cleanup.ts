import { cleanupDeletedGuildRoleReferences, findRoleReconciliationSettingsByGuildId } from '@neonflux/db';
import { err, ok, type Result } from 'neverthrow';

import type { BotFeatureHandlerContext } from './bot-feature-types.js';

export type BotDeletedRoleReferenceCleanupEvent = {
    type: 'role.deleted';
    guildId: string;
    roleId: string;
};

export type BotDeletedRoleReferenceCleanupResult =
    | {
          status: 'applied';
          action: 'event.role_reconciliation.structure_cleaned';
      }
    | { status: 'ignored'; reason: 'no-feature-handler' };

export async function cleanupDeletedRoleReferences(
    context: BotFeatureHandlerContext,
    event: BotDeletedRoleReferenceCleanupEvent
): Promise<Result<BotDeletedRoleReferenceCleanupResult, 'database-error'>> {
    const settingsResult = await findRoleReconciliationSettingsByGuildId(context.db, {
        guildId: event.guildId,
    });

    if (settingsResult.isErr()) {
        return err('database-error');
    }

    if (!settingsResult.value.enabled || !settingsResult.value.cleanupDeletedRoleReferences) {
        return ok({ status: 'ignored', reason: 'no-feature-handler' });
    }

    const cleanupResult = await cleanupDeletedGuildRoleReferences(context.db, {
        guildId: event.guildId,
        roleId: event.roleId,
    });

    if (cleanupResult.isErr()) {
        return err('database-error');
    }

    if (cleanupResult.value.status === 'unchanged') {
        return ok({ status: 'ignored', reason: 'no-feature-handler' });
    }

    return ok({
        status: 'applied',
        action: 'event.role_reconciliation.structure_cleaned',
    });
}

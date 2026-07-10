import '@tanstack/react-start/server-only';

import {
    createStructureBackup,
    structureAuditActions,
    structureBackupSources,
    structureBackupStatuses,
} from '@neonflux/db';
import type { StructureImportActionRecord } from '@neonflux/db';

import { getWebDb } from './db.server.js';
import type { AuthorizedStructureContext } from './dashboard-structure-context.server.js';
import type { DashboardStructureSnapshot } from './dashboard-structure-diff.js';
import { readStructureActionChanges } from './dashboard-structure-apply-plan.js';

type RestorePointRiskSummary = {
    deleteCount: number;
    permissionRiskCount: number;
    riskyActionCount: number;
};

export async function createApplyRestorePoint(
    context: AuthorizedStructureContext,
    snapshot: DashboardStructureSnapshot,
    importRunId: string,
    riskSummary: RestorePointRiskSummary
): Promise<{ id: string } | 'database-error'> {
    const database = await getWebDb();
    const result = await createStructureBackup(database.db, {
        audit: {
            action: structureAuditActions.backupRestorePointCreated,
            actorUserId: context.actor.actorUserId,
            targetId: importRunId,
            metadata: {
                source: structureBackupSources.restorePoint,
                categoryCount: snapshot.categories.length,
                channelCount: snapshot.channels.length,
                deleteCount: riskSummary.deleteCount,
                permissionRiskCount: riskSummary.permissionRiskCount,
                riskyActionCount: riskSummary.riskyActionCount,
                roleCount: snapshot.roles.length,
                ...context.actor.metadata,
            },
        },
        guildId: context.guild.id,
        createdByUserId: context.actor.actorUserId,
        serverName: context.guild.name,
        source: structureBackupSources.restorePoint,
        status: structureBackupStatuses.succeeded,
        structure: toJsonRecord(snapshot),
        roleCount: snapshot.roles.length,
        categoryCount: snapshot.categories.length,
        channelCount: snapshot.channels.length,
    }).catch(() => undefined);

    if (!result || result.isErr()) return 'database-error';
    return { id: result.value.id };
}

export function summarizeApplyRestorePointRisk(actions: StructureImportActionRecord[]): RestorePointRiskSummary {
    const deleteCount = actions.filter((action) => action.actionType === 'delete').length;
    const permissionRiskCount = actions.filter(isPermissionRiskAction).length;

    return {
        deleteCount,
        permissionRiskCount,
        riskyActionCount: deleteCount + permissionRiskCount,
    };
}

function isPermissionRiskAction(action: StructureImportActionRecord): boolean {
    if (action.actionType !== 'update') return false;

    return readStructureActionChanges(toJsonRecord(action.details)).some((change) => {
        if (action.targetType === 'role') return change.field === 'permissions';
        if (action.targetType === 'category' || action.targetType === 'channel') {
            return change.field === 'permissionOverwrites';
        }
        return false;
    });
}

function toJsonRecord(value: unknown): Record<string, unknown> {
    return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
}

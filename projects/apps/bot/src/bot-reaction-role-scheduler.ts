import { randomUUID } from 'node:crypto';

import type { AppLogger } from '@neonflux/core/logging';
import { maintainReactionRoleState } from '@neonflux/db';

import { runNextReactionRoleMemberReconciliation } from './bot-reaction-role-member-reconciler.js';
import { runNextReactionRoleOperation } from './bot-reaction-role-operation-worker.js';
import type { BotFeatureHandlerContext } from './bot-feature-types.js';

const schedulerIntervalMs = 2_000;
const maxWorkItemsPerRun = 20;
const maintenanceIntervalMs = 60 * 60 * 1_000;
const maintenanceRetryMs = 30_000;
const operationRetentionMs = 30 * 24 * 60 * 60 * 1_000;

export function startReactionRoleScheduler(input: {
    context: BotFeatureHandlerContext;
    logger: AppLogger;
    intervalMs?: number;
}) {
    const leaseOwner = `reaction-role-worker:${randomUUID()}`;
    let stopped = false;
    let running: Promise<void> | undefined;
    let nextMaintenanceAt = 0;

    const runOnce = async () => {
        if (Date.now() >= nextMaintenanceAt) {
            const now = new Date();
            const maintenance = await maintainReactionRoleState(input.context.db, {
                now,
                retentionBefore: new Date(now.getTime() - operationRetentionMs),
            });
            if (maintenance.isErr()) {
                nextMaintenanceAt = now.getTime() + maintenanceRetryMs;
                input.logger.error('reaction_roles.maintenance_failed', { error: maintenance.error.type });
            } else {
                nextMaintenanceAt =
                    now.getTime() + (maintenance.value.hasMore ? schedulerIntervalMs : maintenanceIntervalMs);
            }
        }
        for (let index = 0; index < maxWorkItemsPerRun && !stopped; index += 1) {
            const operation = await runNextReactionRoleOperation(input.context, { leaseOwner });
            const member = await runNextReactionRoleMemberReconciliation(input.context, { leaseOwner });

            if (operation.status === 'needs_attention') {
                input.logger.error('reaction_roles.operation_needs_attention', {
                    errorCode: operation.errorCode,
                    operationId: operation.operationId,
                });
            }
            if (member.status === 'blocked') {
                input.logger.error('reaction_roles.member_state_blocked', {
                    errorCode: member.errorCode,
                    stateId: member.stateId,
                });
            }
            if (
                member.status === 'deferred' &&
                (member.errorCode === 'permission-denied' ||
                    member.errorCode === 'role_hierarchy_blocked' ||
                    member.errorCode === 'unsupported')
            ) {
                input.logger.error('reaction_roles.member_state_requires_configuration', {
                    errorCode: member.errorCode,
                    stateId: member.stateId,
                });
            }
            if (operation.status === 'idle' && member.status === 'idle') return;
        }
    };
    const startRun = () => {
        if (running || stopped) return;
        running = runOnce()
            .catch((error: unknown) => {
                input.logger.error('reaction_roles.worker_failed', {
                    error: error instanceof Error ? error.message : String(error),
                });
            })
            .finally(() => {
                running = undefined;
            });
    };
    const interval = setInterval(startRun, input.intervalMs ?? schedulerIntervalMs);
    startRun();

    return {
        async stop(): Promise<void> {
            stopped = true;
            clearInterval(interval);
            await running;
        },
    };
}

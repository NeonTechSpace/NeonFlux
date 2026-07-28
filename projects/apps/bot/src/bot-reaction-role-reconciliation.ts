import { randomUUID } from 'node:crypto';

import type { AppLogger } from '@neonflux/core/logging';
import {
    applyReactionRolePanelReconciliationBatch,
    beginReactionRolePanelReconciliation,
    cancelReactionRolePanelReconciliation,
    finalizeReactionRolePanelReconciliation,
    listReactionRolePanelsByGuild,
    markReactionRolePanelAggregateDrift,
} from '@neonflux/db';
import { createFluxerReactionRolePlatform } from '@neonflux/fluxer';

import type { BotFeatureHandlerContext } from './bot-feature-types.js';
import { reactionRolesAllowed } from './bot-reaction-role-policy.js';

const pageSize = 100;
const reconciliationBatchSize = 25;
const maxReactionEntriesPerPanelSnapshot = 10_000;

export async function reconcileReactionRolePanels(
    context: BotFeatureHandlerContext,
    logger: AppLogger,
    signal?: AbortSignal
): Promise<number> {
    const platform = createFluxerReactionRolePlatform(context.client);
    let changedUsers = 0;
    for (const guildId of context.client.guilds.keys()) {
        if (signal?.aborted) return changedUsers;
        if (!(await reactionRolesAllowed(context, guildId))) continue;
        const panels = await listReactionRolePanelsByGuild(context.db, { guildId });
        if (panels.isErr()) {
            logger.error('reaction_roles.reconciliation_panel_read_failed', { guildId });
            continue;
        }
        for (const panel of panels.value) {
            if (signal?.aborted) return changedUsers;
            if (panel.status !== 'active' || !panel.messageId) continue;
            const reconciliationId = randomUUID();
            const started = await beginReactionRolePanelReconciliation(context.db, {
                expectedGeneration: panel.generation,
                guildId,
                panelId: panel.id,
                reconciliationId,
            });
            if (started.isErr()) {
                logger.error('reaction_roles.reconciliation_start_failed', { guildId, panelId: panel.id });
                continue;
            }
            if (started.value.type === 'stale') continue;
            const generation = started.value.generation;
            const actualByUser = new Map<string, Set<string>>();
            let totalUsers = 0;
            let failed = false;
            for (const option of panel.desiredVersion.payload.options) {
                let after: string | undefined;
                for (;;) {
                    if (signal?.aborted) {
                        failed = true;
                        break;
                    }
                    const page = await platform.fetchReactionUsersPage({
                        ...(after ? { after } : {}),
                        channelId: panel.channelId,
                        emoji: option.emoji,
                        limit: pageSize,
                        messageId: panel.messageId,
                    });
                    if (page.isErr()) {
                        if (page.error.type === 'not-found') {
                            await markReactionRolePanelAggregateDrift(context.db, {
                                guildId,
                                messageId: panel.messageId,
                                type: 'message-deleted',
                            });
                        }
                        logger.warn('reaction_roles.reconciliation_reaction_read_failed', {
                            guildId,
                            optionId: option.id,
                            panelId: panel.id,
                        });
                        failed = true;
                        break;
                    }
                    for (const user of page.value.users) {
                        if (user.bot) continue;
                        const selected = actualByUser.get(user.id);
                        if (selected) selected.add(option.id);
                        else actualByUser.set(user.id, new Set([option.id]));
                        totalUsers += 1;
                    }
                    if (totalUsers > maxReactionEntriesPerPanelSnapshot) {
                        logger.warn('reaction_roles.reconciliation_snapshot_limit', {
                            guildId,
                            panelId: panel.id,
                            snapshotLimit: maxReactionEntriesPerPanelSnapshot,
                        });
                        failed = true;
                        break;
                    }
                    if (!page.value.hasMore || !page.value.nextAfter) break;
                    after = page.value.nextAfter;
                }
                if (failed) break;
            }
            if (failed) {
                await cancelReconciliation(context, {
                    generation,
                    guildId,
                    panelId: panel.id,
                    reconciliationId,
                });
                continue;
            }
            const users = [...actualByUser].map(([userId, optionIds]) => ({
                optionIds: [...optionIds],
                userId,
            }));
            for (let index = 0; index < users.length; index += reconciliationBatchSize) {
                if (signal?.aborted) {
                    failed = true;
                    break;
                }
                const result = await applyReactionRolePanelReconciliationBatch(context.db, {
                    generation,
                    guildId,
                    panelId: panel.id,
                    reconciliationId,
                    users: users.slice(index, index + reconciliationBatchSize),
                });
                if (result.isErr()) {
                    logger.error('reaction_roles.reconciliation_persistence_failed', {
                        guildId,
                        panelId: panel.id,
                    });
                    failed = true;
                    break;
                }
                if (result.value.type === 'stale') {
                    failed = true;
                    break;
                }
                changedUsers += result.value.changedUserCount;
            }
            if (failed) {
                await cancelReconciliation(context, {
                    generation,
                    guildId,
                    panelId: panel.id,
                    reconciliationId,
                });
                continue;
            }
            for (;;) {
                if (signal?.aborted) {
                    await cancelReconciliation(context, {
                        generation,
                        guildId,
                        panelId: panel.id,
                        reconciliationId,
                    });
                    return changedUsers;
                }
                const finalized = await finalizeReactionRolePanelReconciliation(context.db, {
                    generation,
                    guildId,
                    panelId: panel.id,
                    reconciliationId,
                });
                if (finalized.isErr()) {
                    logger.error('reaction_roles.reconciliation_finalize_failed', {
                        guildId,
                        panelId: panel.id,
                    });
                    await cancelReconciliation(context, {
                        generation,
                        guildId,
                        panelId: panel.id,
                        reconciliationId,
                    });
                    break;
                }
                if (finalized.value !== 'pending') break;
                changedUsers += 1;
            }
        }
    }
    return changedUsers;
}

async function cancelReconciliation(
    context: BotFeatureHandlerContext,
    input: {
        generation: number;
        guildId: string;
        panelId: string;
        reconciliationId: string;
    }
): Promise<void> {
    for (;;) {
        const cancelled = await cancelReactionRolePanelReconciliation(context.db, input);
        if (cancelled.isErr() || cancelled.value !== 'pending') return;
    }
}

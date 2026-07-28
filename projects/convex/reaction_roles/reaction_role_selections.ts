import {
    findReactionRoleOptionByEmoji,
    getReactionRoleEmojiKey,
    parseReactionRoleEmoji,
    reduceReactionRoleSelection,
    type ReactionRoleEmoji,
} from '@neonflux/reaction-roles';
import { v, type GenericId } from 'convex/values';

import { requireNeonFluxService } from '../auth.js';
import { mutation, type MutationCtx } from '../_generated/server.js';
import { recordBotActionEventInMutation } from '../core/events.js';
import type {
    StoredReactionRolePanel,
    StoredReactionRoleSelectionSnapshot,
    StoredReactionRoleVersion,
} from './reaction_role_model.js';
import { reactionRoleEmojiValidator, reactionRoleIntentResultValidator } from './reaction_role_validators.js';

const botService = ['bot'] as const;

export const recordReactionRoleReactionIntent = mutation({
    args: {
        channelId: v.string(),
        emoji: reactionRoleEmojiValidator,
        guildId: v.string(),
        messageId: v.string(),
        selected: v.boolean(),
        userId: v.string(),
        userIsBot: v.boolean(),
    },
    returns: reactionRoleIntentResultValidator,
    handler: async (ctx, args) => {
        await requireNeonFluxService(ctx, botService);
        const panel = (await ctx.db
            .query('reactionRolePanels')
            .withIndex('by_guild_message', (queryBuilder) =>
                queryBuilder.eq('guildId', args.guildId.trim()).eq('messageId', args.messageId.trim())
            )
            .unique()) as StoredReactionRolePanel | null;
        if (panel?.channelId !== args.channelId.trim()) {
            return { type: 'ignored' as const };
        }
        if (panel.status !== 'active' && panel.status !== 'updating') return { type: 'ignored' as const };
        if (panel.status === 'updating' && args.userIsBot) return { type: 'ignored' as const };
        const parsedEmoji = parseReactionRoleEmoji(args.emoji);
        if (parsedEmoji.isErr()) return { type: 'unconfigured' as const };
        const version = await resolveEventVersion(ctx, panel, parsedEmoji.value);
        if (!version) return { type: 'unconfigured' as const };
        const option = findReactionRoleOptionByEmoji(version.payload.options, parsedEmoji.value);
        if (!option) return { type: 'unconfigured' as const };

        if (args.userIsBot) {
            return args.selected ? { type: 'ignored' as const } : { emoji: option.emoji, type: 'seed-repair' as const };
        }

        const current = await ctx.db
            .query('reactionRoleSelections')
            .withIndex('by_panel_user', (queryBuilder) =>
                queryBuilder.eq('panelId', panel._id).eq('userId', args.userId.trim())
            )
            .collect();
        const existing = current.find((selection) => selection.optionId === option.id);
        if ((args.selected && existing) || (!args.selected && !existing)) {
            return { type: 'ignored' as const };
        }
        const transition = reduceReactionRoleSelection({
            activeOptionIds: current.map((selection) => selection.optionId),
            mode: version.payload.mode,
            optionId: option.id,
            selected: args.selected,
        });
        const now = new Date().toISOString();
        const previous = current.flatMap((selection) => {
            const currentOption = version.payload.options.find((candidate) => candidate.id === selection.optionId);
            return currentOption
                ? [
                      {
                          emoji: currentOption.emoji,
                          grantOwnership: selection.grantOwnership,
                          optionId: selection.optionId,
                          roleId: selection.roleId,
                      } satisfies StoredReactionRoleSelectionSnapshot,
                  ]
                : [];
        });
        for (const selection of current) {
            if (!transition.nextOptionIds.includes(selection.optionId)) {
                await ctx.db.delete('reactionRoleSelections', selection._id);
            }
        }
        const desired: StoredReactionRoleSelectionSnapshot[] = [];
        for (const optionId of transition.nextOptionIds) {
            const configured = version.payload.options.find((candidate) => candidate.id === optionId);
            if (!configured) continue;
            const retained = current.find((selection) => selection.optionId === optionId);
            if (retained) {
                desired.push({
                    emoji: configured.emoji,
                    grantOwnership: retained.grantOwnership,
                    optionId,
                    roleId: configured.roleId,
                });
                continue;
            }
            await ctx.db.insert('reactionRoleSelections', {
                createdAt: now,
                emojiKey: configured.emojiKey,
                generation: panel.generation,
                grantOwnership: 'pending',
                guildId: panel.guildId,
                optionId,
                panelId: panel._id,
                revision: 1,
                roleId: configured.roleId,
                updatedAt: now,
                userId: args.userId.trim(),
            });
            desired.push({
                emoji: configured.emoji,
                grantOwnership: 'pending',
                optionId,
                roleId: configured.roleId,
            });
        }
        const operation = await enqueueMemberOperation(ctx, {
            addedOptionIds: transition.addedOptionIds,
            desired,
            guildId: panel.guildId,
            now,
            panelId: panel._id,
            previous,
            userId: args.userId.trim(),
        });
        if (panel.reconciliationId) {
            await markReconciliationUserDirty(ctx, panel, args.userId.trim(), panel.reconciliationId, now);
        }
        return { operationId: operation.id, revision: operation.revision, type: 'enqueued' as const };
    },
});

export const markReactionRolePanelAggregateDrift = mutation({
    args: {
        emojiKey: v.optional(v.string()),
        guildId: v.optional(v.string()),
        messageId: v.string(),
        type: v.union(v.literal('all-reactions-removed'), v.literal('emoji-removed'), v.literal('message-deleted')),
    },
    returns: v.boolean(),
    handler: async (ctx, args) => {
        await requireNeonFluxService(ctx, botService);
        const panel = args.guildId
            ? await ctx.db
                  .query('reactionRolePanels')
                  .withIndex('by_guild_message', (queryBuilder) =>
                      queryBuilder.eq('guildId', args.guildId?.trim() ?? '').eq('messageId', args.messageId.trim())
                  )
                  .unique()
            : await ctx.db
                  .query('reactionRolePanels')
                  .withIndex('by_message', (queryBuilder) => queryBuilder.eq('messageId', args.messageId.trim()))
                  .unique();
        if (!panel || panel.status === 'inactive') return false;
        const now = new Date().toISOString();
        const errorCode =
            args.type === 'all-reactions-removed'
                ? 'all_reactions_removed_review_required'
                : args.type === 'emoji-removed'
                  ? 'reaction_emoji_removed_review_required'
                  : 'managed_message_deleted';
        await ctx.db.patch('reactionRolePanels', panel._id, {
            errorCode,
            status: 'degraded',
            updatedAt: now,
        });
        await recordBotActionEventInMutation(ctx, {
            action: `reaction_roles.panel.${args.type.replaceAll('-', '_')}`,
            feature: 'reaction_roles',
            guildId: panel.guildId,
            metadata: {
                ...(args.emojiKey ? { emojiKey: args.emojiKey } : {}),
                reviewRequired: true,
            },
            targetId: panel._id,
        });
        return true;
    },
});

export const removeReactionRoleMemberState = mutation({
    args: {
        guildId: v.string(),
        userId: v.string(),
    },
    returns: v.number(),
    handler: async (ctx, args) => {
        await requireNeonFluxService(ctx, botService);
        const selections = await ctx.db
            .query('reactionRoleSelections')
            .withIndex('by_guild_user', (queryBuilder) =>
                queryBuilder.eq('guildId', args.guildId.trim()).eq('userId', args.userId.trim())
            )
            .collect();
        for (const selection of selections) await ctx.db.delete('reactionRoleSelections', selection._id);
        const operations = await ctx.db
            .query('reactionRoleMemberOperations')
            .withIndex('by_guild_user', (queryBuilder) =>
                queryBuilder.eq('guildId', args.guildId.trim()).eq('userId', args.userId.trim())
            )
            .collect();
        for (const operation of operations) {
            if (operation.status !== 'completed') {
                await ctx.db.patch('reactionRoleMemberOperations', operation._id, {
                    errorCode: 'member_left',
                    status: 'permanent_failure',
                    updatedAt: new Date().toISOString(),
                });
            }
        }
        return selections.length;
    },
});

export const reconcileReactionRoleMemberRoles = mutation({
    args: {
        guildId: v.string(),
        roleIds: v.array(v.string()),
        userId: v.string(),
    },
    returns: v.number(),
    handler: async (ctx, args) => {
        await requireNeonFluxService(ctx, botService);
        const guildId = args.guildId.trim();
        const userId = args.userId.trim();
        const actualRoleIds = new Set(args.roleIds.map((roleId) => roleId.trim()).filter(Boolean));
        const selections = await ctx.db
            .query('reactionRoleSelections')
            .withIndex('by_guild_user', (queryBuilder) => queryBuilder.eq('guildId', guildId).eq('userId', userId))
            .collect();
        const selectionsByPanel = new Map<GenericId<'reactionRolePanels'>, typeof selections>();
        for (const selection of selections) {
            const grouped = selectionsByPanel.get(selection.panelId);
            if (grouped) grouped.push(selection);
            else selectionsByPanel.set(selection.panelId, [selection]);
        }

        const now = new Date().toISOString();
        let queuedPanelCount = 0;
        for (const [panelId, panelSelections] of selectionsByPanel) {
            if (panelSelections.every((selection) => actualRoleIds.has(selection.roleId))) continue;
            const panel = (await ctx.db.get('reactionRolePanels', panelId)) as StoredReactionRolePanel | null;
            if (!panel || (panel.status !== 'active' && panel.status !== 'updating')) continue;
            const versionIds = [
                ...(panel.appliedVersionId ? [panel.appliedVersionId] : []),
                ...(panel.desiredVersionId && panel.desiredVersionId !== panel.appliedVersionId
                    ? [panel.desiredVersionId]
                    : []),
            ];
            const versions = await Promise.all(
                versionIds.map(
                    async (versionId) =>
                        (await ctx.db.get('reactionRolePanelVersions', versionId)) as StoredReactionRoleVersion | null
                )
            );
            const snapshots = panelSelections.flatMap((selection) => {
                const option = versions
                    .filter((version): version is StoredReactionRoleVersion => version !== null)
                    .flatMap((version) => version.payload.options)
                    .find((candidate) => candidate.id === selection.optionId && candidate.roleId === selection.roleId);
                return option
                    ? [
                          {
                              emoji: option.emoji,
                              grantOwnership: selection.grantOwnership,
                              optionId: option.id,
                              roleId: option.roleId,
                          } satisfies StoredReactionRoleSelectionSnapshot,
                      ]
                    : [];
            });
            if (snapshots.length !== panelSelections.length) continue;
            await enqueueMemberOperation(ctx, {
                addedOptionIds: [],
                desired: snapshots,
                guildId,
                now,
                panelId,
                previous: snapshots,
                userId,
            });
            queuedPanelCount += 1;
        }
        return queuedPanelCount;
    },
});

export const beginReactionRolePanelReconciliation = mutation({
    args: {
        expectedGeneration: v.number(),
        guildId: v.string(),
        panelId: v.string(),
        reconciliationId: v.string(),
    },
    returns: v.union(
        v.object({ generation: v.number(), type: v.literal('started') }),
        v.object({ type: v.literal('stale') })
    ),
    handler: async (ctx, args) => {
        await requireNeonFluxService(ctx, botService);
        const panel = (await ctx.db.get(
            'reactionRolePanels',
            args.panelId as GenericId<'reactionRolePanels'>
        )) as StoredReactionRolePanel | null;
        const reconciliationId = args.reconciliationId.trim();
        if (
            !reconciliationId ||
            panel?.guildId !== args.guildId.trim() ||
            panel.generation !== args.expectedGeneration ||
            panel.status !== 'active' ||
            !panel.appliedVersionId
        ) {
            return { type: 'stale' as const };
        }
        const generation = panel.generation + 1;
        await ctx.db.patch('reactionRolePanels', panel._id, {
            generation,
            reconciliationId,
            updatedAt: new Date().toISOString(),
        });
        return { generation, type: 'started' as const };
    },
});

export const applyReactionRolePanelReconciliationBatch = mutation({
    args: {
        generation: v.number(),
        guildId: v.string(),
        panelId: v.string(),
        reconciliationId: v.string(),
        users: v.array(
            v.object({
                optionIds: v.array(v.string()),
                userId: v.string(),
            })
        ),
    },
    returns: v.union(
        v.object({ changedUserCount: v.number(), type: v.literal('applied') }),
        v.object({ type: v.literal('stale') })
    ),
    handler: async (ctx, args) => {
        await requireNeonFluxService(ctx, botService);
        if (args.users.length > 25) throw new Error('reaction-role-reconciliation-batch-too-large');
        const panel = (await ctx.db.get(
            'reactionRolePanels',
            args.panelId as GenericId<'reactionRolePanels'>
        )) as StoredReactionRolePanel | null;
        if (
            panel?.guildId !== args.guildId.trim() ||
            panel.generation !== args.generation ||
            panel.reconciliationId !== args.reconciliationId.trim() ||
            panel.status !== 'active' ||
            !panel.appliedVersionId
        ) {
            return { type: 'stale' as const };
        }
        const version = (await ctx.db.get(
            'reactionRolePanelVersions',
            panel.appliedVersionId
        )) as StoredReactionRoleVersion | null;
        if (!version) return { type: 'stale' as const };

        const optionById = new Map(version.payload.options.map((option) => [option.id, option]));
        const now = new Date().toISOString();
        let changedUserCount = 0;
        const seenUserIds = new Set<string>();
        for (const user of args.users) {
            const userId = user.userId.trim();
            if (!userId || seenUserIds.has(userId)) continue;
            seenUserIds.add(userId);
            const dirty = await ctx.db
                .query('reactionRoleReconciliationDirtyUsers')
                .withIndex('by_panel_user', (queryBuilder) =>
                    queryBuilder.eq('panelId', panel._id).eq('userId', userId)
                )
                .unique();
            if (dirty) {
                const current = await ctx.db
                    .query('reactionRoleSelections')
                    .withIndex('by_panel_user', (queryBuilder) =>
                        queryBuilder.eq('panelId', panel._id).eq('userId', userId)
                    )
                    .collect();
                for (const selection of current) {
                    await ctx.db.patch('reactionRoleSelections', selection._id, {
                        generation: panel.generation,
                        updatedAt: now,
                    });
                }
                await ctx.db.delete('reactionRoleReconciliationDirtyUsers', dirty._id);
                continue;
            }
            const actualOptionIds = version.payload.options
                .filter((option) => user.optionIds.includes(option.id))
                .map((option) => option.id);
            if (await reconcileSnapshotUser(ctx, panel, version, optionById, userId, actualOptionIds, now)) {
                changedUserCount += 1;
            }
        }
        return { changedUserCount, type: 'applied' as const };
    },
});

export const finalizeReactionRolePanelReconciliation = mutation({
    args: {
        generation: v.number(),
        guildId: v.string(),
        panelId: v.string(),
        reconciliationId: v.string(),
    },
    returns: v.union(v.literal('completed'), v.literal('pending'), v.literal('stale')),
    handler: async (ctx, args) => {
        await requireNeonFluxService(ctx, botService);
        const panel = (await ctx.db.get(
            'reactionRolePanels',
            args.panelId as GenericId<'reactionRolePanels'>
        )) as StoredReactionRolePanel | null;
        if (
            panel?.guildId !== args.guildId.trim() ||
            panel.generation !== args.generation ||
            panel.reconciliationId !== args.reconciliationId.trim() ||
            panel.status !== 'active' ||
            !panel.appliedVersionId
        ) {
            return 'stale' as const;
        }
        const version = (await ctx.db.get(
            'reactionRolePanelVersions',
            panel.appliedVersionId
        )) as StoredReactionRoleVersion | null;
        if (!version) return 'stale' as const;
        const dirty = (
            await ctx.db
                .query('reactionRoleReconciliationDirtyUsers')
                .withIndex('by_panel_updated', (queryBuilder) => queryBuilder.eq('panelId', panel._id))
                .take(1)
        )[0];
        if (dirty) {
            const current = await ctx.db
                .query('reactionRoleSelections')
                .withIndex('by_panel_user', (queryBuilder) =>
                    queryBuilder.eq('panelId', panel._id).eq('userId', dirty.userId)
                )
                .collect();
            const now = new Date().toISOString();
            for (const selection of current) {
                await ctx.db.patch('reactionRoleSelections', selection._id, {
                    generation: panel.generation,
                    updatedAt: now,
                });
            }
            await ctx.db.delete('reactionRoleReconciliationDirtyUsers', dirty._id);
            return 'pending' as const;
        }
        const stale = (
            await ctx.db
                .query('reactionRoleSelections')
                .withIndex('by_panel_generation', (queryBuilder) =>
                    queryBuilder.eq('panelId', panel._id).lt('generation', panel.generation)
                )
                .take(1)
        )[0];
        if (stale) {
            await reconcileSnapshotUser(
                ctx,
                panel,
                version,
                new Map(version.payload.options.map((option) => [option.id, option])),
                stale.userId,
                [],
                new Date().toISOString()
            );
            return 'pending' as const;
        }
        const now = new Date().toISOString();
        await ctx.db.patch('reactionRolePanels', panel._id, {
            reconciliationId: undefined,
            updatedAt: now,
        });
        await recordBotActionEventInMutation(ctx, {
            action: 'reaction_roles.panel.reconciled',
            feature: 'reaction_roles',
            guildId: panel.guildId,
            metadata: { generation: panel.generation },
            targetId: panel._id,
        });
        return 'completed' as const;
    },
});

export const cancelReactionRolePanelReconciliation = mutation({
    args: {
        generation: v.number(),
        guildId: v.string(),
        panelId: v.string(),
        reconciliationId: v.string(),
    },
    returns: v.union(v.literal('completed'), v.literal('pending'), v.literal('stale')),
    handler: async (ctx, args) => {
        await requireNeonFluxService(ctx, botService);
        const panel = (await ctx.db.get(
            'reactionRolePanels',
            args.panelId as GenericId<'reactionRolePanels'>
        )) as StoredReactionRolePanel | null;
        if (
            panel?.guildId !== args.guildId.trim() ||
            panel.generation !== args.generation ||
            panel.reconciliationId !== args.reconciliationId.trim()
        ) {
            return 'stale' as const;
        }
        const dirty = (
            await ctx.db
                .query('reactionRoleReconciliationDirtyUsers')
                .withIndex('by_panel_updated', (queryBuilder) => queryBuilder.eq('panelId', panel._id))
                .take(1)
        )[0];
        if (dirty) {
            await ctx.db.delete('reactionRoleReconciliationDirtyUsers', dirty._id);
            return 'pending' as const;
        }
        await ctx.db.patch('reactionRolePanels', panel._id, {
            reconciliationId: undefined,
            updatedAt: new Date().toISOString(),
        });
        return 'completed' as const;
    },
});

async function resolveEventVersion(
    ctx: MutationCtx,
    panel: StoredReactionRolePanel,
    emoji: ReactionRoleEmoji
): Promise<StoredReactionRoleVersion | null> {
    if (!panel.appliedVersionId) return null;
    const emojiKey = getReactionRoleEmojiKey(emoji);
    const version = (await ctx.db.get(
        'reactionRolePanelVersions',
        panel.appliedVersionId
    )) as StoredReactionRoleVersion | null;
    return version?.payload.options.some((option) => option.emojiKey === emojiKey) ? version : null;
}

async function enqueueMemberOperation(
    ctx: MutationCtx,
    input: {
        addedOptionIds: string[];
        desired: StoredReactionRoleSelectionSnapshot[];
        guildId: string;
        now: string;
        panelId: GenericId<'reactionRolePanels'>;
        previous: StoredReactionRoleSelectionSnapshot[];
        userId: string;
    }
): Promise<{ id: GenericId<'reactionRoleMemberOperations'>; revision: number }> {
    const existing = await ctx.db
        .query('reactionRoleMemberOperations')
        .withIndex('by_panel_user', (queryBuilder) =>
            queryBuilder.eq('panelId', input.panelId).eq('userId', input.userId)
        )
        .unique();
    if (existing && (existing.status === 'queued' || existing.status === 'running')) {
        const revision = existing.revision + 1;
        await ctx.db.patch('reactionRoleMemberOperations', existing._id, {
            addedOptionIds: input.addedOptionIds,
            desiredSelections: input.desired,
            previousSelections: input.previous,
            rerunRequested: existing.status === 'running',
            revision,
            updatedAt: input.now,
        });
        return { id: existing._id, revision };
    }
    if (existing) {
        const revision = existing.revision + 1;
        await ctx.db.patch('reactionRoleMemberOperations', existing._id, {
            addedOptionIds: input.addedOptionIds,
            attemptCount: 0,
            baselineRoleIds: undefined,
            desiredSelections: input.desired,
            errorCode: undefined,
            leaseExpiresAt: undefined,
            leaseId: undefined,
            leaseOwner: undefined,
            nextAttemptAt: undefined,
            previousSelections: input.previous,
            rerunRequested: false,
            revision,
            status: 'queued',
            updatedAt: input.now,
        });
        return { id: existing._id, revision };
    }
    const id = await ctx.db.insert('reactionRoleMemberOperations', {
        addedOptionIds: input.addedOptionIds,
        attemptCount: 0,
        createdAt: input.now,
        desiredSelections: input.desired,
        guildId: input.guildId,
        panelId: input.panelId,
        previousSelections: input.previous,
        rerunRequested: false,
        revision: 1,
        status: 'queued',
        updatedAt: input.now,
        userId: input.userId,
    });
    return { id, revision: 1 };
}

function sameIds(left: readonly string[], right: readonly string[]): boolean {
    return left.length === right.length && left.every((value, index) => value === right[index]);
}

async function reconcileSnapshotUser(
    ctx: MutationCtx,
    panel: StoredReactionRolePanel,
    version: StoredReactionRoleVersion,
    optionById: Map<string, StoredReactionRoleVersion['payload']['options'][number]>,
    userId: string,
    actualOptionIds: string[],
    now: string
): Promise<boolean> {
    const current = await ctx.db
        .query('reactionRoleSelections')
        .withIndex('by_panel_user', (queryBuilder) => queryBuilder.eq('panelId', panel._id).eq('userId', userId))
        .collect();
    const targetOptionIds = version.payload.mode === 'exclusive' ? actualOptionIds.slice(0, 1) : actualOptionIds;
    const currentOptionIds = version.payload.options
        .filter((option) => current.some((selection) => selection.optionId === option.id))
        .map((option) => option.id);
    const changed =
        current.length !== currentOptionIds.length ||
        !sameIds(currentOptionIds, targetOptionIds) ||
        !sameIds(actualOptionIds, targetOptionIds);
    if (!changed) {
        for (const selection of current) {
            if (selection.generation !== panel.generation) {
                await ctx.db.patch('reactionRoleSelections', selection._id, {
                    generation: panel.generation,
                    updatedAt: now,
                });
            }
        }
        return false;
    }

    const previous = current.flatMap((selection) => {
        const option = optionById.get(selection.optionId);
        return option
            ? [
                  {
                      emoji: option.emoji,
                      grantOwnership: selection.grantOwnership,
                      optionId: option.id,
                      roleId: selection.roleId,
                  } satisfies StoredReactionRoleSelectionSnapshot,
              ]
            : [];
    });
    for (const optionId of actualOptionIds.filter((candidate) => !targetOptionIds.includes(candidate))) {
        if (previous.some((selection) => selection.optionId === optionId)) continue;
        const option = optionById.get(optionId);
        if (!option) continue;
        previous.push({
            emoji: option.emoji,
            grantOwnership: 'preexisting',
            optionId,
            roleId: option.roleId,
        });
    }
    for (const selection of current) await ctx.db.delete('reactionRoleSelections', selection._id);
    const desired: StoredReactionRoleSelectionSnapshot[] = [];
    for (const optionId of targetOptionIds) {
        const option = optionById.get(optionId);
        if (!option) continue;
        const retained = current.find(
            (selection) => selection.optionId === optionId && selection.roleId === option.roleId
        );
        const grantOwnership = retained?.grantOwnership ?? 'pending';
        await ctx.db.insert('reactionRoleSelections', {
            createdAt: now,
            emojiKey: option.emojiKey,
            generation: panel.generation,
            grantOwnership,
            guildId: panel.guildId,
            optionId,
            panelId: panel._id,
            revision: 1,
            roleId: option.roleId,
            updatedAt: now,
            userId,
        });
        desired.push({
            emoji: option.emoji,
            grantOwnership,
            optionId,
            roleId: option.roleId,
        });
    }
    await enqueueMemberOperation(ctx, {
        addedOptionIds: targetOptionIds.filter((optionId) => !currentOptionIds.includes(optionId)),
        desired,
        guildId: panel.guildId,
        now,
        panelId: panel._id,
        previous,
        userId,
    });
    return true;
}

async function markReconciliationUserDirty(
    ctx: MutationCtx,
    panel: StoredReactionRolePanel,
    userId: string,
    reconciliationId: string,
    now: string
): Promise<void> {
    const existing = await ctx.db
        .query('reactionRoleReconciliationDirtyUsers')
        .withIndex('by_panel_user', (queryBuilder) => queryBuilder.eq('panelId', panel._id).eq('userId', userId))
        .unique();
    if (existing) {
        await ctx.db.patch('reactionRoleReconciliationDirtyUsers', existing._id, {
            reconciliationId,
            updatedAt: now,
        });
        return;
    }
    await ctx.db.insert('reactionRoleReconciliationDirtyUsers', {
        guildId: panel.guildId,
        panelId: panel._id,
        reconciliationId,
        updatedAt: now,
        userId,
    });
}

import { v } from 'convex/values';

const lifecycleValidator = v.union(
    v.literal('ready'),
    v.literal('syncing'),
    v.literal('deleting'),
    v.literal('needs_attention')
);

export const messageRecordValidator = v.object({
    channelId: v.string(),
    createdAt: v.string(),
    enabled: v.boolean(),
    generateOverview: v.boolean(),
    guildId: v.string(),
    id: v.string(),
    kind: v.string(),
    lifecycle: lifecycleValidator,
    messageContent: v.union(v.string(), v.null()),
    messageEmbeds: v.array(v.any()),
    messageId: v.string(),
    mode: v.union(v.literal('normal'), v.literal('exclusive')),
    pendingOperationId: v.union(v.string(), v.null()),
    revision: v.number(),
    source: v.union(v.literal('existing'), v.literal('dashboard')),
    staleAt: v.union(v.string(), v.null()),
    updatedAt: v.string(),
});

export const optionRecordValidator = v.object({
    createdAt: v.string(),
    emojiKey: v.string(),
    id: v.string(),
    position: v.number(),
    reactionRoleMessageId: v.string(),
    roleId: v.string(),
    updatedAt: v.string(),
});

export const assignmentRecordValidator = v.object({
    assignedAt: v.string(),
    desiredState: v.union(v.literal('absent'), v.literal('present')),
    emojiKey: v.string(),
    guildId: v.string(),
    id: v.string(),
    messageId: v.string(),
    reactionRoleMessageId: v.union(v.string(), v.null()),
    removedAt: v.union(v.string(), v.null()),
    roleId: v.string(),
    status: v.union(v.literal('applied'), v.literal('blocked'), v.literal('pending')),
    updatedAt: v.string(),
    userId: v.string(),
});

export const messageWithOptionsValidator = v.object({
    channelId: v.string(),
    createdAt: v.string(),
    enabled: v.boolean(),
    generateOverview: v.boolean(),
    guildId: v.string(),
    id: v.string(),
    kind: v.string(),
    lifecycle: lifecycleValidator,
    messageContent: v.union(v.string(), v.null()),
    messageEmbeds: v.array(v.any()),
    messageId: v.string(),
    mode: v.union(v.literal('normal'), v.literal('exclusive')),
    options: v.array(optionRecordValidator),
    pendingOperationId: v.union(v.string(), v.null()),
    revision: v.number(),
    source: v.union(v.literal('existing'), v.literal('dashboard')),
    staleAt: v.union(v.string(), v.null()),
    updatedAt: v.string(),
});

export const optionMatchValidator = v.object({
    message: messageRecordValidator,
    option: optionRecordValidator,
});

export const desiredOptionValidator = v.object({
    emojiKey: v.string(),
    position: v.number(),
    roleId: v.string(),
});

export const desiredConfigValidator = v.object({
    enabled: v.boolean(),
    generateOverview: v.boolean(),
    messageContent: v.optional(v.string()),
    messageEmbeds: v.array(v.any()),
    mode: v.union(v.literal('normal'), v.literal('exclusive')),
    options: v.array(desiredOptionValidator),
});

export const operationRecordValidator = v.object({
    actorUserId: v.string(),
    attemptCount: v.number(),
    blockedCount: v.number(),
    channelId: v.string(),
    completedAt: v.union(v.string(), v.null()),
    createdAt: v.string(),
    desiredConfig: v.object({
        enabled: v.boolean(),
        generateOverview: v.boolean(),
        messageContent: v.union(v.string(), v.null()),
        messageEmbeds: v.array(v.any()),
        mode: v.union(v.literal('normal'), v.literal('exclusive')),
        options: v.array(desiredOptionValidator),
    }),
    errorCode: v.union(v.string(), v.null()),
    expectedRevision: v.union(v.number(), v.null()),
    externalMessageId: v.union(v.string(), v.null()),
    failureCount: v.number(),
    guildId: v.string(),
    id: v.string(),
    idempotencyKey: v.string(),
    leaseExpiresAt: v.union(v.string(), v.null()),
    leaseId: v.union(v.string(), v.null()),
    leaseOwner: v.union(v.string(), v.null()),
    nextAttemptAt: v.union(v.string(), v.null()),
    processedCount: v.number(),
    reactionRoleMessageId: v.union(v.string(), v.null()),
    requestHash: v.string(),
    sendStartedAt: v.union(v.string(), v.null()),
    snapshotComplete: v.boolean(),
    snapshotCursor: v.union(v.string(), v.null()),
    stage: v.string(),
    status: v.union(
        v.literal('queued'),
        v.literal('running'),
        v.literal('waiting_retry'),
        v.literal('needs_attention'),
        v.literal('succeeded'),
        v.literal('cancelled')
    ),
    succeededCount: v.number(),
    totalCount: v.number(),
    type: v.union(v.literal('publish'), v.literal('save'), v.literal('delete')),
    updatedAt: v.string(),
});

export const reconciliationItemRecordValidator = v.object({
    assignmentId: v.string(),
    attemptCount: v.number(),
    createdAt: v.string(),
    emojiKey: v.string(),
    errorCode: v.union(v.string(), v.null()),
    id: v.string(),
    operationId: v.string(),
    outcome: v.union(v.string(), v.null()),
    roleId: v.string(),
    status: v.union(v.literal('pending'), v.literal('blocked'), v.literal('succeeded')),
    updatedAt: v.string(),
    userId: v.string(),
});

export const memberStateRecordValidator = v.object({
    configRevision: v.number(),
    createdAt: v.string(),
    desiredEmojiKeys: v.array(v.string()),
    errorCode: v.union(v.string(), v.null()),
    guildId: v.string(),
    id: v.string(),
    leaseExpiresAt: v.union(v.string(), v.null()),
    leaseId: v.union(v.string(), v.null()),
    leaseOwner: v.union(v.string(), v.null()),
    messageId: v.string(),
    nextAttemptAt: v.union(v.string(), v.null()),
    reactionRoleMessageId: v.string(),
    revision: v.number(),
    status: v.union(
        v.literal('pending'),
        v.literal('running'),
        v.literal('waiting_retry'),
        v.literal('blocked'),
        v.literal('synced')
    ),
    updatedAt: v.string(),
    userId: v.string(),
});

import { v } from 'convex/values';

import { outgoingEmbedValidator } from '../posting/message_validators.js';

export const reactionRoleModeValidator = v.union(v.literal('independent'), v.literal('exclusive'));

export const reactionRoleEmojiValidator = v.union(
    v.object({
        kind: v.literal('unicode'),
        value: v.string(),
    }),
    v.object({
        animated: v.boolean(),
        id: v.string(),
        kind: v.literal('custom'),
        name: v.string(),
    })
);

export const reactionRoleOptionInputValidator = v.object({
    emoji: reactionRoleEmojiValidator,
    id: v.string(),
    roleId: v.string(),
    roleName: v.string(),
});

export const reactionRoleOptionValidator = v.object({
    emoji: reactionRoleEmojiValidator,
    emojiKey: v.string(),
    id: v.string(),
    roleId: v.string(),
    roleName: v.string(),
});

export const reactionRoleSelectionSnapshotValidator = v.object({
    emoji: reactionRoleEmojiValidator,
    grantOwnership: v.union(v.literal('panel'), v.literal('preexisting'), v.literal('pending')),
    optionId: v.string(),
    roleId: v.string(),
});

export const reactionRolePanelStatusValidator = v.union(
    v.literal('publishing'),
    v.literal('active'),
    v.literal('updating'),
    v.literal('deactivating'),
    v.literal('degraded'),
    v.literal('unknown'),
    v.literal('inactive')
);

export const reactionRolePanelOperationStatusValidator = v.union(
    v.literal('queued'),
    v.literal('running'),
    v.literal('unknown'),
    v.literal('completed'),
    v.literal('permanent_failure')
);

export const reactionRoleMemberOperationStatusValidator = v.union(
    v.literal('queued'),
    v.literal('running'),
    v.literal('completed'),
    v.literal('permanent_failure')
);

export const reactionRolePanelOperationTypeValidator = v.union(
    v.literal('publish'),
    v.literal('update'),
    v.literal('deactivate')
);

export const reactionRolePanelOperationStepValidator = v.union(
    v.literal('queued'),
    v.literal('message_send_started'),
    v.literal('message_recorded'),
    v.literal('reactions_seeded'),
    v.literal('message_updated'),
    v.literal('cleanup_started'),
    v.literal('cleanup_completed'),
    v.literal('completed')
);

export const reactionRoleVersionPayloadValidator = v.object({
    content: v.optional(v.string()),
    embeds: v.array(outgoingEmbedValidator),
    mode: reactionRoleModeValidator,
    options: v.array(reactionRoleOptionValidator),
});

export const reactionRoleVersionInputValidator = v.object({
    content: v.optional(v.string()),
    embeds: v.array(outgoingEmbedValidator),
    mode: reactionRoleModeValidator,
    options: v.array(reactionRoleOptionInputValidator),
});

export const reactionRoleVersionRecordValidator = v.object({
    createdAt: v.string(),
    fingerprint: v.string(),
    id: v.string(),
    payload: reactionRoleVersionPayloadValidator,
    version: v.number(),
});

export const reactionRolePanelRecordValidator = v.object({
    appliedVersionId: v.union(v.string(), v.null()),
    channelId: v.string(),
    createdAt: v.string(),
    desiredVersion: reactionRoleVersionRecordValidator,
    errorCode: v.union(v.string(), v.null()),
    generation: v.number(),
    guildId: v.string(),
    id: v.string(),
    messageId: v.union(v.string(), v.null()),
    mode: reactionRoleModeValidator,
    name: v.string(),
    status: reactionRolePanelStatusValidator,
    updatedAt: v.string(),
});

export const reactionRolePanelOperationRecordValidator = v.object({
    attemptCount: v.number(),
    createdAt: v.string(),
    errorCode: v.union(v.string(), v.null()),
    id: v.string(),
    messageId: v.union(v.string(), v.null()),
    nextAttemptAt: v.union(v.string(), v.null()),
    panelId: v.string(),
    status: reactionRolePanelOperationStatusValidator,
    step: reactionRolePanelOperationStepValidator,
    type: reactionRolePanelOperationTypeValidator,
    updatedAt: v.string(),
});

export const reactionRolePanelMutationResultValidator = v.object({
    operation: reactionRolePanelOperationRecordValidator,
    panel: reactionRolePanelRecordValidator,
});

export const reactionRolePanelCompletionResultValidator = v.union(
    v.literal('completed'),
    v.literal('pending'),
    v.literal('stale')
);

export const reactionRolePanelWorkerRecordValidator = v.object({
    attemptCount: v.number(),
    channelId: v.string(),
    createdAt: v.string(),
    deleteMessage: v.boolean(),
    errorCode: v.union(v.string(), v.null()),
    generation: v.number(),
    guildId: v.string(),
    id: v.string(),
    leaseExpiresAt: v.union(v.string(), v.null()),
    leaseId: v.union(v.string(), v.null()),
    leaseOwner: v.union(v.string(), v.null()),
    messageId: v.union(v.string(), v.null()),
    nonce: v.string(),
    nextAttemptAt: v.union(v.string(), v.null()),
    panelId: v.string(),
    previousVersion: v.union(reactionRoleVersionRecordValidator, v.null()),
    revokeOwnedRoles: v.boolean(),
    status: reactionRolePanelOperationStatusValidator,
    step: reactionRolePanelOperationStepValidator,
    targetVersion: reactionRoleVersionRecordValidator,
    type: reactionRolePanelOperationTypeValidator,
    updatedAt: v.string(),
});

export const reactionRoleMemberWorkerRecordValidator = v.object({
    addedOptionIds: v.array(v.string()),
    attemptCount: v.number(),
    baselineRoleIds: v.union(v.array(v.string()), v.null()),
    channelId: v.string(),
    createdAt: v.string(),
    desiredSelections: v.array(reactionRoleSelectionSnapshotValidator),
    errorCode: v.union(v.string(), v.null()),
    guildId: v.string(),
    id: v.string(),
    leaseExpiresAt: v.union(v.string(), v.null()),
    leaseId: v.union(v.string(), v.null()),
    leaseOwner: v.union(v.string(), v.null()),
    messageId: v.union(v.string(), v.null()),
    nextAttemptAt: v.union(v.string(), v.null()),
    panelId: v.string(),
    previousSelections: v.array(reactionRoleSelectionSnapshotValidator),
    rerunRequested: v.boolean(),
    revision: v.number(),
    status: reactionRoleMemberOperationStatusValidator,
    updatedAt: v.string(),
    userId: v.string(),
});

export const reactionRoleIntentResultValidator = v.union(
    v.object({ type: v.literal('ignored') }),
    v.object({ type: v.literal('unconfigured') }),
    v.object({
        emoji: reactionRoleEmojiValidator,
        type: v.literal('seed-repair'),
    }),
    v.object({
        operationId: v.string(),
        revision: v.number(),
        type: v.literal('enqueued'),
    })
);

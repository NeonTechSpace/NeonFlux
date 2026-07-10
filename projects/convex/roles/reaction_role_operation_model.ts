import type { GenericId } from 'convex/values';

import type { ReactionRoleMessageMode } from './reaction_roles_model.js';

export const operationStatuses = [
    'queued',
    'running',
    'waiting_retry',
    'needs_attention',
    'succeeded',
    'cancelled',
] as const;
export type ReactionRoleOperationStatus = (typeof operationStatuses)[number];
export type ReactionRoleOperationType = 'delete' | 'publish' | 'save';

export type DesiredReactionRoleConfig = {
    enabled: boolean;
    generateOverview: boolean;
    messageContent?: string | undefined;
    messageEmbeds: unknown[];
    mode: ReactionRoleMessageMode;
    options: Array<{ emojiKey: string; position: number; roleId: string }>;
};

export type ReactionRoleOperationDocument = {
    actorMetadata?: unknown;
    actorUserId: string;
    attemptCount: number;
    blockedCount: number;
    channelId: string;
    completedAt?: string | undefined;
    createdAt: string;
    desiredConfig: DesiredReactionRoleConfig;
    errorCode?: string | undefined;
    expectedRevision?: number | undefined;
    externalMessageId?: string | undefined;
    failureCount?: number | undefined;
    guildId: string;
    idempotencyKey: string;
    leaseExpiresAt?: string | undefined;
    leaseId?: string | undefined;
    leaseOwner?: string | undefined;
    nextAttemptAt?: string | undefined;
    processedCount: number;
    reactionRoleMessageId?: GenericId<'reactionRoleMessages'> | undefined;
    requestHash: string;
    sendStartedAt?: string | undefined;
    snapshotComplete: boolean;
    snapshotCursor?: string | undefined;
    stage: string;
    status: ReactionRoleOperationStatus;
    succeededCount: number;
    totalCount: number;
    type: ReactionRoleOperationType;
    updatedAt: string;
};

export type StoredReactionRoleOperation = ReactionRoleOperationDocument & {
    _id: GenericId<'reactionRoleOperations'>;
};
const maxMessageContentLength = 4_000;
const maxEmbedPayloadLength = 100_000;
const maxIdentityLength = 256;

export function normalizeDesiredConfig(
    input: DesiredReactionRoleConfig,
    settings: { allowEmptyOptions?: boolean } = {}
): DesiredReactionRoleConfig {
    const messageContent = input.messageContent?.trim();
    const seenEmojiKeys = new Set<string>();
    const seenRoleIds = new Set<string>();

    if ((!settings.allowEmptyOptions && input.options.length === 0) || input.options.length > 30) {
        throw new Error('invalid-options');
    }
    if ((messageContent?.length ?? 0) > maxMessageContentLength) throw new Error('message-too-long');
    if (JSON.stringify(input.messageEmbeds).length > maxEmbedPayloadLength) throw new Error('embeds-too-large');

    const options = input.options.map((option) => {
        const emojiKey = option.emojiKey.trim();
        const roleId = option.roleId.trim();

        if (
            !emojiKey ||
            emojiKey.length > maxIdentityLength ||
            !roleId ||
            roleId.length > maxIdentityLength ||
            !Number.isInteger(option.position) ||
            option.position < 0
        ) {
            throw new Error('invalid-option');
        }

        if (seenEmojiKeys.has(emojiKey)) throw new Error('duplicate-emoji');
        if (seenRoleIds.has(roleId)) throw new Error('duplicate-role');
        seenEmojiKeys.add(emojiKey);
        seenRoleIds.add(roleId);

        return { emojiKey, position: option.position, roleId };
    });

    if (!messageContent && input.messageEmbeds.length === 0) {
        throw new Error('missing-message');
    }

    return {
        enabled: input.enabled,
        generateOverview: input.generateOverview,
        ...(messageContent ? { messageContent } : {}),
        messageEmbeds: input.messageEmbeds,
        mode: input.mode,
        options,
    };
}

export function buildOperationDocument(input: {
    actorMetadata?: unknown;
    actorUserId: string;
    channelId: string;
    desiredConfig: DesiredReactionRoleConfig;
    expectedRevision?: number;
    externalMessageId?: string;
    guildId: string;
    idempotencyKey: string;
    now: string;
    reactionRoleMessageId?: GenericId<'reactionRoleMessages'>;
    requestHash: string;
    type: ReactionRoleOperationType;
}): ReactionRoleOperationDocument {
    const guildId = requireText(input.guildId, 'guildId');
    const channelId = requireText(input.channelId, 'channelId');
    const actorUserId = requireText(input.actorUserId, 'actorUserId');
    const idempotencyKey = requireText(input.idempotencyKey, 'idempotencyKey');
    const requestHash = requireText(input.requestHash, 'requestHash');

    return {
        ...(input.actorMetadata === undefined ? {} : { actorMetadata: input.actorMetadata }),
        actorUserId,
        attemptCount: 0,
        blockedCount: 0,
        channelId,
        createdAt: input.now,
        desiredConfig: normalizeDesiredConfig(input.desiredConfig, { allowEmptyOptions: input.type === 'delete' }),
        ...(input.expectedRevision === undefined ? {} : { expectedRevision: input.expectedRevision }),
        ...(input.externalMessageId ? { externalMessageId: input.externalMessageId.trim() } : {}),
        failureCount: 0,
        guildId,
        idempotencyKey,
        processedCount: 0,
        ...(input.reactionRoleMessageId ? { reactionRoleMessageId: input.reactionRoleMessageId } : {}),
        requestHash,
        snapshotComplete: input.type === 'publish',
        stage: input.type === 'publish' ? 'send' : 'snapshot',
        status: 'queued',
        succeededCount: 0,
        totalCount: 0,
        type: input.type,
        updatedAt: input.now,
    };
}

export function toOperationRecord(operation: StoredReactionRoleOperation) {
    return {
        actorUserId: operation.actorUserId,
        attemptCount: operation.attemptCount,
        blockedCount: operation.blockedCount,
        channelId: operation.channelId,
        completedAt: operation.completedAt ?? null,
        createdAt: operation.createdAt,
        desiredConfig: {
            ...operation.desiredConfig,
            messageContent: operation.desiredConfig.messageContent ?? null,
        },
        errorCode: operation.errorCode ?? null,
        expectedRevision: operation.expectedRevision ?? null,
        externalMessageId: operation.externalMessageId ?? null,
        failureCount: operation.failureCount ?? 0,
        guildId: operation.guildId,
        id: operation._id,
        idempotencyKey: operation.idempotencyKey,
        leaseExpiresAt: operation.leaseExpiresAt ?? null,
        leaseId: operation.leaseId ?? null,
        leaseOwner: operation.leaseOwner ?? null,
        nextAttemptAt: operation.nextAttemptAt ?? null,
        processedCount: operation.processedCount,
        reactionRoleMessageId: operation.reactionRoleMessageId ?? null,
        requestHash: operation.requestHash,
        sendStartedAt: operation.sendStartedAt ?? null,
        snapshotComplete: operation.snapshotComplete,
        snapshotCursor: operation.snapshotCursor ?? null,
        stage: operation.stage,
        status: operation.status,
        succeededCount: operation.succeededCount,
        totalCount: operation.totalCount,
        type: operation.type,
        updatedAt: operation.updatedAt,
    };
}

export function toOperationInsert(document: ReactionRoleOperationDocument) {
    return {
        ...(document.actorMetadata === undefined ? {} : { actorMetadata: document.actorMetadata }),
        actorUserId: document.actorUserId,
        attemptCount: document.attemptCount,
        blockedCount: document.blockedCount,
        channelId: document.channelId,
        ...(document.completedAt ? { completedAt: document.completedAt } : {}),
        createdAt: document.createdAt,
        desiredConfig: {
            enabled: document.desiredConfig.enabled,
            generateOverview: document.desiredConfig.generateOverview,
            ...(document.desiredConfig.messageContent ? { messageContent: document.desiredConfig.messageContent } : {}),
            messageEmbeds: document.desiredConfig.messageEmbeds,
            mode: document.desiredConfig.mode,
            options: document.desiredConfig.options,
        },
        ...(document.errorCode ? { errorCode: document.errorCode } : {}),
        ...(document.expectedRevision === undefined ? {} : { expectedRevision: document.expectedRevision }),
        ...(document.externalMessageId ? { externalMessageId: document.externalMessageId } : {}),
        failureCount: document.failureCount ?? 0,
        guildId: document.guildId,
        idempotencyKey: document.idempotencyKey,
        ...(document.leaseExpiresAt ? { leaseExpiresAt: document.leaseExpiresAt } : {}),
        ...(document.leaseId ? { leaseId: document.leaseId } : {}),
        ...(document.leaseOwner ? { leaseOwner: document.leaseOwner } : {}),
        ...(document.nextAttemptAt ? { nextAttemptAt: document.nextAttemptAt } : {}),
        processedCount: document.processedCount,
        ...(document.reactionRoleMessageId ? { reactionRoleMessageId: document.reactionRoleMessageId } : {}),
        requestHash: document.requestHash,
        ...(document.sendStartedAt ? { sendStartedAt: document.sendStartedAt } : {}),
        snapshotComplete: document.snapshotComplete,
        ...(document.snapshotCursor ? { snapshotCursor: document.snapshotCursor } : {}),
        stage: document.stage,
        status: document.status,
        succeededCount: document.succeededCount,
        totalCount: document.totalCount,
        type: document.type,
        updatedAt: document.updatedAt,
    };
}

export function finishAssignmentSnapshotPass(input: { processedCount: number; stage: string; totalCount: number }) {
    if (input.stage === 'verify') {
        return {
            snapshotComplete: true,
            snapshotCursor: undefined,
            stage: input.totalCount > input.processedCount ? 'reconcile' : 'message',
        };
    }
    return input.totalCount > 0
        ? { snapshotComplete: true, snapshotCursor: undefined, stage: 'reconcile' }
        : { snapshotComplete: false, snapshotCursor: undefined, stage: 'verify' };
}

function requireText(value: string, field: string): string {
    const normalized = value.trim();
    if (!normalized || normalized.length > maxIdentityLength) throw new Error(`invalid-${field}`);
    return normalized;
}

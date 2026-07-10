import '@tanstack/react-start/server-only';

import { createHash } from 'node:crypto';

import type { ReactionRoleOperationRecord, ReactionRoleOperationRequestResult } from '@neonflux/db';

import type { DashboardReactionRoleOperation } from './dashboard-reaction-roles-types.js';

const maxIdempotencyKeyLength = 256;

export function isValidReactionRoleIdempotencyKey(value: string) {
    const normalized = value.trim();
    return normalized.length > 0 && normalized.length <= maxIdempotencyKeyLength;
}

export function createReactionRoleRequestHash(value: unknown): string {
    return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

export function toDashboardReactionRoleOperation(
    operation: ReactionRoleOperationRecord
): DashboardReactionRoleOperation {
    return {
        blockedCount: operation.blockedCount,
        channelId: operation.channelId,
        ...(operation.completedAt ? { completedAt: operation.completedAt.toISOString() } : {}),
        ...(operation.errorCode ? { errorCode: operation.errorCode } : {}),
        ...(operation.externalMessageId ? { externalMessageId: operation.externalMessageId } : {}),
        id: operation.id,
        processedCount: operation.processedCount,
        status: operation.status,
        totalCount: operation.totalCount,
        type: operation.type,
        updatedAt: operation.updatedAt.toISOString(),
    };
}

export function mapReactionRoleOperationRequestResult(result: ReactionRoleOperationRequestResult) {
    switch (result.type) {
        case 'accepted':
            return {
                type: 'operation-accepted' as const,
                operation: toDashboardReactionRoleOperation(result.operation),
            };
        case 'existing':
            return {
                type: 'operation-existing' as const,
                operation: toDashboardReactionRoleOperation(result.operation),
            };
        case 'busy':
            return {
                type: 'operation-busy' as const,
                ...(result.operation ? { operation: toDashboardReactionRoleOperation(result.operation) } : {}),
            };
        case 'idempotency-conflict':
            return { type: 'idempotency-conflict' as const };
        case 'not-found':
            return { type: 'not-found' as const };
        case 'revision-conflict':
            return { type: 'revision-conflict' as const, currentRevision: result.currentRevision };
    }
}

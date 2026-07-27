import { v } from 'convex/values';

import type { MutationCtx } from '../_generated/server.js';
import { recordBotActionEventInMutation } from '../core/events.js';

const blueprintFeature = 'blueprint';

export const auditInputValidator = v.object({
    action: v.string(),
    actorUserId: v.optional(v.union(v.string(), v.null())),
    metadata: v.optional(v.any()),
    targetId: v.optional(v.union(v.string(), v.null())),
});

export async function recordBlueprintAuditInMutation(
    ctx: MutationCtx,
    guildId: string,
    audit: { action: string; actorUserId?: string | null; metadata?: unknown; targetId?: string | null } | undefined,
    now: string,
    defaultTargetId: string
): Promise<void> {
    if (!audit) return;

    await recordBotActionEventInMutation(ctx, {
        action: audit.action,
        createdAt: now,
        feature: blueprintFeature,
        guildId,
        metadata: audit.metadata,
        targetId: audit.targetId ?? defaultTargetId,
        ...(audit.actorUserId ? { actorUserId: audit.actorUserId } : {}),
    });
}

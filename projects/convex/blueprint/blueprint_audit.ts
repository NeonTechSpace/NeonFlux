import { v } from 'convex/values';

import type { MutationCtx } from '../_generated/server.js';
import { markDashboardLiveAreasChangedInMutation } from '../core/dashboard_live.js';
import { dashboardLiveAreasForBotActionFeature } from '../core/dashboard_live_model.js';
import { buildBotActionEventDocument, buildBotActionEventSortKey } from '../core/events_model.js';

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

    const document = unwrap(
        buildBotActionEventDocument(
            {
                action: audit.action,
                feature: blueprintFeature,
                guildId,
                metadata: audit.metadata,
                targetId: audit.targetId ?? defaultTargetId,
                ...(audit.actorUserId ? { actorUserId: audit.actorUserId } : {}),
            },
            now
        )
    );

    const auditEventId = await ctx.db.insert('botActionEvents', document);
    await ctx.db.patch('botActionEvents', auditEventId, {
        sortKey: buildBotActionEventSortKey({ createdAt: document.createdAt, id: auditEventId }),
    });
    await markDashboardLiveAreasChangedInMutation(ctx, {
        areas: dashboardLiveAreasForBotActionFeature(document.feature),
        guildId,
        now: document.createdAt,
    });
}

function unwrap<Value>(result: { ok: true; value: Value } | { error: unknown; ok: false }): Value {
    if (!result.ok) {
        const error = result.error;
        if (typeof error === 'object' && error !== null && 'type' in error) throw new Error(String(error.type));
        throw new Error(String(error));
    }
    return result.value;
}

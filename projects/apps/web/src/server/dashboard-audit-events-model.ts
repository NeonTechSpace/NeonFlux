import type { BotActionEventSearchScope } from '@neonflux/db';

export type DashboardAuditMetadata = Partial<Record<string, string | number | boolean | null>>;
export type DashboardAuditSearchScope = BotActionEventSearchScope;

export type DashboardAuditEvent = {
    id: string;
    feature: string;
    action: string;
    actorUserId?: string;
    actorUsername?: string;
    actorDisplayName?: string;
    targetId?: string;
    metadata: DashboardAuditMetadata;
    createdAt: string;
};

export type DashboardAuditEventsResult =
    | {
          type: 'events';
          auditEvents: DashboardAuditEvent[];
          nextCursor?: string;
      }
    | { type: 'auth-required' }
    | { type: 'not-found' }
    | { type: 'deployment-config-not-found' }
    | { type: 'database-error' }
    | { type: 'guild-lookup-failed' };

export type DashboardAuditEventsInput = {
    guildId: string;
    cursor?: string;
    limit?: number;
    search?: string;
    searchScope?: DashboardAuditSearchScope;
    searchOffsetMinutes?: number;
};

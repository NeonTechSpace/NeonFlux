export type DashboardGuildOverview = {
    oldestRetainedActivityAt?: string;
    windowDays: number;
    activityPresence: {
        hasMemberFlow: boolean;
        hasMessageActivity: boolean;
    };
    memberFlow: {
        totalJoins: number;
        totalLeaves: number;
        netGrowth: number;
        graph: Array<{
            date: string;
            joins: number;
            leaves: number;
            netGrowth: number;
        }>;
    };
    messages: {
        totalMessages: number;
        graph: Array<{
            date: string;
            messageCount: number;
        }>;
    };
};

export type DashboardGuildOverviewResult =
    | {
          type: 'overview';
          overview: DashboardGuildOverview;
      }
    | { type: 'auth-required' }
    | { type: 'not-found' }
    | { type: 'deployment-config-not-found' }
    | { type: 'database-error' }
    | { type: 'guild-lookup-failed' };

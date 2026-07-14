import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import type { ReactNode } from 'react';

import { getDashboardCommandSettingsQueryKey } from '../dashboard-query-keys.js';
import type { DashboardCommandSettingsReadResult } from '../server/dashboard-guild-route-data.js';
import { readDashboardCommandSettingsRouteData } from '../server/dashboard-guild-route-data.js';
import {
    DashboardCommandPrefixLoadingPanel,
    DashboardCommandPrefixSettingsPanel,
} from './dashboard-command-prefix-panel.js';
import {
    dashboardDangerActionClassName,
    dashboardSecondaryActionClassName,
    DashboardStatus,
    DashboardSurface,
} from './dashboard-ui.js';

const fluxerLoginPath = '/auth/fluxer/login';

export function DashboardCommandPrefixRouteContent({ guildId }: { guildId: string }) {
    const [retrying, setRetrying] = useState(false);
    const commandSettingsQuery = useQuery({
        queryKey: getDashboardCommandSettingsQueryKey(guildId),
        queryFn: async () => {
            const result = await readDashboardCommandSettingsRouteData({ data: { guildId } });

            if (result.type !== 'settings') throw new DashboardCommandSettingsReadError(result.type);
            return result.commandSettings;
        },
        retry: false,
        staleTime: Number.POSITIVE_INFINITY,
    });

    if (commandSettingsQuery.isPending && !retrying) {
        return <DashboardCommandPrefixLoadingPanel />;
    }

    if (commandSettingsQuery.data) {
        return <DashboardCommandPrefixSettingsPanel guildId={guildId} commandSettings={commandSettingsQuery.data} />;
    }

    const failureType =
        commandSettingsQuery.error instanceof DashboardCommandSettingsReadError
            ? commandSettingsQuery.error.type
            : 'database-error';
    const action = getCommandSettingsFailureAction(failureType, {
        retry: () => {
            if (retrying) return;
            setRetrying(true);
            void commandSettingsQuery.refetch().finally(() => setRetrying(false));
        },
        retrying,
    });

    return (
        <DashboardSurface as='section' aria-label='Command prefix setting'>
            <DashboardStatus tone={action.tone} actions={action.action}>
                {action.message}
            </DashboardStatus>
        </DashboardSurface>
    );
}

class DashboardCommandSettingsReadError extends Error {
    constructor(readonly type: Exclude<DashboardCommandSettingsReadResult['type'], 'settings'>) {
        super(`Command settings read failed: ${type}`);
    }
}

function getCommandSettingsFailureAction(
    type: Exclude<DashboardCommandSettingsReadResult['type'], 'settings'>,
    retryState: { retry: () => void; retrying: boolean }
): {
    message: string;
    tone: 'danger' | 'warning';
    action: ReactNode;
} {
    switch (type) {
        case 'auth-required':
            return {
                message: 'Your session expired before these settings could be loaded.',
                tone: 'warning',
                action: (
                    <a
                        href={fluxerLoginPath}
                        className={`${dashboardSecondaryActionClassName} inline-flex items-center`}>
                        Sign in again
                    </a>
                ),
            };

        case 'not-found':
            return {
                message: 'This server is no longer available for this account.',
                tone: 'warning',
                action: (
                    <Link to='/dashboard' className={`${dashboardSecondaryActionClassName} inline-flex items-center`}>
                        Choose server
                    </Link>
                ),
            };

        case 'database-error':
        case 'deployment-config-not-found':
        case 'guild-lookup-failed':
            return {
                message: 'Command settings could not be loaded. The rest of this server dashboard is still available.',
                tone: 'danger',
                action: (
                    <button
                        type='button'
                        onClick={retryState.retry}
                        disabled={retryState.retrying}
                        aria-busy={retryState.retrying || undefined}
                        className={dashboardDangerActionClassName}>
                        {retryState.retrying ? 'Retrying…' : 'Retry settings'}
                    </button>
                ),
            };
    }
}

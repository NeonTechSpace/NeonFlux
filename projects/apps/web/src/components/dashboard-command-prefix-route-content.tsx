import { Link } from '@tanstack/react-router';
import type { ReactNode } from 'react';

import type { DashboardCommandSettingsReadResult } from '../server/dashboard-guild-route-data.js';
import { DashboardCommandPrefixSettingsPanel } from './dashboard-command-prefix-panel.js';
import { DashboardRouteRetryButton } from './dashboard-route-retry-button.js';
import { dashboardSecondaryActionClassName, DashboardStatus, DashboardSurface } from './dashboard-ui.js';

const fluxerLoginPath = '/auth/fluxer/login';

export function DashboardCommandPrefixRouteContent({
    guildId,
    commandSettingsResult,
}: {
    guildId: string;
    commandSettingsResult: DashboardCommandSettingsReadResult;
}) {
    if (commandSettingsResult.type === 'settings') {
        return (
            <DashboardCommandPrefixSettingsPanel
                guildId={guildId}
                commandSettings={commandSettingsResult.commandSettings}
            />
        );
    }

    const action = getCommandSettingsFailureAction(commandSettingsResult.type);

    return (
        <DashboardSurface as='section' aria-label='Command prefix setting'>
            <DashboardStatus tone={action.tone} actions={action.action}>
                {action.message}
            </DashboardStatus>
        </DashboardSurface>
    );
}

function getCommandSettingsFailureAction(type: Exclude<DashboardCommandSettingsReadResult['type'], 'settings'>): {
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
                action: <DashboardRouteRetryButton label='Retry settings' />,
            };
    }
}

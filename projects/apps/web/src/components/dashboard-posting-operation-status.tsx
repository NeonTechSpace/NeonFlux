import type { DashboardPostingChannel, DashboardPostingOperation } from '../server/dashboard-posting.server.js';
import { formatDashboardChannelLabel } from './dashboard-channel-picker.js';
import { DashboardStatus } from './dashboard-ui.js';

export function DashboardPostingOperationHistory({
    channels,
    hasError,
    operations,
}: {
    channels: DashboardPostingChannel[];
    hasError: boolean;
    operations: DashboardPostingOperation[];
}) {
    if (hasError) {
        return <p className='mt-4 text-xs text-[var(--dash-text-subtle)]'>Recent delivery status is unavailable.</p>;
    }
    if (operations.length === 0) return null;

    return (
        <section className='mt-5 border-t border-[var(--dash-border)] pt-4' aria-label='Recent message delivery'>
            <h3 className='text-sm font-semibold text-[var(--dash-text)]'>Recent delivery</h3>
            <ol className='mt-3 space-y-3'>
                {operations.slice(0, 5).map((operation) => (
                    <li key={operation.id} className='space-y-1'>
                        <div className='flex flex-wrap items-center justify-between gap-2'>
                            <span className='text-xs text-[var(--dash-text-muted)]'>
                                {getChannelLabel(channels, operation.requestedChannelId)}
                            </span>
                            <DashboardStatus tone={getStatusTone(operation.status)}>
                                {getStatusLabel(operation.status)}
                            </DashboardStatus>
                        </div>
                        <p className='text-xs leading-5 text-[var(--dash-text-subtle)]'>
                            {getStatusExplanation(operation)}
                        </p>
                    </li>
                ))}
            </ol>
        </section>
    );
}

export function getDashboardPostingOperationConfirmationMessage(
    operation: DashboardPostingOperation,
    channelLabel: string
): string {
    switch (operation.status) {
        case 'queued':
            return `Queued for ${channelLabel}. You can leave this page.`;
        case 'running':
            return `Delivering to ${channelLabel}.`;
        case 'sent':
            return `Sent to ${channelLabel}.`;
        case 'unknown':
            return `Delivery could not be confirmed. Check ${channelLabel} before trying again.`;
        case 'permanent_failure':
            return `The message was not sent to ${channelLabel}. Review it and try again.`;
    }
}

function getStatusExplanation(operation: DashboardPostingOperation): string {
    switch (operation.status) {
        case 'queued':
            return 'Waiting for the connected bot. It will continue if you leave this page.';
        case 'running':
            return 'The connected bot is delivering this message.';
        case 'sent':
            return 'Delivery was confirmed.';
        case 'unknown':
            return 'The provider outcome is unknown. Check the channel before another attempt.';
        case 'permanent_failure':
            return 'Nothing was sent. You can safely revise the message and try again.';
    }
}

function getStatusLabel(status: DashboardPostingOperation['status']): string {
    switch (status) {
        case 'queued':
            return 'Queued';
        case 'running':
            return 'Delivering';
        case 'sent':
            return 'Sent';
        case 'unknown':
            return 'Outcome unknown';
        case 'permanent_failure':
            return 'Not sent';
    }
}

function getStatusTone(status: DashboardPostingOperation['status']): 'danger' | 'info' | 'success' | 'warning' {
    switch (status) {
        case 'queued':
        case 'running':
            return 'info';
        case 'sent':
            return 'success';
        case 'unknown':
            return 'warning';
        case 'permanent_failure':
            return 'danger';
    }
}

function getChannelLabel(channels: DashboardPostingChannel[], channelId: string): string {
    const channel = channels.find((candidate) => candidate.id === channelId);
    return channel ? formatDashboardChannelLabel(channel) : `Channel ${channelId}`;
}

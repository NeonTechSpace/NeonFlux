import { motion } from 'motion/react';
import type { ReactNode } from 'react';

import type { DashboardAuditEvent } from '../server/dashboard-audit-events-model.js';
import { dashboardTactile } from './dashboard-motion.js';
import { dashboardSecondaryActionClassName } from './dashboard-ui.js';

type AuditEventDetail = {
    key: string;
    label: string;
    value: ReactNode;
};

export function DashboardAuditEventRow({ event }: { event: DashboardAuditEvent }) {
    const details = getAuditEventDetails(event);
    const actorName = event.actorUserId ? (formatAuditActorName(event) ?? 'Dashboard user') : 'System';

    return (
        <details className={`group border-l-2 ${getAuditEventBorderClassName(event)}`} role='listitem'>
            <motion.summary
                data-dashboard-disclosure
                className='grid min-h-[4.5rem] cursor-pointer list-none gap-2 px-3 py-2 transition outline-none hover:bg-[var(--dash-surface-raised)] focus-visible:bg-[var(--dash-surface-raised)] focus-visible:shadow-[inset_0_0_0_2px_var(--dash-primary)] md:grid-cols-[minmax(18rem,1fr)_minmax(10rem,0.55fr)_minmax(10rem,0.45fr)_1.5rem] md:items-center md:gap-3 [&::-webkit-details-marker]:hidden'
                {...dashboardTactile}>
                <div className='min-w-0'>
                    <div className='flex min-w-0 flex-wrap items-center gap-2'>
                        <span
                            className={`shrink-0 rounded-[var(--dash-radius-control)] border px-2 py-0.5 text-xs font-semibold ${getAuditFeatureBadgeClassName(event.feature)}`}>
                            {formatAuditFeature(event.feature)}
                        </span>
                        <span className='min-w-0 truncate text-sm font-semibold text-[var(--dash-text)]'>
                            {formatAuditAction(event)}
                        </span>
                    </div>
                </div>
                <span className='truncate text-sm text-[var(--dash-text-muted)]'>{actorName}</span>
                <time dateTime={event.createdAt} className='text-sm text-[var(--dash-text-muted)]'>
                    {formatAuditEventTimestamp(event.createdAt)}
                </time>
                <span
                    className='text-lg text-[var(--dash-text-subtle)] transition group-open:rotate-90'
                    aria-hidden='true'>
                    ›
                </span>
            </motion.summary>

            <div className='border-t border-[var(--dash-border)] bg-[var(--dash-surface)] px-3 py-3'>
                <p className='text-xs break-words text-[var(--dash-text-subtle)]'>
                    Event ID <span className='font-mono break-all text-[var(--dash-text-muted)]'>{event.id}</span>
                </p>
                <dl className='mt-2 grid gap-x-6 sm:grid-cols-2 xl:grid-cols-3'>
                    <div className='min-w-0 border-b border-[var(--dash-border)] py-2'>
                        <dt className='text-xs font-medium tracking-wide text-[var(--dash-text-subtle)] uppercase'>
                            Event type
                        </dt>
                        <dd className='mt-1 min-w-0 text-sm text-[var(--dash-text)]'>
                            <MonoValue value={event.action} />
                        </dd>
                    </div>
                    {details.map((detail) => (
                        <div
                            key={detail.key}
                            className='min-w-0 border-b border-[var(--dash-border)] py-2 last:border-b-0'>
                            <dt className='text-xs font-medium tracking-wide text-[var(--dash-text-subtle)] uppercase'>
                                {detail.label}
                            </dt>
                            <dd className='mt-1 min-w-0 text-sm break-words text-[var(--dash-text)]'>{detail.value}</dd>
                        </div>
                    ))}
                </dl>
            </div>
        </details>
    );
}

export function DashboardAuditEventsLoadMoreRow({
    isFetchingNextPage,
    fetchNextPage,
}: {
    isFetchingNextPage: boolean;
    fetchNextPage: () => Promise<unknown>;
}) {
    return (
        <div className='p-3' role='listitem'>
            <motion.button
                type='button'
                disabled={isFetchingNextPage}
                onClick={() => void fetchNextPage()}
                className={`${dashboardSecondaryActionClassName} min-h-10 text-sm`}
                {...dashboardTactile}>
                {isFetchingNextPage ? 'Loading older events...' : 'Load older events'}
            </motion.button>
        </div>
    );
}

function getAuditEventDetails(event: DashboardAuditEvent): AuditEventDetail[] {
    const channelId = getMetadataString(event.metadata.channelId);
    const channelName = getMetadataString(event.metadata.channelName);
    const messageId =
        getMetadataString(event.metadata.messageId) ?? (event.feature === 'posting' ? event.targetId : undefined);
    const targetDetail = getAuditTargetDetail(event);
    const details = [
        {
            key: 'field:actor',
            label: 'Actor',
            value: event.actorUserId ? (
                <NamedId name={formatAuditActorName(event)} id={event.actorUserId} />
            ) : (
                <MutedValue value='System' />
            ),
        },
        ...(channelId
            ? [
                  {
                      key: 'field:channel',
                      label: 'Channel',
                      value: <NamedId name={channelName ? `#${channelName}` : undefined} id={channelId} />,
                  },
              ]
            : []),
        ...(targetDetail ? [targetDetail] : []),
        ...(messageId
            ? [
                  {
                      key: 'field:message',
                      label: 'Message',
                      value: <MonoValue value={messageId} />,
                  },
              ]
            : []),
        ...getAuditMetadataDetails(event),
    ];

    return details;
}

function getAuditTargetDetail(event: DashboardAuditEvent): AuditEventDetail | undefined {
    if (!event.targetId) return undefined;

    if (event.feature === 'blueprint') {
        return {
            key: 'field:target',
            label: getBlueprintAuditTargetLabel(event.action),
            value: <MonoValue value={event.targetId} />,
        };
    }

    if (event.feature !== 'posting') {
        return {
            key: 'field:target',
            label: 'Target',
            value: <MonoValue value={event.targetId} />,
        };
    }

    return undefined;
}

function getBlueprintAuditTargetLabel(action: string): string {
    if (action === 'blueprint.backup_restore_point_created' || action.startsWith('blueprint.plan_')) {
        return 'Blueprint plan';
    }

    if (
        action === 'blueprint.backup_settings_updated' ||
        action === 'blueprint.backup_retention_pruned' ||
        action.startsWith('blueprint.scheduled_drift_')
    ) {
        return 'Guild/settings target';
    }

    if (action.startsWith('blueprint.backup_')) {
        return 'Backup target';
    }

    if (action.startsWith('blueprint.run_')) return 'Blueprint run';

    return 'Target';
}

function getAuditMetadataDetails(event: DashboardAuditEvent) {
    const metadata = event.metadata;
    const baseDetails = [
        formatMetadataDetail('contentLength', 'Content length', metadata.contentLength),
        formatMetadataDetail('embedCount', 'Embeds', metadata.embedCount),
        formatMetadataDetail('source', 'Source', metadata.source),
    ].filter((detail): detail is AuditEventDetail => Boolean(detail));
    const featureDetails =
        event.feature === 'blueprint'
            ? [
                  formatMetadataDetail(
                      'changeCount',
                      event.action.startsWith('blueprint.scheduled_drift_') ? 'Drift changes' : 'Changes',
                      metadata.changeCount
                  ),
                  formatMetadataDetail('createCount', 'Creates', metadata.createCount),
                  formatMetadataDetail('updateCount', 'Updates', metadata.updateCount),
                  formatMetadataDetail('deleteCount', 'Deletes', metadata.deleteCount),
                  formatMetadataDetail('appliedCount', 'Applied', metadata.appliedCount),
                  formatMetadataDetail('failedCount', 'Failed', metadata.failedCount),
                  formatMetadataDetail(
                      metadata.backupName === undefined || metadata.backupName === null ? 'backupId' : 'backupName',
                      'Backup',
                      metadata.backupName ?? metadata.backupId
                  ),
                  formatMetadataDetail('backupSource', 'Backup source', metadata.backupSource),
                  formatMetadataDetail('restorePointBackupId', 'Restore point', metadata.restorePointBackupId),
                  formatMetadataDetail('deletedCount', 'Retention deleted', metadata.deletedCount),
                  formatMetadataDetail(
                      'status',
                      'Drift status',
                      event.action.startsWith('blueprint.scheduled_drift_') ? metadata.status : undefined
                  ),
              ].filter((detail): detail is AuditEventDetail => Boolean(detail))
            : [];
    const presentedMetadataKeys = new Set([
        'actorDisplayName',
        'actorGlobalName',
        'actorUsername',
        'channelId',
        'channelName',
        'messageId',
        ...baseDetails.map((detail) => detail.key.slice('metadata:'.length)),
        ...featureDetails.map((detail) => detail.key.slice('metadata:'.length)),
    ]);
    const genericDetails = Object.entries(metadata)
        .filter(([key]) => !presentedMetadataKeys.has(key))
        .map(([key, value]) => formatMetadataDetail(key, formatAuditMetadataLabel(key), value))
        .filter((detail): detail is AuditEventDetail => Boolean(detail));

    return [...baseDetails, ...featureDetails, ...genericDetails];
}

function formatMetadataDetail(key: string, label: string, value: unknown): AuditEventDetail | undefined {
    if (typeof value === 'string' && value.trim()) {
        return { key: `metadata:${key}`, label, value };
    }

    if (typeof value === 'number' && Number.isFinite(value)) {
        return { key: `metadata:${key}`, label, value: String(value) };
    }

    if (typeof value === 'boolean') {
        return { key: `metadata:${key}`, label, value: value ? 'True' : 'False' };
    }

    return value === null ? { key: `metadata:${key}`, label, value: 'None' } : undefined;
}

function formatAuditMetadataLabel(key: string): string {
    const words = key
        .replace(/([a-z\d])([A-Z])/gu, '$1 $2')
        .split(/[._\s-]+/u)
        .filter(Boolean)
        .join(' ')
        .toLocaleLowerCase();

    return words ? `${words.charAt(0).toUpperCase()}${words.slice(1)}` : key;
}

function NamedId({ name, id }: { name?: string; id: string }) {
    return (
        <span className='block min-w-0'>
            {name ? <span className='block truncate font-semibold text-[var(--dash-text)]'>{name}</span> : null}
            <span className='block truncate font-mono text-xs text-[var(--dash-text-subtle)]'>{id}</span>
        </span>
    );
}

function formatAuditActorName(event: DashboardAuditEvent): string | undefined {
    if (event.actorUsername) {
        return `@${event.actorUsername}`;
    }

    return event.actorDisplayName;
}

function MonoValue({ value }: { value: string }) {
    return <span className='block truncate font-mono text-xs text-[var(--dash-text-muted)]'>{value}</span>;
}

function MutedValue({ value }: { value: string }) {
    return <span className='text-[var(--dash-text-subtle)]'>{value}</span>;
}

function getMetadataString(value: unknown): string | undefined {
    return typeof value === 'string' && value.trim() ? value : undefined;
}

function getAuditEventBorderClassName(event: DashboardAuditEvent): string {
    if (isFailureAuditAction(event.action)) {
        return 'border-l-4 border-l-[var(--dash-danger)]';
    }

    if (isWarningAuditAction(event.action)) {
        return 'border-l-4 border-l-[var(--dash-warning)]';
    }

    return 'border-l-4 border-l-[var(--dash-border-strong)]';
}

function getAuditFeatureBadgeClassName(feature: string): string {
    if (feature === 'posting') {
        return 'border-[var(--dash-live)] bg-[var(--dash-primary-soft)] text-[var(--dash-text)]';
    }

    if (feature === 'settings') {
        return 'border-[var(--dash-creative)] bg-[var(--dash-accent-soft)] text-[var(--dash-text)]';
    }

    if (feature === 'security' || feature === 'access') {
        return 'border-[var(--dash-warning)] bg-[var(--dash-warning-soft)] text-[var(--dash-text)]';
    }

    return 'border-[var(--dash-border)] bg-[var(--dash-surface-raised)] text-[var(--dash-text-muted)]';
}

function formatAuditAction(event: DashboardAuditEvent): string {
    const featurePrefix = `${event.feature}.`;
    const action = event.action.startsWith(featurePrefix) ? event.action.slice(featurePrefix.length) : event.action;
    const words = action
        .split(/[._-]+/u)
        .filter(Boolean)
        .join(' ');

    return words ? `${words.charAt(0).toUpperCase()}${words.slice(1)}` : event.action;
}

function isFailureAuditAction(action: string): boolean {
    return /(?:^|[._-])(?:failed|failure|error)(?:$|[._-])/u.test(action);
}

function isWarningAuditAction(action: string): boolean {
    return /(?:^|[._-])(?:unknown|needs_reconciliation|drift_detected)(?:$|[._-])/u.test(action);
}

function formatAuditFeature(feature: string): string {
    return feature
        .split(/[._-]+/u)
        .filter(Boolean)
        .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
        .join(' ');
}

function formatAuditEventTimestamp(value: string): string {
    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
        return value;
    }

    return date.toLocaleString('en-US');
}

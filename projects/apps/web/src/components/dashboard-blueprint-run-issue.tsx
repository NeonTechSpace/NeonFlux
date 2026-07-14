import { DashboardStatus, dashboardSecondaryActionClassName } from './dashboard-ui.js';

export function DashboardBlueprintRunIssue({
    code,
    message,
    retrying,
    retryLabel,
    onRetry,
}: {
    code: string;
    message: string;
    retrying: boolean;
    retryLabel: string;
    onRetry: () => void;
}) {
    const retryable =
        code !== 'BLUEPRINT_RUN_PROTOCOL_INCOMPATIBLE' &&
        code !== 'BLUEPRINT_PROGRESS_BACKEND_INCOMPATIBLE' &&
        code !== 'BLUEPRINT_PROGRESS_TRANSPORT_UNAVAILABLE' &&
        code !== 'BLUEPRINT_LOAD_BACKEND_INCOMPATIBLE';

    return (
        <DashboardStatus
            tone='warning'
            actions={
                retryable ? (
                    <button
                        type='button'
                        onClick={onRetry}
                        disabled={retrying}
                        aria-busy={retrying || undefined}
                        aria-live='polite'
                        className={`${dashboardSecondaryActionClassName} min-h-8 text-xs`}>
                        {retrying ? 'Retrying…' : retryLabel}
                    </button>
                ) : undefined
            }>
            <div>
                <p className='text-xs'>{message}</p>
                <details className='mt-1 text-[11px] text-[var(--dash-text-subtle)]'>
                    <summary className='cursor-pointer rounded-sm focus-visible:shadow-[var(--dash-shadow-focus)] focus-visible:outline-none'>
                        Technical details
                    </summary>
                    <code className='mt-1 block'>{code}</code>
                </details>
            </div>
        </DashboardStatus>
    );
}

export function formatDashboardBlueprintRunIssue(code: string): string {
    if (code === 'BLUEPRINT_RUN_PROTOCOL_INCOMPATIBLE') {
        return 'This deployment was created by a different Blueprint protocol. Its last confirmed state remains visible, but this build will not resume or control it.';
    }
    if (code === 'BLUEPRINT_PROGRESS_BACKEND_INCOMPATIBLE') {
        return 'Deployment progress is unavailable because the Convex backend does not match this NeonFlux build. Deploy the matching backend before continuing.';
    }
    if (code === 'BLUEPRINT_PROGRESS_TRANSPORT_UNAVAILABLE') {
        return 'Deployment progress is unavailable because the web client has no Convex URL. Configure VITE_CONVEX_URL and restart the web server. The queued deployment continues independently.';
    }
    return 'Deployment progress could not refresh. The last confirmed state remains visible.';
}

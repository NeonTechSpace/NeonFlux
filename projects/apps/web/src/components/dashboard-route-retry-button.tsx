import { useRouter } from '@tanstack/react-router';
import { useState } from 'react';

import { dashboardPrimaryActionClassName } from './dashboard-ui.js';

export function DashboardRouteRetryButton({
    label,
    onRetry,
}: {
    label: string;
    onRetry?: () => Promise<unknown> | void;
}) {
    const router = useRouter();
    const [isRetrying, setIsRetrying] = useState(false);

    const retry = onRetry ?? (() => router.invalidate());

    return (
        <button
            type='button'
            disabled={isRetrying}
            className={`${dashboardPrimaryActionClassName} inline-flex items-center disabled:cursor-wait disabled:opacity-70`}
            onClick={() => {
                setIsRetrying(true);

                try {
                    void Promise.resolve(retry())
                        .catch(() => undefined)
                        .finally(() => setIsRetrying(false));
                } catch {
                    setIsRetrying(false);
                }
            }}>
            {isRetrying ? 'Retrying...' : label}
        </button>
    );
}

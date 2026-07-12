import { useRouter } from '@tanstack/react-router';
import { useState } from 'react';

import { dashboardPrimaryActionClassName } from './dashboard-ui.js';

export function DashboardRouteRetryButton({ label }: { label: string }) {
    const router = useRouter();
    const [isRetrying, setIsRetrying] = useState(false);

    return (
        <button
            type='button'
            disabled={isRetrying}
            className={`${dashboardPrimaryActionClassName} inline-flex items-center disabled:cursor-wait disabled:opacity-70`}
            onClick={() => {
                setIsRetrying(true);
                void router.invalidate().finally(() => setIsRetrying(false));
            }}>
            {isRetrying ? 'Retrying...' : label}
        </button>
    );
}

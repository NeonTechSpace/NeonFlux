import { useSyncExternalStore } from 'react';
import type { ReactNode } from 'react';

let pageEligibleForLiveTransport = true;

export function isDashboardLiveTransportActive(): boolean {
    if (typeof document === 'undefined') {
        return false;
    }

    if (!pageEligibleForLiveTransport) {
        return false;
    }

    if (document.visibilityState !== 'visible') {
        return false;
    }

    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        return false;
    }

    return true;
}

export function subscribeDashboardLiveTransportActivity(onChange: () => void): () => void {
    if (typeof document === 'undefined' || typeof window === 'undefined') {
        return () => undefined;
    }

    if (document.visibilityState === 'visible') {
        pageEligibleForLiveTransport = true;
    }

    function handlePageShow(): void {
        pageEligibleForLiveTransport = true;
        onChange();
    }

    function handlePageHide(): void {
        pageEligibleForLiveTransport = false;
        onChange();
    }

    document.addEventListener('visibilitychange', onChange);
    window.addEventListener('online', onChange);
    window.addEventListener('offline', onChange);
    window.addEventListener('pageshow', handlePageShow);
    window.addEventListener('pagehide', handlePageHide);

    return () => {
        document.removeEventListener('visibilitychange', onChange);
        window.removeEventListener('online', onChange);
        window.removeEventListener('offline', onChange);
        window.removeEventListener('pageshow', handlePageShow);
        window.removeEventListener('pagehide', handlePageHide);
    };
}

export function useDashboardLiveTransportActive(): boolean {
    return useSyncExternalStore(subscribeDashboardLiveTransportActivity, isDashboardLiveTransportActive, () => false);
}

export function DashboardConvexLiveGate({ children }: { children: ReactNode }) {
    return useDashboardLiveTransportActive() ? children : null;
}

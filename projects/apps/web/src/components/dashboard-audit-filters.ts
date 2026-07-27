import { useEffect, useRef, useState } from 'react';

import type { DashboardAuditSearchScope } from '../server/dashboard-audit-events-model.js';

export const dashboardAuditSearchScopes = [
    { value: 'all', label: 'All fields', placeholder: 'Feature, action, actor, channel, message...' },
    { value: 'event', label: 'Event type', placeholder: 'posting, message.sent, settings...' },
    { value: 'actor', label: 'Actor', placeholder: 'Actor username or ID...' },
    { value: 'channel', label: 'Channel', placeholder: 'Channel name or ID...' },
    { value: 'message', label: 'Message', placeholder: 'Message ID...' },
    { value: 'time', label: 'Time', placeholder: 'Date or UTC timestamp...' },
    { value: 'metadata', label: 'Metadata', placeholder: 'dashboard, embed count, content length...' },
] as const satisfies ReadonlyArray<{
    value: DashboardAuditSearchScope;
    label: string;
    placeholder: string;
}>;

export function useDashboardAuditUrlFilters() {
    const [search, setSearch] = useState('');
    const [searchScope, setSearchScope] = useState<DashboardAuditSearchScope>('all');
    const skipNextUrlWriteRef = useRef(true);

    useEffect(() => {
        function readFiltersFromUrl(): void {
            const filters = getAuditUrlFilters();
            const url = new URL(window.location.href);
            const requestedScope = url.searchParams.get('scope');

            skipNextUrlWriteRef.current = true;
            setSearch(filters.search);
            setSearchScope(filters.searchScope);

            if (requestedScope && !isAuditSearchScope(requestedScope)) {
                url.searchParams.delete('scope');
                window.history.replaceState(window.history.state, '', url);
            }
        }

        readFiltersFromUrl();
        window.addEventListener('popstate', readFiltersFromUrl);

        return () => window.removeEventListener('popstate', readFiltersFromUrl);
    }, []);

    useEffect(() => {
        if (skipNextUrlWriteRef.current) {
            skipNextUrlWriteRef.current = false;
            return;
        }

        const url = new URL(window.location.href);

        if (search.trim()) {
            url.searchParams.set('q', search.trim());
        } else {
            url.searchParams.delete('q');
        }

        if (searchScope === 'all') {
            url.searchParams.delete('scope');
        } else {
            url.searchParams.set('scope', searchScope);
        }

        window.history.replaceState(window.history.state, '', url);
    }, [search, searchScope]);

    return {
        search,
        setSearch,
        searchScope,
        setSearchScope,
        clearFilters: () => {
            setSearch('');
            setSearchScope('all');
        },
    };
}

export function formatDashboardAuditSearchScope(scope: DashboardAuditSearchScope): string {
    return dashboardAuditSearchScopes.find((option) => option.value === scope)?.label.toLowerCase() ?? 'all fields';
}

function getAuditUrlFilters(): { search: string; searchScope: DashboardAuditSearchScope } {
    if (typeof window === 'undefined') {
        return { search: '', searchScope: 'all' };
    }

    const searchParams = new URL(window.location.href).searchParams;
    const scope = searchParams.get('scope');

    return {
        search: searchParams.get('q') ?? '',
        searchScope: isAuditSearchScope(scope) ? scope : 'all',
    };
}

function isAuditSearchScope(value: string | null): value is DashboardAuditSearchScope {
    return dashboardAuditSearchScopes.some((scope) => scope.value === value);
}

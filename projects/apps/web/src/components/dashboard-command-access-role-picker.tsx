import type {
    DashboardCommandAccessRole,
    DashboardCommandAccessRoleReadStatus,
} from '../server/dashboard-command-access.server.js';

export function CommandAccessRolePicker({
    roles,
    roleReadStatus,
    selectedRoles,
    matchedRoles,
    search,
    onSearchChange,
    onAddRole,
    onRemoveRole,
}: {
    roles: DashboardCommandAccessRole[];
    roleReadStatus: DashboardCommandAccessRoleReadStatus;
    selectedRoles: DashboardCommandAccessRole[];
    matchedRoles: DashboardCommandAccessRole[];
    search: string;
    onSearchChange: (search: string) => void;
    onAddRole: (roleId: string) => void;
    onRemoveRole: (roleId: string) => void;
}) {
    return (
        <div className='mt-4'>
            <label className='block space-y-2 text-sm font-medium text-[var(--dash-text)]'>
                <span>Roles</span>
                <input
                    value={search}
                    onChange={(event) => onSearchChange(event.currentTarget.value)}
                    className='min-h-11 w-full rounded-[var(--dash-radius-control)] border border-[var(--dash-border)] bg-[var(--dash-surface-muted)] px-3 text-[0.95rem] text-[var(--dash-text)] outline-none placeholder:text-[var(--dash-text-subtle)] focus:border-[var(--dash-primary)] focus:ring-2 focus:ring-[var(--dash-primary-ring)]'
                    autoComplete='off'
                    placeholder='Search roles'
                    disabled={roles.length === 0}
                />
            </label>
            {roleReadStatus === 'bot-token-missing' ? (
                <p className='mt-2 text-xs leading-5 text-rose-200'>Set FLUXER_BOT_TOKEN for role names.</p>
            ) : null}
            {roleReadStatus === 'fetch-failed' ? (
                <p className='mt-2 text-xs leading-5 text-rose-200'>Could not read server roles.</p>
            ) : null}
            {search && matchedRoles.length > 0 ? (
                <ul className='mt-2 max-h-52 overflow-y-auto rounded-[var(--dash-radius-control)] border border-[var(--dash-border)] bg-[var(--dash-surface-muted)] p-1'>
                    {matchedRoles.map((role) => (
                        <li key={role.id}>
                            <button
                                type='button'
                                onClick={() => onAddRole(role.id)}
                                className='flex min-h-11 w-full items-center justify-between gap-3 rounded-[var(--dash-radius-control)] px-3 text-left text-[0.92rem] text-[var(--dash-text)] transition hover:bg-[var(--dash-surface-raised)] focus:bg-[var(--dash-surface-raised)] focus:outline-none'>
                                <span className='min-w-0 truncate'>{role.name}</span>
                                <span className='shrink-0 font-mono text-xs text-[var(--dash-text-muted)]'>
                                    {role.id}
                                </span>
                            </button>
                        </li>
                    ))}
                </ul>
            ) : null}
            {selectedRoles.length > 0 ? (
                <div className='mt-3 flex flex-wrap gap-2'>
                    {selectedRoles.map((role) => (
                        <button
                            key={role.id}
                            type='button'
                            onClick={() => onRemoveRole(role.id)}
                            className='min-h-8 rounded-[var(--dash-radius-control)] border border-[var(--dash-border)] bg-[var(--dash-primary-soft)] px-2 text-xs font-semibold text-[var(--dash-text)] transition hover:border-rose-300 hover:bg-[var(--dash-danger-soft)] hover:text-rose-100'>
                            @{role.name}
                        </button>
                    ))}
                </div>
            ) : null}
        </div>
    );
}

export function matchCommandAccessRoles(
    roles: DashboardCommandAccessRole[],
    query: string
): DashboardCommandAccessRole[] {
    const normalizedQuery = normalizeSearchText(query);

    if (!normalizedQuery) return [];

    return roles
        .map((role, index) => ({
            role,
            index,
            score: scoreRoleMatch(role, normalizedQuery),
        }))
        .filter((match): match is { role: DashboardCommandAccessRole; index: number; score: number } => match.score > 0)
        .sort((left, right) => right.score - left.score || left.index - right.index)
        .map((match) => match.role);
}

function scoreRoleMatch(role: DashboardCommandAccessRole, query: string): number {
    const tokens = query.split(/\s+/).filter(Boolean);
    const searchableValues = [role.name, role.id].map(normalizeSearchText);
    let score = 0;

    for (const token of tokens) {
        const tokenScore = Math.max(...searchableValues.map((value) => scoreToken(token, value)));

        if (tokenScore === 0) return 0;

        score += tokenScore;
    }

    return score;
}

function scoreToken(token: string, value: string): number {
    if (value === token) return 100;
    if (value.startsWith(token)) return 80;
    if (value.includes(token)) return 60;

    return isSubsequence(token, value) ? 30 : 0;
}

function isSubsequence(needle: string, haystack: string): boolean {
    let needleIndex = 0;

    for (const character of haystack) {
        if (character === needle[needleIndex]) {
            needleIndex += 1;
        }

        if (needleIndex === needle.length) {
            return true;
        }
    }

    return false;
}

function normalizeSearchText(value: string): string {
    return value
        .trim()
        .toLowerCase()
        .replace(/^@/, '')
        .replace(/[^a-z0-9]+/g, ' ');
}

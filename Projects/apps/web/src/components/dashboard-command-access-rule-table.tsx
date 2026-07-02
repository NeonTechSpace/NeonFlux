import { flexRender, getCoreRowModel, useReactTable } from '@tanstack/react-table';
import type { ColumnDef } from '@tanstack/react-table';
import { Trash2 } from 'lucide-react';
import { useMemo } from 'react';

import type {
    DashboardCommandAccessCatalog,
    DashboardCommandAccessRole,
    DashboardCommandAccessRule,
} from '../server/dashboard-command-access.server.js';

export function CommandAccessRuleTable({
    catalog,
    roles,
    rules,
    busyTargetKey,
    onDelete,
}: {
    catalog: DashboardCommandAccessCatalog;
    roles: DashboardCommandAccessRole[];
    rules: DashboardCommandAccessRule[];
    busyTargetKey: string | undefined;
    onDelete: (rule: DashboardCommandAccessRule) => void;
}) {
    const rolesById = useMemo(() => new Map(roles.map((role) => [role.id, role])), [roles]);
    const targetLabels = useMemo(() => createTargetLabels(catalog), [catalog]);
    const columns = useMemo(
        () => createCommandAccessColumns({ rolesById, targetLabels, busyTargetKey, onDelete }),
        [busyTargetKey, onDelete, rolesById, targetLabels]
    );
    // eslint-disable-next-line react-hooks/incompatible-library -- TanStack Table owns table internals locally here.
    const table = useReactTable({
        data: rules,
        columns,
        getCoreRowModel: getCoreRowModel(),
    });

    return (
        <section
            className='overflow-hidden rounded-[var(--dash-radius-panel)] border border-[var(--dash-border)] bg-[rgba(13,16,22,0.72)]'
            aria-labelledby='current-command-grants-heading'>
            <div className='flex flex-wrap items-center justify-between gap-3 border-b border-[var(--dash-border)] px-4 py-3'>
                <div>
                    <h4 id='current-command-grants-heading' className='text-base font-semibold text-[var(--dash-text)]'>
                        Current grants
                    </h4>
                    <p className='mt-1 text-sm text-[var(--dash-text-muted)]'>
                        Updates apply immediately and revalidate with the server.
                    </p>
                </div>
            </div>
            {rules.length === 0 ? (
                <div className='px-4 py-8'>
                    <h5 className='text-base font-semibold text-[var(--dash-text)]'>No command grants yet</h5>
                    <p className='mt-2 max-w-2xl text-sm leading-6 text-[var(--dash-text-muted)]'>
                        Pick a guarded category or command, then add roles.
                    </p>
                </div>
            ) : (
                <div className='overflow-x-auto'>
                    <table className='w-full min-w-[44rem] text-left text-sm'>
                        <thead className='border-b border-[var(--dash-border)] text-xs text-[var(--dash-text-subtle)] uppercase'>
                            {table.getHeaderGroups().map((headerGroup) => (
                                <tr key={headerGroup.id}>
                                    {headerGroup.headers.map((header) => (
                                        <th key={header.id} className='px-4 py-3 font-semibold'>
                                            {header.isPlaceholder
                                                ? null
                                                : flexRender(header.column.columnDef.header, header.getContext())}
                                        </th>
                                    ))}
                                </tr>
                            ))}
                        </thead>
                        <tbody className='divide-y divide-[var(--dash-border)]'>
                            {table.getRowModel().rows.map((row) => (
                                <tr key={row.id} className='transition hover:bg-[var(--dash-surface-raised)]'>
                                    {row.getVisibleCells().map((cell) => (
                                        <td key={cell.id} className='px-4 py-3 align-top text-[var(--dash-text-muted)]'>
                                            {flexRender(cell.column.columnDef.cell, cell.getContext())}
                                        </td>
                                    ))}
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </section>
    );
}

function createCommandAccessColumns(input: {
    rolesById: Map<string, DashboardCommandAccessRole>;
    targetLabels: Map<string, string>;
    busyTargetKey: string | undefined;
    onDelete: (rule: DashboardCommandAccessRule) => void;
}): ColumnDef<DashboardCommandAccessRule>[] {
    return [
        {
            id: 'target',
            header: 'Target',
            cell: ({ row }) => {
                const rule = row.original;
                const targetKey = getRuleKey(rule.targetType, rule.targetId);

                return (
                    <div>
                        <p className='font-medium text-[var(--dash-text)]'>
                            {input.targetLabels.get(targetKey) ?? rule.targetId}
                        </p>
                        <p className='mt-1 font-mono text-xs text-[var(--dash-text-subtle)]'>
                            {rule.targetType}:{rule.targetId}
                        </p>
                    </div>
                );
            },
        },
        {
            id: 'roles',
            header: 'Allowed roles',
            cell: ({ row }) =>
                row.original.roleIds.length > 0 ? (
                    <ul className='space-y-1'>
                        {row.original.roleIds.map((roleId) => (
                            <li key={roleId}>
                                <span className='text-[var(--dash-text)]'>
                                    {input.rolesById.get(roleId)?.name ?? roleId}
                                </span>
                                <span className='ml-2 font-mono text-xs text-[var(--dash-text-subtle)]'>{roleId}</span>
                            </li>
                        ))}
                    </ul>
                ) : (
                    <span className='text-[var(--dash-text-subtle)]'>None</span>
                ),
        },
        {
            id: 'users',
            header: 'Allowed users',
            cell: ({ row }) =>
                row.original.userIds.length > 0 ? (
                    <ul className='space-y-1 font-mono text-xs text-[var(--dash-text)]'>
                        {row.original.userIds.map((userId) => (
                            <li key={userId}>{userId}</li>
                        ))}
                    </ul>
                ) : (
                    <span className='text-[var(--dash-text-subtle)]'>None</span>
                ),
        },
        {
            id: 'actions',
            header: 'Actions',
            cell: ({ row }) => {
                const rule = row.original;
                const targetKey = getRuleKey(rule.targetType, rule.targetId);

                return (
                    <button
                        type='button'
                        onClick={() => input.onDelete(rule)}
                        disabled={input.busyTargetKey === targetKey}
                        className='inline-flex min-h-9 items-center gap-2 rounded-[var(--dash-radius-control)] border border-[var(--dash-border)] px-3 text-sm font-semibold text-[var(--dash-text)] transition hover:border-[var(--dash-danger)] hover:text-rose-200 disabled:cursor-not-allowed disabled:text-[var(--dash-text-disabled)]'>
                        <Trash2 className='size-4' aria-hidden='true' />
                        Remove
                    </button>
                );
            },
        },
    ];
}

function createTargetLabels(catalog: DashboardCommandAccessCatalog): Map<string, string> {
    return new Map([
        ...catalog.categories.map((category) => [getRuleKey('category', category.id), category.title] as const),
        ...catalog.commands.map(
            (command) =>
                [getRuleKey('command', command.id), `${command.categoryTitle}: ${command.commandName}`] as const
        ),
    ]);
}

function getRuleKey(targetType: DashboardCommandAccessRule['targetType'], targetId: string): string {
    return `${targetType}:${targetId}`;
}

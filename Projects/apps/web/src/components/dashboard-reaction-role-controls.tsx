import { closestCenter, DndContext, KeyboardSensor, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import type { DragEndEvent } from '@dnd-kit/core';
import {
    SortableContext,
    sortableKeyboardCoordinates,
    useSortable,
    verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useMemo, useState } from 'react';

import type {
    DashboardReactionRoleEmoji,
    DashboardReactionRoleRole,
} from '../server/dashboard-reaction-roles.server.js';

export type ReactionRoleBuilderOption = {
    emojiKey: string;
    emojiLabel: string;
    roleId: string;
};

export function ReactionRoleOptionList({
    options,
    roles,
    onRemove,
    onReorder,
}: {
    options: ReactionRoleBuilderOption[];
    roles: DashboardReactionRoleRole[];
    onRemove: (index: number) => void;
    onReorder?: (fromIndex: number, toIndex: number) => void;
}) {
    const roleById = new Map(roles.map((role) => [role.id, role]));
    const sensors = useSensors(
        useSensor(PointerSensor),
        useSensor(KeyboardSensor, {
            coordinateGetter: sortableKeyboardCoordinates,
        })
    );

    function handleDragEnd(event: DragEndEvent): void {
        if (!event.over || event.active.id === event.over.id) return;

        const fromIndex = options.findIndex((option) => option.emojiKey === event.active.id);
        const toIndex = options.findIndex((option) => option.emojiKey === event.over?.id);

        if (fromIndex >= 0 && toIndex >= 0) {
            onReorder?.(fromIndex, toIndex);
        }
    }

    return (
        <div className='mt-3'>
            {options.length === 0 ? (
                <p className='text-sm text-neutral-500'>No options yet. Add up to 30.</p>
            ) : (
                <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                    <SortableContext
                        items={options.map((option) => option.emojiKey)}
                        strategy={verticalListSortingStrategy}>
                        <div className='space-y-2'>
                            {options.map((option, index) => (
                                <SortableReactionRoleOption
                                    key={option.emojiKey}
                                    option={option}
                                    role={roleById.get(option.roleId)}
                                    onRemove={() => onRemove(index)}
                                />
                            ))}
                        </div>
                    </SortableContext>
                </DndContext>
            )}
        </div>
    );
}

function SortableReactionRoleOption({
    option,
    role,
    onRemove,
}: {
    option: ReactionRoleBuilderOption;
    role?: DashboardReactionRoleRole;
    onRemove: () => void;
}) {
    const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
        id: option.emojiKey,
    });

    return (
        <div
            ref={setNodeRef}
            style={{
                transform: CSS.Transform.toString(transform),
                transition,
            }}
            className={
                isDragging
                    ? 'flex items-center gap-3 rounded-md border border-sky-400 bg-neutral-900 px-3 py-2 text-sm text-neutral-100 shadow-lg shadow-sky-950/40'
                    : 'flex items-center gap-3 rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-100'
            }>
            <button
                type='button'
                {...attributes}
                {...listeners}
                className='cursor-grab rounded border border-neutral-700 px-2 py-1 font-mono text-xs text-neutral-400 active:cursor-grabbing'
                aria-label={`Drag ${option.emojiLabel} option`}>
                ::
            </button>
            <span className='text-base'>{option.emojiLabel}</span>
            <RoleSwatch color={role?.color ?? 0} />
            <span className='min-w-0 flex-1 truncate'>@{role?.name ?? option.roleId}</span>
            <button
                type='button'
                className='text-xs font-semibold text-neutral-400 hover:text-rose-200'
                onClick={onRemove}>
                Remove
            </button>
        </div>
    );
}

export function EmojiPicker({
    emojis,
    selected,
    onSelect,
}: {
    emojis: DashboardReactionRoleEmoji[];
    selected?: DashboardReactionRoleEmoji;
    onSelect: (emoji: DashboardReactionRoleEmoji) => void;
}) {
    const [query, setQuery] = useState('');
    const matches = useMemo(() => matchEmojis(emojis, query).slice(0, 12), [emojis, query]);

    return (
        <label className='min-w-52 flex-1 space-y-2 text-sm font-medium text-neutral-200'>
            <span>Emoji</span>
            <input
                value={selected ? selected.label : query}
                onChange={(event) => setQuery(event.currentTarget.value)}
                className='min-h-10 w-full rounded-md border border-neutral-700 bg-neutral-950 px-3 text-base text-white outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-400/40'
                placeholder='Search emoji'
            />
            <div className='grid max-h-36 grid-cols-4 gap-1 overflow-y-auto rounded-md border border-neutral-800 bg-neutral-950 p-1'>
                {matches.map((emoji) => (
                    <button
                        key={emoji.key}
                        type='button'
                        onClick={() => {
                            onSelect(emoji);
                            setQuery('');
                        }}
                        className='min-h-9 rounded text-sm text-neutral-100 transition hover:bg-neutral-800'>
                        {emoji.custom ? emoji.label : emoji.key}
                    </button>
                ))}
            </div>
        </label>
    );
}

export function RolePicker({
    roles,
    selected,
    onSelect,
}: {
    roles: DashboardReactionRoleRole[];
    selected?: DashboardReactionRoleRole;
    onSelect: (role: DashboardReactionRoleRole) => void;
}) {
    const [query, setQuery] = useState('');
    const matches = useMemo(() => matchRoles(roles, query).slice(0, 8), [roles, query]);

    return (
        <label className='min-w-64 flex-1 space-y-2 text-sm font-medium text-neutral-200'>
            <span>Role</span>
            <input
                value={selected ? `@${selected.name}` : query}
                onChange={(event) => setQuery(event.currentTarget.value)}
                className='min-h-10 w-full rounded-md border border-neutral-700 bg-neutral-950 px-3 text-base text-white outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-400/40'
                placeholder='Search roles'
            />
            <div className='max-h-36 overflow-y-auto rounded-md border border-neutral-800 bg-neutral-950'>
                {matches.map((role) => (
                    <button
                        key={role.id}
                        type='button'
                        onClick={() => {
                            onSelect(role);
                            setQuery('');
                        }}
                        className='flex min-h-9 w-full items-center gap-2 px-3 text-left text-sm text-neutral-100 transition hover:bg-neutral-800'>
                        <RoleSwatch color={role.color} />
                        <span className='truncate'>@{role.name}</span>
                    </button>
                ))}
            </div>
        </label>
    );
}

export function SegmentedControl({
    label,
    value,
    options,
    onChange,
}: {
    label: string;
    value: string;
    options: Array<{ value: string; label: string }>;
    onChange: (value: string) => void;
}) {
    return (
        <fieldset className='space-y-2'>
            <legend className='text-sm font-medium text-neutral-200'>{label}</legend>
            <div className='flex flex-wrap gap-2'>
                {options.map((option) => (
                    <button
                        key={option.value}
                        type='button'
                        onClick={() => onChange(option.value)}
                        className={
                            value === option.value
                                ? 'min-h-9 rounded-md border border-sky-400 bg-sky-400/10 px-3 text-sm font-semibold text-sky-100'
                                : 'min-h-9 rounded-md border border-neutral-700 px-3 text-sm font-semibold text-neutral-200 transition hover:border-neutral-500'
                        }>
                        {option.label}
                    </button>
                ))}
            </div>
        </fieldset>
    );
}

function RoleSwatch({ color }: { color: number }) {
    return (
        <span
            className='size-3 shrink-0 rounded-full border border-white/20'
            style={{ backgroundColor: color > 0 ? `#${color.toString(16).padStart(6, '0')}` : '#737373' }}
        />
    );
}

function matchEmojis(emojis: DashboardReactionRoleEmoji[], query: string): DashboardReactionRoleEmoji[] {
    const normalizedQuery = normalizeSearchText(query);

    if (!normalizedQuery) return emojis;

    return emojis.filter((emoji) =>
        normalizeSearchText(`${emoji.name} ${emoji.label} ${emoji.key}`).includes(normalizedQuery)
    );
}

function matchRoles(roles: DashboardReactionRoleRole[], query: string): DashboardReactionRoleRole[] {
    const normalizedQuery = normalizeSearchText(query);

    if (!normalizedQuery) return roles;

    return roles.filter((role) => normalizeSearchText(`${role.name} ${role.id}`).includes(normalizedQuery));
}

function normalizeSearchText(value: string): string {
    return value
        .trim()
        .toLowerCase()
        .replace(/^[@#:]/, '')
        .replace(/[^a-z0-9]+/g, ' ');
}

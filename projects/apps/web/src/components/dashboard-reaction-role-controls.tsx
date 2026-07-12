import { closestCenter, DndContext, KeyboardSensor, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import type { DragEndEvent } from '@dnd-kit/core';
import {
    SortableContext,
    sortableKeyboardCoordinates,
    useSortable,
    verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical, X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useMemo, useState } from 'react';

import type {
    DashboardReactionRoleEmoji,
    DashboardReactionRoleRole,
} from '../server/dashboard-reaction-roles.server.js';
import {
    dashboardInlineVariants,
    dashboardListItemVariants,
    dashboardListTransition,
    dashboardSelectionTransition,
    dashboardTactile,
    dashboardViewTransition,
} from './dashboard-motion.js';

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
            <AnimatePresence initial={false} mode='popLayout'>
                {options.length === 0 ? (
                    <motion.p
                        key='empty'
                        data-dashboard-motion='view-change'
                        className='text-sm text-[var(--dash-text-muted)]'
                        variants={dashboardInlineVariants}
                        initial='initial'
                        animate='enter'
                        exit='exit'
                        transition={dashboardViewTransition}>
                        No options yet. Add up to 30.
                    </motion.p>
                ) : (
                    <motion.div
                        key='options'
                        data-dashboard-motion='view-change'
                        variants={dashboardInlineVariants}
                        initial='initial'
                        animate='enter'
                        exit='exit'
                        transition={dashboardViewTransition}>
                        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                            <SortableContext
                                items={options.map((option) => option.emojiKey)}
                                strategy={verticalListSortingStrategy}>
                                <div className='space-y-2'>
                                    {options.map((option, index) => (
                                        <motion.div
                                            key={option.emojiKey}
                                            data-dashboard-motion='list-insert'
                                            variants={dashboardListItemVariants}
                                            initial='initial'
                                            animate='enter'
                                            transition={dashboardListTransition}>
                                            <SortableReactionRoleOption
                                                option={option}
                                                role={roleById.get(option.roleId)}
                                                onRemove={() => onRemove(index)}
                                            />
                                        </motion.div>
                                    ))}
                                </div>
                            </SortableContext>
                        </DndContext>
                    </motion.div>
                )}
            </AnimatePresence>
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
                    ? 'flex items-center gap-3 rounded-[var(--dash-radius-control)] border border-[var(--dash-primary)] bg-[var(--dash-surface-raised)] px-3 py-2 text-sm text-[var(--dash-text)] shadow-[var(--dash-shadow-popover)]'
                    : 'flex items-center gap-3 rounded-[var(--dash-radius-control)] border border-[var(--dash-border)] bg-[var(--dash-surface)] px-3 py-2 text-sm text-[var(--dash-text)]'
            }>
            <motion.button
                type='button'
                {...attributes}
                {...listeners}
                {...dashboardTactile}
                className='grid size-8 cursor-grab place-items-center rounded-[var(--dash-radius-control)] border border-[var(--dash-border-interactive)] text-[var(--dash-text-muted)] active:cursor-grabbing'
                aria-label={`Drag ${option.emojiLabel} option`}>
                <GripVertical className='size-4' aria-hidden='true' />
            </motion.button>
            <span className='text-base'>{option.emojiLabel}</span>
            <RoleSwatch color={role?.color ?? 0} />
            <span className='min-w-0 flex-1 truncate'>@{role?.name ?? option.roleId}</span>
            <motion.button
                type='button'
                className='inline-flex min-h-8 items-center gap-1 rounded-[var(--dash-radius-control)] px-2 text-xs font-semibold text-[var(--dash-text-muted)] hover:bg-rose-400/10 hover:text-rose-100'
                onClick={onRemove}
                {...dashboardTactile}>
                <X className='size-3.5' aria-hidden='true' />
                Remove
            </motion.button>
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
        <label className='min-w-52 flex-1 space-y-2 text-sm font-medium text-[var(--dash-text)]'>
            <span>Emoji</span>
            <input
                value={selected ? selected.label : query}
                onChange={(event) => setQuery(event.currentTarget.value)}
                className={pickerInputClassName}
                placeholder='Search emoji'
            />
            <div className='grid max-h-36 grid-cols-4 gap-1 overflow-y-auto rounded-[var(--dash-radius-control)] border border-[var(--dash-border)] bg-[var(--dash-surface)] p-1'>
                {matches.map((emoji) => (
                    <motion.button
                        key={emoji.key}
                        type='button'
                        onClick={() => {
                            onSelect(emoji);
                            setQuery('');
                        }}
                        className='min-h-9 rounded text-sm text-[var(--dash-text)] transition hover:bg-[var(--dash-surface-selected)]'
                        {...dashboardTactile}>
                        {emoji.custom ? emoji.label : emoji.key}
                    </motion.button>
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
        <label className='min-w-64 flex-1 space-y-2 text-sm font-medium text-[var(--dash-text)]'>
            <span>Role</span>
            <input
                value={selected ? `@${selected.name}` : query}
                onChange={(event) => setQuery(event.currentTarget.value)}
                className={pickerInputClassName}
                placeholder='Search roles'
            />
            <div className='max-h-36 overflow-y-auto rounded-[var(--dash-radius-control)] border border-[var(--dash-border)] bg-[var(--dash-surface)]'>
                {matches.map((role) => (
                    <motion.button
                        key={role.id}
                        type='button'
                        onClick={() => {
                            onSelect(role);
                            setQuery('');
                        }}
                        className='flex min-h-9 w-full items-center gap-2 px-3 text-left text-sm text-[var(--dash-text)] transition hover:bg-[var(--dash-surface-selected)]'
                        {...dashboardTactile}>
                        <RoleSwatch color={role.color} />
                        <span className='truncate'>@{role.name}</span>
                    </motion.button>
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
    const selectionLayoutId = `dashboard-segmented-${label.toLowerCase().replaceAll(/[^a-z0-9]+/g, '-')}`;

    return (
        <fieldset className='space-y-2'>
            <legend className='text-sm font-medium text-[var(--dash-text)]'>{label}</legend>
            <div className='flex flex-wrap gap-2'>
                {options.map((option) => (
                    <motion.button
                        key={option.value}
                        data-dashboard-motion='selection-gel'
                        type='button'
                        aria-pressed={value === option.value}
                        onClick={() => onChange(option.value)}
                        className={
                            value === option.value
                                ? 'relative min-h-10 overflow-hidden rounded-[var(--dash-radius-control)] border border-[var(--dash-primary)] px-3 text-sm font-semibold text-[var(--dash-text)]'
                                : 'relative min-h-10 overflow-hidden rounded-[var(--dash-radius-control)] border border-[var(--dash-border-interactive)] px-3 text-sm font-semibold text-[var(--dash-text-muted)] transition hover:border-[var(--dash-primary)] hover:text-[var(--dash-text)]'
                        }
                        {...dashboardTactile}>
                        {value === option.value ? (
                            <motion.span
                                layoutId={selectionLayoutId}
                                data-dashboard-motion='selection-gel'
                                className='absolute inset-0 bg-[var(--dash-primary-ring)]'
                                transition={dashboardSelectionTransition}
                                aria-hidden='true'
                            />
                        ) : null}
                        <span className='relative'>{option.label}</span>
                    </motion.button>
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

const pickerInputClassName =
    'min-h-10 w-full rounded-[var(--dash-radius-control)] border border-[var(--dash-border)] bg-[var(--dash-bg)] px-3 text-base text-[var(--dash-text)] outline-none placeholder:text-[var(--dash-text-disabled)] focus:border-[var(--dash-primary)] focus:ring-2 focus:ring-[var(--dash-primary-ring)]';

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

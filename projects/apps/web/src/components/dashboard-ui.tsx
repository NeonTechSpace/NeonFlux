import type { ComponentPropsWithoutRef, ElementType, ReactNode } from 'react';

type DashboardPageWidth = 'focused' | 'standard' | 'wide' | 'full';
type DashboardSurfaceElement = 'article' | 'div' | 'section';
type DashboardSurfaceTone = 'default' | 'glass' | 'raised' | 'subtle';
type DashboardSurfacePadding = 'none' | 'compact' | 'normal';
export type DashboardStatusTone = 'danger' | 'info' | 'neutral' | 'success' | 'warning';

const pageWidthClassNames = {
    focused: 'max-w-3xl',
    standard: 'max-w-5xl',
    wide: 'max-w-[90rem]',
    full: 'max-w-none',
} as const satisfies Record<DashboardPageWidth, string>;

const surfaceToneClassNames = {
    default: 'dashboard-surface',
    glass: 'dashboard-glass-panel',
    raised: 'border border-[var(--dash-border-strong)] bg-[var(--dash-surface-raised)] shadow-[var(--dash-shadow-surface)]',
    subtle: 'dashboard-surface-muted',
} as const satisfies Record<DashboardSurfaceTone, string>;

const surfacePaddingClassNames = {
    none: '',
    compact: 'p-3 sm:p-4',
    normal: 'p-4 sm:p-5',
} as const satisfies Record<DashboardSurfacePadding, string>;

const statusToneClassNames = {
    neutral: 'border-[var(--dash-border)] bg-[var(--dash-surface-muted)] text-[var(--dash-text-muted)]',
    info: 'border-[color:var(--dash-info)]/35 bg-[var(--dash-info-soft)] text-[var(--dash-text)]',
    success: 'border-[color:var(--dash-success)]/35 bg-[var(--dash-success-soft)] text-[var(--dash-text)]',
    warning: 'border-[color:var(--dash-warning)]/35 bg-[var(--dash-warning-soft)] text-[var(--dash-text)]',
    danger: 'border-[color:var(--dash-danger)]/35 bg-[var(--dash-danger-soft)] text-[var(--dash-text)]',
} as const satisfies Record<DashboardStatusTone, string>;

export function DashboardPage({
    width = 'standard',
    className,
    children,
}: {
    width?: DashboardPageWidth;
    className?: string;
    children: ReactNode;
}) {
    return (
        <div className={joinClassNames('mx-auto w-full min-w-0 space-y-4', pageWidthClassNames[width], className)}>
            {children}
        </div>
    );
}

export function DashboardPageHeader({
    title,
    description,
    eyebrow,
    actions,
    titleId,
}: {
    title: string;
    description?: string;
    eyebrow?: string;
    actions?: ReactNode;
    titleId?: string;
}) {
    return (
        <header className='flex min-w-0 flex-wrap items-end justify-between gap-4 border-b border-[var(--dash-border)] pb-4'>
            <div className='min-w-0'>
                {eyebrow ? (
                    <p className='mb-1 text-xs font-semibold tracking-[0.12em] text-[var(--dash-text-subtle)] uppercase'>
                        {eyebrow}
                    </p>
                ) : null}
                <h2 id={titleId} className='text-2xl font-semibold tracking-tight text-[var(--dash-text)]'>
                    {title}
                </h2>
                {description ? (
                    <p className='mt-1 max-w-3xl text-sm leading-6 text-[var(--dash-text-muted)]'>{description}</p>
                ) : null}
            </div>
            {actions ? <div className='flex shrink-0 flex-wrap items-center gap-2'>{actions}</div> : null}
        </header>
    );
}

type DashboardSurfaceProps<TElement extends DashboardSurfaceElement> = {
    as?: TElement;
    tone?: DashboardSurfaceTone;
    padding?: DashboardSurfacePadding;
} & Omit<ComponentPropsWithoutRef<TElement>, 'as'>;

export function DashboardSurface<TElement extends DashboardSurfaceElement = 'section'>({
    as,
    tone = 'default',
    padding = 'normal',
    className,
    ...props
}: DashboardSurfaceProps<TElement>) {
    const Component = (as ?? 'section') as ElementType;

    return (
        <Component
            {...props}
            className={joinClassNames(
                'min-w-0 rounded-[var(--dash-radius-panel)]',
                surfaceToneClassNames[tone],
                surfacePaddingClassNames[padding],
                className
            )}
        />
    );
}

export function DashboardToolbar({
    children,
    summary,
    className,
}: {
    children: ReactNode;
    summary?: ReactNode;
    className?: string;
}) {
    return (
        <div
            className={joinClassNames(
                'flex min-w-0 flex-wrap items-end justify-between gap-3 border-b border-[var(--dash-border)] pb-4',
                className
            )}>
            <div className='flex min-w-0 flex-1 flex-wrap items-end gap-3'>{children}</div>
            {summary ? <div className='shrink-0 text-xs text-[var(--dash-text-subtle)]'>{summary}</div> : null}
        </div>
    );
}

export function DashboardStatus({
    tone,
    title,
    children,
    actions,
    role,
}: {
    tone: DashboardStatusTone;
    title?: string;
    children: ReactNode;
    actions?: ReactNode;
    role?: 'alert' | 'status';
}) {
    return (
        <div
            role={role ?? (tone === 'danger' ? 'alert' : 'status')}
            className={joinClassNames(
                'flex min-w-0 flex-wrap items-start justify-between gap-3 rounded-[var(--dash-radius-control)] border px-3 py-2.5 text-sm',
                statusToneClassNames[tone]
            )}>
            <div className='min-w-0'>
                {title ? <p className='font-semibold text-[var(--dash-text)]'>{title}</p> : null}
                <div className={title ? 'mt-0.5 leading-5' : 'leading-5'}>{children}</div>
            </div>
            {actions ? <div className='flex shrink-0 flex-wrap items-center gap-2'>{actions}</div> : null}
        </div>
    );
}

export function DashboardEmptyState({
    title,
    description,
    action,
}: {
    title: string;
    description: string;
    action?: ReactNode;
}) {
    return (
        <div className='grid h-full min-h-40 place-items-center px-4 py-8 text-center'>
            <div className='max-w-md'>
                <h3 className='text-base font-semibold text-[var(--dash-text)]'>{title}</h3>
                <p className='mt-1 text-sm leading-6 text-[var(--dash-text-muted)]'>{description}</p>
                {action ? <div className='mt-4 flex justify-center'>{action}</div> : null}
            </div>
        </div>
    );
}

export function DashboardErrorState({
    title = 'Something went wrong',
    description,
    action,
}: {
    title?: string;
    description: string;
    action?: ReactNode;
}) {
    return (
        <DashboardStatus tone='danger' title={title} actions={action} role='alert'>
            {description}
        </DashboardStatus>
    );
}

function joinClassNames(...classNames: Array<string | undefined>): string {
    return classNames.filter(Boolean).join(' ');
}

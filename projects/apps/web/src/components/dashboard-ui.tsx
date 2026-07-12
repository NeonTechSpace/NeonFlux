import type { ComponentPropsWithoutRef, ElementType, ReactNode } from 'react';

export type DashboardPageWidth = 'focused' | 'standard' | 'wide' | 'full';
type DashboardSurfaceElement = 'article' | 'div' | 'section';
type DashboardSurfaceTone = 'default' | 'glass' | 'raised' | 'subtle';
type DashboardSurfacePadding = 'none' | 'compact' | 'normal';
export type DashboardStatusTone = 'danger' | 'info' | 'neutral' | 'success' | 'warning';

const featureBodyWidthClassNames = {
    focused: 'max-w-3xl',
    standard: 'max-w-5xl',
    wide: 'max-w-[90rem]',
    full: 'max-w-none',
} as const satisfies Record<DashboardPageWidth, string>;

const surfaceToneClassNames = {
    default:
        'border border-[var(--dash-border)] bg-[linear-gradient(145deg,rgba(14,25,41,0.98),rgba(18,18,34,0.97))] shadow-[var(--dash-shadow-surface)]',
    glass: 'dashboard-glass-panel',
    raised: 'border border-[var(--dash-border-strong)] bg-[var(--dash-surface-raised)] shadow-[var(--dash-shadow-surface)]',
    subtle: 'border border-[var(--dash-border)] bg-[linear-gradient(145deg,rgba(11,21,35,0.98),rgba(15,16,30,0.97))] shadow-[var(--dash-shadow-surface)]',
} as const satisfies Record<DashboardSurfaceTone, string>;

export const dashboardPrimaryActionClassName =
    'min-h-10 rounded-[var(--dash-radius-control)] border border-transparent bg-[var(--dash-primary)] px-4 text-[0.9rem] font-bold text-[#061017] transition-[background-color,box-shadow,transform,opacity] duration-[140ms] hover:bg-[var(--dash-primary-strong)] hover:shadow-[0_8px_24px_rgba(90,215,255,0.16)] active:translate-y-px focus-visible:shadow-[var(--dash-shadow-focus)] focus-visible:outline-none disabled:pointer-events-none disabled:opacity-[0.45] motion-reduce:transform-none [.dashboard-theme[data-reduce-effects=true]_&]:transform-none';
export const dashboardSecondaryActionClassName =
    'min-h-9 rounded-[var(--dash-radius-control)] border border-[var(--dash-border)] px-3 text-[0.88rem] font-[650] text-[var(--dash-text)] transition-[border-color,background-color,color,box-shadow,opacity] duration-[140ms] hover:border-[var(--dash-primary)] hover:bg-[var(--dash-primary-soft)] focus-visible:border-[var(--dash-primary)] focus-visible:shadow-[var(--dash-shadow-focus)] focus-visible:outline-none disabled:pointer-events-none disabled:text-[var(--dash-text-disabled)] disabled:opacity-[0.55]';
export const dashboardDangerActionClassName =
    'min-h-9 rounded-[var(--dash-radius-control)] border border-[color:var(--dash-danger)]/55 px-3 text-[0.88rem] font-[650] text-[var(--dash-text)] transition-[border-color,background-color,color,box-shadow,opacity] duration-[140ms] hover:border-[var(--dash-danger)] hover:bg-[var(--dash-danger-soft)] hover:text-[#ffe4e9] focus-visible:border-[var(--dash-danger)] focus-visible:shadow-[0_0_0_1px_rgba(255,113,138,0.42),0_0_0_4px_rgba(255,113,138,0.12)] focus-visible:outline-none disabled:pointer-events-none disabled:text-[var(--dash-text-disabled)] disabled:opacity-[0.55]';
export const dashboardQuietActionClassName =
    'min-h-9 rounded-[var(--dash-radius-control)] border border-transparent px-3 text-[0.88rem] font-[650] text-[var(--dash-text-muted)] transition-[border-color,background-color,color,box-shadow,opacity] duration-[140ms] hover:border-[var(--dash-border)] hover:bg-[var(--dash-surface-raised)] hover:text-[var(--dash-text)] focus-visible:border-[var(--dash-primary)] focus-visible:shadow-[var(--dash-shadow-focus)] focus-visible:outline-none disabled:pointer-events-none disabled:text-[var(--dash-text-disabled)] disabled:opacity-[0.55]';
export const dashboardIconActionClassName =
    'grid size-11 shrink-0 place-items-center rounded-[var(--dash-radius-control)] border border-transparent text-[var(--dash-text-muted)] transition-[border-color,background-color,color,box-shadow,opacity] duration-[140ms] hover:border-[var(--dash-border)] hover:bg-[var(--dash-surface-raised)] hover:text-[var(--dash-text)] focus-visible:border-[var(--dash-primary)] focus-visible:shadow-[var(--dash-shadow-focus)] focus-visible:outline-none disabled:pointer-events-none disabled:text-[var(--dash-text-disabled)] disabled:opacity-[0.55]';
export const dashboardFieldClassName =
    'min-h-11 w-full rounded-[var(--dash-radius-control)] border border-[var(--dash-border)] bg-[var(--dash-surface-muted)] px-3 text-sm text-[var(--dash-text)] outline-none transition-[border-color,background-color,box-shadow,opacity] duration-[140ms] placeholder:text-[var(--dash-text-subtle)] focus:border-[var(--dash-primary)] focus:shadow-[var(--dash-shadow-focus)] disabled:cursor-not-allowed disabled:text-[var(--dash-text-disabled)] disabled:opacity-[0.65]';
export const dashboardCompactFieldClassName =
    'h-9 w-full rounded-[var(--dash-radius-control)] border border-[var(--dash-border)] bg-[var(--dash-surface-muted)] px-2.5 text-sm text-[var(--dash-text)] outline-none transition-[border-color,background-color,box-shadow,opacity] duration-[140ms] placeholder:text-[var(--dash-text-subtle)] focus:border-[var(--dash-primary)] focus:shadow-[var(--dash-shadow-focus)] disabled:cursor-not-allowed disabled:text-[var(--dash-text-disabled)] disabled:opacity-[0.65]';

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

export function DashboardFeaturePage({
    title,
    description,
    eyebrow,
    icon,
    actions,
    navigation,
    status,
    titleId,
    width = 'standard',
    children,
}: {
    title: string;
    description?: string;
    eyebrow?: string;
    icon?: ReactNode;
    actions?: ReactNode;
    navigation?: ReactNode;
    status?: ReactNode;
    titleId?: string;
    width?: DashboardPageWidth;
    children: ReactNode;
}) {
    return (
        <section className='min-h-full min-w-0 px-4 pt-1 pb-8 sm:px-6 lg:px-8' aria-labelledby={titleId}>
            <div className='mx-auto w-full max-w-[100rem] min-w-0'>
                <DashboardPageHeader
                    title={title}
                    description={description}
                    eyebrow={eyebrow}
                    icon={icon}
                    actions={actions}
                    titleId={titleId}
                />
                {navigation}
                {status ? <div className='border-b border-[var(--dash-border)]'>{status}</div> : null}
                <div className={joinClassNames('min-w-0 pt-5 sm:pt-6', featureBodyWidthClassNames[width])}>
                    {children}
                </div>
            </div>
        </section>
    );
}

function DashboardPageHeader({
    title,
    description,
    eyebrow,
    icon,
    actions,
    titleId,
}: {
    title: string;
    description?: string;
    eyebrow?: string;
    icon?: ReactNode;
    actions?: ReactNode;
    titleId?: string;
}) {
    return (
        <header className='flex min-w-0 flex-wrap items-start justify-between gap-4 border-b border-[var(--dash-border)] py-4 sm:py-5'>
            <div className='flex min-w-0 flex-1 items-start gap-3'>
                {icon ? (
                    <div className='dashboard-glass-panel grid size-11 shrink-0 place-items-center text-[var(--dash-primary)]'>
                        <span className='relative'>{icon}</span>
                    </div>
                ) : null}
                <div className='min-w-0'>
                    {eyebrow ? (
                        <p className='mb-1 text-xs font-semibold tracking-[0.12em] text-[var(--dash-text-subtle)] uppercase'>
                            {eyebrow}
                        </p>
                    ) : null}
                    <h1 id={titleId} className='text-2xl font-semibold tracking-tight text-[var(--dash-text)]'>
                        {title}
                    </h1>
                    {description ? (
                        <p className='mt-1 max-w-3xl text-sm leading-6 text-[var(--dash-text-muted)]'>{description}</p>
                    ) : null}
                </div>
            </div>
            {actions ? (
                <div className='flex w-full flex-wrap items-center gap-2 sm:w-auto sm:shrink-0'>{actions}</div>
            ) : null}
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
    size = 'default',
}: {
    title: string;
    description: string;
    action?: ReactNode;
    size?: 'compact' | 'default';
}) {
    return (
        <div
            className={joinClassNames(
                'grid h-full place-items-center px-4 text-center',
                size === 'compact' ? 'py-5' : 'min-h-40 py-8'
            )}>
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

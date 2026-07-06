export function DashboardFeaturePlaceholder({ featureName }: { featureName: string }) {
    return (
        <article className='dashboard-glass-panel min-h-48 p-6'>
            <p className='text-sm font-semibold tracking-wide text-[var(--dash-primary)] uppercase'>{featureName}</p>
            <h3 className='mt-3 text-xl font-semibold text-[var(--dash-text)]'>Feature not yet implemented</h3>
        </article>
    );
}

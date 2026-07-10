import { Component, useState } from 'react';
import type { ErrorInfo, ReactNode } from 'react';

type BoundaryProps = {
    children: ReactNode;
    onRetry: () => void;
};

type BoundaryState = { failed: boolean };

class DashboardStructureRenderBoundary extends Component<BoundaryProps, BoundaryState> {
    state: BoundaryState = { failed: false };

    static getDerivedStateFromError(): BoundaryState {
        return { failed: true };
    }

    componentDidCatch(_error: Error, _info: ErrorInfo): void {
        // The fallback intentionally avoids rendering exception details that may contain request data.
    }

    render(): ReactNode {
        if (!this.state.failed) return this.props.children;

        return (
            <DashboardStructureErrorState
                title='Server Blueprint stopped rendering'
                message='The dashboard hit an unexpected display error. No deployment action is started by retrying.'
                diagnosticCode='BLUEPRINT_RENDER_FAILED'
                onRetry={this.props.onRetry}
            />
        );
    }
}

export function DashboardStructureErrorBoundary({ children, onRetry }: BoundaryProps) {
    const [attempt, setAttempt] = useState(0);

    return (
        <DashboardStructureRenderBoundary
            key={attempt}
            onRetry={() => {
                setAttempt((current) => current + 1);
                onRetry();
            }}>
            {children}
        </DashboardStructureRenderBoundary>
    );
}

export function DashboardStructureErrorState({
    title,
    message,
    diagnosticCode,
    onRetry,
    retryDisabled = false,
}: {
    title: string;
    message: string;
    diagnosticCode: string;
    onRetry: () => void;
    retryDisabled?: boolean;
}) {
    return (
        <article className='rounded-lg border border-rose-400/30 bg-rose-950/20 p-5' role='alert'>
            <h3 className='text-lg font-semibold text-rose-100'>{title}</h3>
            <p className='mt-2 text-sm leading-6 text-neutral-300'>{message}</p>
            <p className='mt-2 font-mono text-xs text-neutral-500'>Diagnostic: {diagnosticCode}</p>
            <button
                type='button'
                onClick={onRetry}
                disabled={retryDisabled}
                className='mt-4 min-h-10 rounded-md border border-rose-300/50 px-4 text-sm font-semibold text-rose-100 transition hover:border-rose-200 disabled:cursor-wait disabled:opacity-50'>
                {retryDisabled ? 'Waiting for current read' : 'Retry Blueprint'}
            </button>
        </article>
    );
}

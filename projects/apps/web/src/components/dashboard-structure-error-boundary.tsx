import { Component, useState } from 'react';
import type { ErrorInfo, ReactNode } from 'react';

import { dashboardDangerActionClassName, DashboardStatus } from './dashboard-ui.js';

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
    retrying = false,
}: {
    title: string;
    message: string;
    diagnosticCode: string;
    onRetry: () => void;
    retryDisabled?: boolean;
    retrying?: boolean;
}) {
    return (
        <DashboardStatus
            tone='danger'
            title={title}
            role='alert'
            actions={
                <button
                    type='button'
                    onClick={onRetry}
                    disabled={retryDisabled || retrying}
                    aria-busy={retrying || undefined}
                    className={dashboardDangerActionClassName}>
                    {retrying ? 'Retrying…' : retryDisabled ? 'Waiting for current read' : 'Retry Blueprint'}
                </button>
            }>
            <p>{message}</p>
            <p className='mt-1 font-mono text-xs text-[var(--dash-text-subtle)]'>Diagnostic: {diagnosticCode}</p>
        </DashboardStatus>
    );
}

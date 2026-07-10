// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DashboardStructureErrorBoundary, DashboardStructureErrorState } from './dashboard-structure-error-boundary.js';

describe('Server Blueprint error recovery', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('replaces a render failure with a diagnostic and retries the panel', () => {
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
        render(<RecoveryHarness />);

        expect(screen.getByRole('alert').textContent).toContain('BLUEPRINT_RENDER_FAILED');
        fireEvent.click(screen.getByRole('button', { name: 'Retry Blueprint' }));
        expect(screen.getByText('Blueprint recovered')).toBeTruthy();
    });

    it('exposes a retry for a failed cold read', () => {
        const onRetry = vi.fn();
        render(
            <DashboardStructureErrorState
                title='Server Blueprint could not load'
                message='Try again.'
                diagnosticCode='BLUEPRINT_LOAD_TIMEOUT'
                onRetry={onRetry}
            />
        );

        fireEvent.click(screen.getByRole('button', { name: 'Retry Blueprint' }));
        expect(onRetry).toHaveBeenCalledOnce();
    });
});

function RecoveryHarness() {
    const [failed, setFailed] = useState(true);
    return (
        <DashboardStructureErrorBoundary onRetry={() => setFailed(false)}>
            {failed ? <ThrowingPanel /> : <p>Blueprint recovered</p>}
        </DashboardStructureErrorBoundary>
    );
}

function ThrowingPanel(): never {
    throw new Error('test-render-failure');
}

// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { DashboardStructureSurfaceContent } from './dashboard-structure-surface-state.js';

describe('DashboardStructureSurfaceContent', () => {
    it('makes a Blueprint refresh retry visibly busy and prevents duplicate clicks', () => {
        const retry = vi.fn();

        const view = render(
            <DashboardStructureSurfaceContent
                refreshIssue={{ code: 'BLUEPRINT_LOAD_FAILED' }}
                refreshRetrying={false}
                onRetryRefresh={retry}>
                <p>Last confirmed workspace</p>
            </DashboardStructureSurfaceContent>
        );

        fireEvent.click(screen.getByRole('button', { name: 'Retry Blueprint refresh' }));
        expect(retry).toHaveBeenCalledOnce();

        view.rerender(
            <DashboardStructureSurfaceContent
                refreshIssue={{ code: 'BLUEPRINT_LOAD_FAILED' }}
                refreshRetrying
                onRetryRefresh={retry}>
                <p>Last confirmed workspace</p>
            </DashboardStructureSurfaceContent>
        );

        const retrying = screen.getByRole<HTMLButtonElement>('button', { name: 'Retrying…' });
        expect(retrying.disabled).toBe(true);
        expect(retrying.getAttribute('aria-busy')).toBe('true');
    });
});

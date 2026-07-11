// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { DashboardGuildPendingPage } from './dashboard-guild-page.js';

describe('DashboardGuildPendingPage', () => {
    it('renders a generic loading shell when no safe guild preview is available', () => {
        render(<DashboardGuildPendingPage guildId='untrusted-cold-guild-id' />);

        expect(screen.getByRole('status').textContent).toContain('Loading dashboard');
        expect(screen.getAllByRole('main')).toHaveLength(1);
        expect(document.body.textContent).not.toContain('untrusted-cold-guild-id');
    });
});

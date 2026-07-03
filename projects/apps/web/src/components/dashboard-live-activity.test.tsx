// @vitest-environment jsdom

import { render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { DashboardConvexLiveGate, isDashboardLiveTransportActive } from './dashboard-live-activity.js';

describe('dashboard live activity', () => {
    afterEach(() => {
        setDocumentVisibility('visible');
        setNavigatorOnline(true);
    });

    it('treats only visible online browser tabs as live transport active', () => {
        setDocumentVisibility('visible');
        setNavigatorOnline(true);
        expect(isDashboardLiveTransportActive()).toBe(true);

        setDocumentVisibility('hidden');
        expect(isDashboardLiveTransportActive()).toBe(false);

        setDocumentVisibility('visible');
        setNavigatorOnline(false);
        expect(isDashboardLiveTransportActive()).toBe(false);
    });

    it('mounts Convex live children only while the browser tab is active', async () => {
        setDocumentVisibility('hidden');
        setNavigatorOnline(true);
        render(
            <DashboardConvexLiveGate>
                <div>live convex child</div>
            </DashboardConvexLiveGate>
        );

        expect(screen.queryByText('live convex child')).toBeNull();

        setDocumentVisibility('visible');
        document.dispatchEvent(new Event('visibilitychange'));

        expect(await screen.findByText('live convex child')).toBeTruthy();

        setNavigatorOnline(false);
        window.dispatchEvent(new Event('offline'));

        await waitFor(() => expect(screen.queryByText('live convex child')).toBeNull());
    });

    it('pauses live children on pagehide even before visibility changes', async () => {
        setDocumentVisibility('visible');
        setNavigatorOnline(true);
        const { container } = render(
            <DashboardConvexLiveGate>
                <div>live convex child</div>
            </DashboardConvexLiveGate>
        );
        const currentView = within(container);

        expect(await currentView.findByText('live convex child')).toBeTruthy();

        window.dispatchEvent(new Event('pagehide'));

        await waitFor(() => expect(currentView.queryByText('live convex child')).toBeNull());

        window.dispatchEvent(new Event('pageshow'));

        expect(await currentView.findByText('live convex child')).toBeTruthy();
    });
});

function setDocumentVisibility(value: DocumentVisibilityState): void {
    Object.defineProperty(document, 'visibilityState', {
        configurable: true,
        value,
    });
}

function setNavigatorOnline(value: boolean): void {
    Object.defineProperty(navigator, 'onLine', {
        configurable: true,
        value,
    });
}

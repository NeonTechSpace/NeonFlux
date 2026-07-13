import { expect, test } from '@playwright/test';

import { observePageDiagnostics } from '../support/page-diagnostics.js';

test.describe.configure({ mode: 'serial' });

test('production public chunks hydrate and support client navigation', async ({ page }) => {
    const diagnostics = observePageDiagnostics(page);

    await page.goto('/');
    await expect(page.locator('h1', { hasText: 'NeonFlux' })).toBeVisible();
    await page.evaluate(() => {
        window.addEventListener('beforeunload', () => sessionStorage.setItem('e2e-beforeunload', 'true'));
    });

    await page.locator('a', { hasText: 'Docs' }).click();
    await expect(page).toHaveURL(/\/docs\/topic\/?$/u);
    await expect(page.locator('h1').first()).toBeVisible();
    expect(await page.evaluate(() => sessionStorage.getItem('e2e-beforeunload'))).toBeNull();
    diagnostics.assertClean();
});

test('unauthenticated dashboard redirects through the real login boundary without following Fluxer', async ({
    request,
}) => {
    const dashboard = await request.get('/dashboard', { maxRedirects: 0 });
    expect(dashboard.status()).toBe(302);
    expect(dashboard.headers().location).toBe('/auth/fluxer/login');

    const login = await request.get('/auth/fluxer/login', { maxRedirects: 0 });
    expect(login.status()).toBe(302);
    const location = login.headers().location;
    expect(location).toBeTruthy();

    const authorizeUrl = new URL(location);
    expect(authorizeUrl.origin + authorizeUrl.pathname).toBe('https://web.fluxer.app/oauth2/authorize');
    expect(authorizeUrl.searchParams.get('client_id')).toBe('neonflux-e2e-public');
    expect(authorizeUrl.searchParams.get('redirect_uri')).toMatch(/\/auth\/fluxer\/callback$/u);
    expect(authorizeUrl.searchParams.get('scope')?.split(' ').sort()).toEqual(['guilds', 'identify']);
    expect(authorizeUrl.searchParams.get('state')).toBeTruthy();
    expect(login.headers()['set-cookie']).toContain('neonflux_fluxer_oauth_state=');
});
